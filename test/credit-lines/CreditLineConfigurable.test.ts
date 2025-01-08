import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { connect, getAddress, getLatestBlockTimestamp, proveTx } from "../../test-utils/eth";
import { checkEquality, maxUintForBits, roundMath, setUpFixture } from "../../test-utils/common";

enum BorrowPolicy {
  SingleActiveLoan = 0,
  MultipleActiveLoans = 1,
  TotalActiveAmountLimit = 2
}

interface CreditLineConfig {
  minBorrowAmount: bigint;
  maxBorrowAmount: bigint;
  minInterestRatePrimary: bigint;
  maxInterestRatePrimary: bigint;
  minInterestRateSecondary: bigint;
  maxInterestRateSecondary: bigint;
  minDurationInPeriods: bigint;
  maxDurationInPeriods: bigint;
  minAddonFixedRate: bigint;
  maxAddonFixedRate: bigint;
  minAddonPeriodRate: bigint;
  maxAddonPeriodRate: bigint;

  [key: string]: bigint; // Index signature
}

interface BorrowerConfig {
  expiration: bigint;
  minDurationInPeriods: bigint;
  maxDurationInPeriods: bigint;
  minBorrowAmount: bigint;
  maxBorrowAmount: bigint;
  borrowPolicy: BorrowPolicy;
  interestRatePrimary: bigint;
  interestRateSecondary: bigint;
  addonFixedRate: bigint;
  addonPeriodRate: bigint;

  [key: string]: bigint | BorrowPolicy; // Index signature
}

interface BorrowerState {
  activeLoanCount: bigint;
  closedLoanCount: bigint;
  totalActiveLoanAmount: bigint;
  totalClosedLoanAmount: bigint;

  [key: string]: bigint; // Index signature
}

interface LoanTerms {
  token: string;
  durationInPeriods: bigint;
  interestRatePrimary: bigint;
  interestRateSecondary: bigint;
  addonAmount: bigint;

  [key: string]: string | bigint; // Index signature
}

interface LoanState {
  programId: bigint;
  borrowAmount: bigint;
  addonAmount: bigint;
  startTimestamp: bigint;
  durationInPeriods: bigint;
  token: string;
  borrower: string;
  interestRatePrimary: bigint;
  interestRateSecondary: bigint;
  repaidAmount: bigint;
  trackedBalance: bigint;
  trackedTimestamp: bigint;
  freezeTimestamp: bigint;
}

interface Version {
  major: number;
  minor: number;
  patch: number;

  [key: string]: number; // Indexing signature to ensure that fields are iterated over in a key-value style
}

interface Fixture {
  creditLine: Contract;
  creditLineUnderAdmin: Contract;
  creditLineAddress: string;
  market: Contract;
  marketAddress: string;
  creditLineConfig: CreditLineConfig;
  borrowerConfig: BorrowerConfig;
}

const ZERO_ADDRESS = ethers.ZeroAddress;

const defaultCreditLineConfig: CreditLineConfig = {
  minBorrowAmount: 0n,
  maxBorrowAmount: 0n,
  minInterestRatePrimary: 0n,
  maxInterestRatePrimary: 0n,
  minInterestRateSecondary: 0n,
  maxInterestRateSecondary: 0n,
  minDurationInPeriods: 0n,
  maxDurationInPeriods: 0n,
  minAddonFixedRate: 0n,
  maxAddonFixedRate: 0n,
  minAddonPeriodRate: 0n,
  maxAddonPeriodRate: 0n
};

const defaultBorrowerConfig: BorrowerConfig = {
  expiration: 0n,
  minDurationInPeriods: 0n,
  maxDurationInPeriods: 0n,
  minBorrowAmount: 0n,
  maxBorrowAmount: 0n,
  borrowPolicy: BorrowPolicy.SingleActiveLoan,
  interestRatePrimary: 0n,
  interestRateSecondary: 0n,
  addonFixedRate: 0n,
  addonPeriodRate: 0n
};

const defaultBorrowerState: BorrowerState = {
  activeLoanCount: 0n,
  closedLoanCount: 0n,
  totalActiveLoanAmount: 0n,
  totalClosedLoanAmount: 0n
};

const defaultLoanState: LoanState = {
  programId: 0n,
  borrowAmount: 0n,
  addonAmount: 0n,
  startTimestamp: 0n,
  durationInPeriods: 0n,
  token: ZERO_ADDRESS,
  borrower: ZERO_ADDRESS,
  interestRatePrimary: 0n,
  interestRateSecondary: 0n,
  repaidAmount: 0n,
  trackedBalance: 0n,
  trackedTimestamp: 0n,
  freezeTimestamp: 0n
};

const ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED = "AccessControlUnauthorizedAccount";
const ERROR_NAME_ALREADY_INITIALIZED = "InvalidInitialization";
const ERROR_NAME_ARRAYS_LENGTH_MISMATCH = "ArrayLengthMismatch";
const ERROR_NAME_BORROWER_CONFIGURATION_EXPIRED = "BorrowerConfigurationExpired";
const ERROR_NAME_BORROWER_STATE_OVERFLOW = "BorrowerStateOverflow";
const ERROR_NAME_ENFORCED_PAUSED = "EnforcedPause";
const ERROR_NAME_INVALID_AMOUNT = "InvalidAmount";
const ERROR_NAME_INVALID_BORROWER_CONFIGURATION = "InvalidBorrowerConfiguration";
const ERROR_NAME_INVALID_CREDIT_LINE_CONFIGURATION = "InvalidCreditLineConfiguration";
const ERROR_NAME_LOAN_DURATION_OUT_OF_RANGE = "LoanDurationOutOfRange";
const ERROR_NAME_NOT_PAUSED = "ExpectedPause";
const ERROR_NAME_LIMIT_VIOLATION_ON_SINGLE_ACTIVE_LOAN = "LimitViolationOnSingleActiveLoan";
const ERROR_NAME_LIMIT_VIOLATION_ON_TOTAL_ACTIVE_LOAN_AMOUNT = "LimitViolationOnTotalActiveLoanAmount";
const ERROR_NAME_UNAUTHORIZED = "Unauthorized";
const ERROR_NAME_ZERO_ADDRESS = "ZeroAddress";

const EVENT_NAME_BORROWER_CONFIGURED = "BorrowerConfigured";
const EVENT_NAME_CREDIT_LINE_CONFIGURED = "CreditLineConfigured";
const EVENT_NAME_PAUSED = "Paused";
const EVENT_NAME_UNPAUSED = "Unpaused";
const EVENT_NAME_HOOK_CALL_RESULT = "HookCallResult";

const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
const OWNER_ROLE = ethers.id("OWNER_ROLE");
const ADMIN_ROLE = ethers.id("ADMIN_ROLE");
const PAUSER_ROLE = ethers.id("PAUSER_ROLE");

const INTEREST_RATE_FACTOR = 10n ** 9n;
const ACCURACY_FACTOR = 10000n;

const MIN_BORROW_AMOUNT = 2n;
const MAX_BORROW_AMOUNT = maxUintForBits(64) - 1n;
const MIN_INTEREST_RATE_PRIMARY = 1n;
const MAX_INTEREST_RATE_PRIMARY = maxUintForBits(32) - 1n;
const MIN_INTEREST_RATE_SECONDARY = 10n;
const MAX_INTEREST_RATE_SECONDARY = maxUintForBits(32) - 1n;
const MIN_ADDON_FIXED_RATE = 1n;
const MAX_ADDON_FIXED_RATE = maxUintForBits(32) - 1n;
const MIN_ADDON_PERIOD_RATE = 10n;
const MAX_ADDON_PERIOD_RATE = maxUintForBits(32) - 1n;
const MIN_DURATION_IN_PERIODS = 1n;
const MAX_DURATION_IN_PERIODS = maxUintForBits(32) - 1n;
const NEGATIVE_TIME_OFFSET = 3n * 60n * 60n;
const EXPIRATION_TIME = maxUintForBits(32);
const BORROW_AMOUNT = 1234_567_890n;
const LOAN_ID = 123n;
const ADDON_AMOUNT = 123456789n;
const REPAY_AMOUNT = 12345678n;

const EXPECTED_VERSION: Version = {
  major: 1,
  minor: 3,
  patch: 0
};

function processLoanClosing(borrowerState: BorrowerState, borrowAmount: bigint) {
  borrowerState.activeLoanCount -= 1n;
  borrowerState.closedLoanCount += 1n;
  borrowerState.totalActiveLoanAmount -= borrowAmount;
  borrowerState.totalClosedLoanAmount += borrowAmount;
}

describe("Contract 'CreditLineConfigurable'", async () => {
  let creditLineFactory: ContractFactory;
  let marketFactory: ContractFactory;

  let deployer: HardhatEthersSigner;
  let lender: HardhatEthersSigner;
  let admin: HardhatEthersSigner;
  let token: HardhatEthersSigner;
  let attacker: HardhatEthersSigner;
  let borrower: HardhatEthersSigner;
  let users: HardhatEthersSigner[];

  before(async () => {
    [deployer, lender, admin, token, attacker, borrower, ...users] = await ethers.getSigners();

    creditLineFactory = await ethers.getContractFactory("CreditLineConfigurableTestable");
    creditLineFactory.connect(deployer); // Explicitly specifying the deployer account

    marketFactory = await ethers.getContractFactory("LendingMarketMock");
    marketFactory = marketFactory.connect(deployer); // Explicitly specifying the deployer account
  });

  async function deployMarketMock(): Promise<{ market: Contract }> {
    let market = await marketFactory.deploy() as Contract;
    await market.waitForDeployment();
    market = connect(market, deployer); // Explicitly specifying the initial account
    return { market };
  }

  async function deployContracts(): Promise<Fixture> {
    const { market } = await deployMarketMock();
    const marketAddress = getAddress(market);
    let creditLine = await upgrades.deployProxy(creditLineFactory, [
      lender.address,
      marketAddress,
      token.address
    ]);
    await creditLine.waitForDeployment();
    creditLine = connect(creditLine, lender); // Explicitly specifying the initial account
    const creditLineUnderAdmin = creditLine.connect(admin) as Contract;
    const creditLineAddress = getAddress(creditLine);

    return {
      creditLine,
      creditLineUnderAdmin,
      creditLineAddress,
      market,
      marketAddress,
      creditLineConfig: defaultCreditLineConfig,
      borrowerConfig: defaultBorrowerConfig
    };
  }

  async function deployAndConfigureContracts(): Promise<Fixture> {
    const fixture: Fixture = await deployContracts();
    const { creditLine } = fixture;

    await proveTx(creditLine.grantRole(PAUSER_ROLE, lender.address));
    await proveTx(creditLine.grantRole(ADMIN_ROLE, admin.address));

    fixture.creditLineConfig = createCreditLineConfiguration();
    await proveTx(creditLine.configureCreditLine(fixture.creditLineConfig));

    return fixture;
  }

  async function deployAndConfigureContractsWithBorrower(): Promise<Fixture> {
    const fixture: Fixture = await deployAndConfigureContracts();
    const { creditLineUnderAdmin } = fixture;

    fixture.borrowerConfig = createBorrowerConfiguration();
    await proveTx(creditLineUnderAdmin.configureBorrower(borrower.address, fixture.borrowerConfig));

    return fixture;
  }

  function createCreditLineConfiguration(): CreditLineConfig {
    return {
      minDurationInPeriods: MIN_DURATION_IN_PERIODS,
      maxDurationInPeriods: MAX_DURATION_IN_PERIODS,
      minBorrowAmount: MIN_BORROW_AMOUNT,
      maxBorrowAmount: MAX_BORROW_AMOUNT,
      minInterestRatePrimary: MIN_INTEREST_RATE_PRIMARY,
      maxInterestRatePrimary: MAX_INTEREST_RATE_PRIMARY,
      minInterestRateSecondary: MIN_INTEREST_RATE_SECONDARY,
      maxInterestRateSecondary: MAX_INTEREST_RATE_SECONDARY,
      minAddonFixedRate: MIN_ADDON_FIXED_RATE,
      maxAddonFixedRate: MAX_ADDON_FIXED_RATE,
      minAddonPeriodRate: MIN_ADDON_PERIOD_RATE,
      maxAddonPeriodRate: MAX_ADDON_PERIOD_RATE
    };
  }

  function createBorrowerConfiguration(
    borrowPolicy: BorrowPolicy = BorrowPolicy.MultipleActiveLoans
  ): BorrowerConfig {
    return {
      expiration: EXPIRATION_TIME,
      minDurationInPeriods: MIN_DURATION_IN_PERIODS,
      maxDurationInPeriods: MAX_DURATION_IN_PERIODS,
      minBorrowAmount: MIN_BORROW_AMOUNT,
      maxBorrowAmount: MAX_BORROW_AMOUNT,
      borrowPolicy: borrowPolicy,
      interestRatePrimary: MIN_INTEREST_RATE_PRIMARY,
      interestRateSecondary: MIN_INTEREST_RATE_SECONDARY,
      addonFixedRate: MIN_ADDON_FIXED_RATE,
      addonPeriodRate: MIN_ADDON_PERIOD_RATE
    };
  }

  function createLoanTerms(
    borrowAmount: bigint,
    durationInPeriods: bigint,
    borrowerConfig: BorrowerConfig
  ): LoanTerms {
    const addonAmount = calculateAddonAmount(
      borrowAmount,
      durationInPeriods,
      borrowerConfig.addonFixedRate,
      borrowerConfig.addonPeriodRate,
      INTEREST_RATE_FACTOR
    );
    return {
      token: token.address,
      interestRatePrimary: borrowerConfig.interestRatePrimary,
      interestRateSecondary: borrowerConfig.interestRateSecondary,
      durationInPeriods,
      addonAmount: roundMath(addonAmount, ACCURACY_FACTOR)
    };
  }

  function calculateAddonAmount(
    borrowAmount: bigint,
    durationInPeriods: bigint,
    addonFixedRate: bigint,
    addonPeriodRate: bigint,
    interestRateFactor: bigint
  ): bigint {
    const addonRate = addonPeriodRate * durationInPeriods + addonFixedRate;
    return (borrowAmount * addonRate) / (interestRateFactor - addonRate);
  }

  async function prepareLoan(market: Contract, props: { trackedBalance?: bigint } = {}): Promise<LoanState> {
    const loanState: LoanState = {
      ...defaultLoanState,
      borrowAmount: BORROW_AMOUNT,
      addonAmount: ADDON_AMOUNT,
      borrower: borrower.address,
      trackedBalance: props.trackedBalance ?? 0n
    };
    await proveTx(market.mockLoanState(LOAN_ID, loanState));

    return loanState;
  }

  async function prepareDataForBatchBorrowerConfig(borrowersNumber: number = 3): Promise<{
    borrowers: string[];
    configs: BorrowerConfig[];
  }> {
    const config = createBorrowerConfiguration();
    if (borrowersNumber > users.length) {
      throw new Error(
        "The number of borrowers is greater than the number of free accounts in the Hardhat settings. " +
        `Requested number of borrowers: ${borrowersNumber}. ` +
        `The number of free accounts: ${users.length}`
      );
    }

    const borrowers = users.slice(0, borrowersNumber).map(user => user.address);

    // A new config for each borrower with some difference
    const configs: BorrowerConfig[] = Array(borrowersNumber).fill({ ...config });
    configs.forEach((config, index) => config.maxBorrowAmount + BigInt(index));

    return {
      borrowers,
      configs
    };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { creditLine, marketAddress } = await setUpFixture(deployContracts);
      // Role hashes
      expect(await creditLine.OWNER_ROLE()).to.equal(OWNER_ROLE);
      expect(await creditLine.ADMIN_ROLE()).to.equal(ADMIN_ROLE);
      expect(await creditLine.PAUSER_ROLE()).to.equal(PAUSER_ROLE);

      // The role admins
      expect(await creditLine.getRoleAdmin(OWNER_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await creditLine.getRoleAdmin(ADMIN_ROLE)).to.equal(OWNER_ROLE);
      expect(await creditLine.getRoleAdmin(PAUSER_ROLE)).to.equal(OWNER_ROLE);

      // The lender should have the owner role, but not the other roles
      expect(await creditLine.hasRole(OWNER_ROLE, lender.address)).to.equal(true);
      expect(await creditLine.hasRole(ADMIN_ROLE, lender.address)).to.equal(false);
      expect(await creditLine.hasRole(PAUSER_ROLE, lender.address)).to.equal(false);

      // The initial contract state is unpaused
      expect(await creditLine.paused()).to.equal(false);

      // Other important parameters
      expect(await creditLine.isAdmin(lender.address)).to.eq(false);
      expect(await creditLine.token()).to.eq(token.address);
      expect(await creditLine.market()).to.eq(marketAddress);

      // Default values of the internal structures. Also checks the set of fields
      checkEquality(await creditLine.creditLineConfiguration(), defaultCreditLineConfig);
      checkEquality(await creditLine.getBorrowerConfiguration(borrower.address), defaultBorrowerConfig);
      checkEquality(await creditLine.getBorrowerState(borrower.address), defaultBorrowerState);
    });

    it("Is reverted if the lender address is zero", async () => {
      await expect(upgrades.deployProxy(creditLineFactory, [
        ZERO_ADDRESS, // lender
        lender.address,
        token.address
      ])).to.be.revertedWithCustomError(creditLineFactory, ERROR_NAME_ZERO_ADDRESS);
    });

    it("Is reverted if the market address is zero", async () => {
      await expect(upgrades.deployProxy(creditLineFactory, [
        lender.address,
        ZERO_ADDRESS, // market
        token.address
      ])).to.be.revertedWithCustomError(creditLineFactory, ERROR_NAME_ZERO_ADDRESS);
    });

    it("Is reverted if the token address is zero", async () => {
      const marketAddress = token.address;
      await expect(upgrades.deployProxy(creditLineFactory, [
        marketAddress,
        lender.address,
        ZERO_ADDRESS // token
      ])).to.be.revertedWithCustomError(creditLineFactory, ERROR_NAME_ZERO_ADDRESS);
    });

    it("Is reverted if called a second time", async () => {
      const { creditLine, marketAddress } = await setUpFixture(deployContracts);

      await expect(creditLine.initialize(marketAddress, lender.address, token.address))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ALREADY_INITIALIZED);
    });
  });

  describe("Function '$__VERSION()'", async () => {
    it("Returns expected values", async () => {
      const { creditLine } = await setUpFixture(deployContracts);
      const creditLineVersion = await creditLine.$__VERSION();
      checkEquality(creditLineVersion, EXPECTED_VERSION);
    });
  });

  describe("Function 'pause()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { creditLine } = await setUpFixture(deployContracts);

      await proveTx(creditLine.grantRole(PAUSER_ROLE, lender.address));

      await expect(creditLine.pause())
        .to.emit(creditLine, EVENT_NAME_PAUSED)
        .withArgs(lender.address);
      expect(await creditLine.paused()).to.eq(true);
    });

    it("Is reverted if the caller does not have the pauser role", async () => {
      const { creditLine } = await setUpFixture(deployContracts);

      await expect(connect(creditLine, lender).pause())
        .to.be.revertedWithCustomError(creditLineFactory, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(lender.address, PAUSER_ROLE);
    });

    it("Is reverted if the contract is already paused", async () => {
      const { creditLine } = await setUpFixture(deployContracts);

      await proveTx(creditLine.grantRole(PAUSER_ROLE, lender.address));
      await proveTx(creditLine.pause());
      await expect(creditLine.pause())
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ENFORCED_PAUSED);
    });
  });

  describe("Function 'unpause()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { creditLine } = await setUpFixture(deployContracts);

      await proveTx(creditLine.grantRole(PAUSER_ROLE, lender.address));
      await proveTx(creditLine.pause());
      expect(await creditLine.paused()).to.eq(true);

      await expect(creditLine.unpause())
        .to.emit(creditLine, EVENT_NAME_UNPAUSED)
        .withArgs(lender.address);

      expect(await creditLine.paused()).to.eq(false);
    });

    it("Is reverted if the caller does not have the pauser role", async () => {
      const { creditLine } = await setUpFixture(deployContracts);

      await expect(connect(creditLine, lender).unpause())
        .to.be.revertedWithCustomError(creditLineFactory, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(lender.address, PAUSER_ROLE);
    });

    it("Is reverted if the contract is not paused yet", async () => {
      const { creditLine } = await setUpFixture(deployContracts);

      await proveTx(creditLine.grantRole(PAUSER_ROLE, lender.address));
      await expect(creditLine.unpause())
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_NOT_PAUSED);
    });
  });

  describe("Function 'configureCreditLine()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { creditLine } = await setUpFixture(deployContracts);
      const expectedConfig = createCreditLineConfiguration();

      await expect(creditLine.configureCreditLine(expectedConfig))
        .to.emit(creditLine, EVENT_NAME_CREDIT_LINE_CONFIGURED)
        .withArgs(getAddress(creditLine));

      const actualConfig: CreditLineConfig = await creditLine.creditLineConfiguration();

      checkEquality(actualConfig, expectedConfig);
    });

    it("Is reverted if the caller does not have the owner role", async () => {
      const { creditLine } = await setUpFixture(deployContracts);
      const config = createCreditLineConfiguration();

      await proveTx(creditLine.grantRole(ADMIN_ROLE, admin.address));
      await expect(connect(creditLine, admin).configureCreditLine(config))
        .to.be.revertedWithCustomError(creditLineFactory, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(admin.address, OWNER_ROLE);
    });

    it("Is reverted if the min borrow amount is bigger than the max one", async () => {
      const { creditLine } = await setUpFixture(deployContracts);
      const config = createCreditLineConfiguration();

      config.minBorrowAmount = config.maxBorrowAmount + 1n;

      await expect(creditLine.configureCreditLine(config))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_INVALID_CREDIT_LINE_CONFIGURATION);
    });

    it("Is reverted if the min loan duration is bigger than the max one", async () => {
      const { creditLine } = await setUpFixture(deployContracts);
      const config = createCreditLineConfiguration();

      config.minDurationInPeriods = config.maxDurationInPeriods + 1n;

      await expect(creditLine.configureCreditLine(config))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_INVALID_CREDIT_LINE_CONFIGURATION);
    });

    it("Is reverted if the min primary interest rate is bigger than the max one", async () => {
      const { creditLine } = await setUpFixture(deployContracts);
      const config = createCreditLineConfiguration();

      config.minInterestRatePrimary = config.maxInterestRatePrimary + 1n;

      await expect(creditLine.configureCreditLine(config))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_INVALID_CREDIT_LINE_CONFIGURATION);
    });

    it("Is reverted if the min secondary interest rate is bigger than the max one", async () => {
      const { creditLine } = await setUpFixture(deployContracts);
      const config = createCreditLineConfiguration();

      config.minInterestRateSecondary = config.maxInterestRateSecondary + 1n;

      await expect(creditLine.configureCreditLine(config))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_INVALID_CREDIT_LINE_CONFIGURATION);
    });

    it("Is reverted if the min addon fixed rate is bigger than the max one", async () => {
      const { creditLine } = await setUpFixture(deployContracts);
      const config = createCreditLineConfiguration();

      config.minAddonFixedRate = config.maxAddonFixedRate + 1n;

      await expect(creditLine.configureCreditLine(config))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_INVALID_CREDIT_LINE_CONFIGURATION);
    });

    it("Is reverted if the min addon period rate is bigger than the max one", async () => {
      const { creditLine } = await setUpFixture(deployContracts);
      const config = createCreditLineConfiguration();

      config.minAddonPeriodRate = config.maxAddonPeriodRate + 1n;

      await expect(creditLine.configureCreditLine(config))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_INVALID_CREDIT_LINE_CONFIGURATION);
    });
  });

  describe("Function 'configureBorrower()'", async () => {
    it("Executes as expected and emits the correct event if is called by an admin", async () => {
      const { creditLineUnderAdmin } = await setUpFixture(deployAndConfigureContracts);
      const expectedConfig = createBorrowerConfiguration();

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, expectedConfig))
        .to.emit(creditLineUnderAdmin, EVENT_NAME_BORROWER_CONFIGURED)
        .withArgs(getAddress(creditLineUnderAdmin), borrower.address);

      const actualConfig: BorrowerConfig = await creditLineUnderAdmin.getBorrowerConfiguration(borrower.address);

      checkEquality(actualConfig, expectedConfig);
    });

    it("Is reverted if the caller does not have the admin role", async () => {
      const { creditLine } = await setUpFixture(deployAndConfigureContracts);
      const config = createBorrowerConfiguration();

      // Even the lender cannot configure a borrower
      await expect(connect(creditLine, lender).configureBorrower(attacker.address, config))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(lender.address, ADMIN_ROLE);
    });

    it("Is reverted if the contract is paused", async () => {
      const { creditLine, creditLineUnderAdmin } = await setUpFixture(deployAndConfigureContracts);
      const config = createBorrowerConfiguration();

      await proveTx(creditLine.pause());

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, config))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the borrower address is zero", async () => {
      const { creditLineUnderAdmin } = await setUpFixture(deployAndConfigureContracts);
      const config = createBorrowerConfiguration();

      await expect(creditLineUnderAdmin.configureBorrower(
        ZERO_ADDRESS, // borrower
        config
      )).to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_ZERO_ADDRESS);
    });

    it("Is reverted if the min borrow amount is greater than the max one", async () => {
      const { creditLineUnderAdmin } = await setUpFixture(deployAndConfigureContracts);
      const config = createBorrowerConfiguration();

      config.minBorrowAmount = config.maxBorrowAmount + 1n;

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, config))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_INVALID_BORROWER_CONFIGURATION);
    });

    it("Is reverted if the min borrow amount is less than credit line`s one", async () => {
      const { creditLineUnderAdmin, creditLineConfig } = await setUpFixture(deployAndConfigureContracts);
      const borrowerConfig = createBorrowerConfiguration();

      borrowerConfig.minBorrowAmount = creditLineConfig.minBorrowAmount - 1n;

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, borrowerConfig))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_INVALID_BORROWER_CONFIGURATION);
    });

    it("Is reverted if the max borrow amount is greater than credit line`s one", async () => {
      const { creditLineUnderAdmin, creditLineConfig } = await setUpFixture(deployAndConfigureContracts);
      const borrowerConfig = createBorrowerConfiguration();

      borrowerConfig.maxBorrowAmount = creditLineConfig.maxBorrowAmount + 1n;

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, borrowerConfig))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_INVALID_BORROWER_CONFIGURATION);
    });

    it("Is reverted if the min duration in periods is greater than the max one", async () => {
      const { creditLineUnderAdmin, creditLineConfig } = await setUpFixture(deployAndConfigureContracts);
      const borrowerConfig = createBorrowerConfiguration();

      borrowerConfig.minDurationInPeriods = creditLineConfig.maxDurationInPeriods + 1n;

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, borrowerConfig))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_INVALID_BORROWER_CONFIGURATION);
    });

    it("Is reverted if the min loan duration is less than credit line`s one", async () => {
      const { creditLineUnderAdmin, creditLineConfig } = await setUpFixture(deployAndConfigureContracts);
      const borrowerConfig = createBorrowerConfiguration();

      borrowerConfig.minDurationInPeriods = creditLineConfig.minDurationInPeriods - 1n;

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, borrowerConfig))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_INVALID_BORROWER_CONFIGURATION);
    });

    it("Is reverted if the max loan duration is greater than credit line`s one", async () => {
      const { creditLineUnderAdmin, creditLineConfig } = await setUpFixture(deployAndConfigureContracts);
      const borrowerConfig = createBorrowerConfiguration();

      borrowerConfig.maxDurationInPeriods = creditLineConfig.maxDurationInPeriods + 1n;

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, borrowerConfig))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_INVALID_BORROWER_CONFIGURATION);
    });

    it("Is reverted if the primary interest rate is less than credit line`s minimum one", async () => {
      const { creditLineUnderAdmin, creditLineConfig } = await setUpFixture(deployAndConfigureContracts);
      const borrowerConfig = createBorrowerConfiguration();

      borrowerConfig.interestRatePrimary = creditLineConfig.minInterestRatePrimary - 1n;

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, borrowerConfig))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_INVALID_BORROWER_CONFIGURATION);
    });

    it("Is reverted if the primary interest rate is greater than credit line`s maximum one", async () => {
      const { creditLineUnderAdmin, creditLineConfig } = await setUpFixture(deployAndConfigureContracts);
      const borrowerConfig = createBorrowerConfiguration();

      borrowerConfig.interestRatePrimary = creditLineConfig.maxInterestRatePrimary + 1n;

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, borrowerConfig))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_INVALID_BORROWER_CONFIGURATION);
    });

    it("Is reverted if the secondary interest rate is less than credit line`s minimum one", async () => {
      const { creditLineUnderAdmin, creditLineConfig } = await setUpFixture(deployAndConfigureContracts);
      const borrowerConfig = createBorrowerConfiguration();

      borrowerConfig.interestRateSecondary = creditLineConfig.minInterestRateSecondary - 1n;

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, borrowerConfig))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_INVALID_BORROWER_CONFIGURATION);
    });

    it("Is reverted if the secondary interest rate is greater than credit line`s maximum one", async () => {
      const { creditLineUnderAdmin, creditLineConfig } = await setUpFixture(deployAndConfigureContracts);
      const borrowerConfig = createBorrowerConfiguration();

      borrowerConfig.interestRateSecondary = creditLineConfig.maxInterestRateSecondary + 1n;

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, borrowerConfig))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_INVALID_BORROWER_CONFIGURATION);
    });

    it("Is reverted if the addon fixed rate is less than credit line`s minimum one", async () => {
      const { creditLineUnderAdmin, creditLineConfig } = await setUpFixture(deployAndConfigureContracts);
      const borrowerConfig = createBorrowerConfiguration();

      borrowerConfig.addonFixedRate = creditLineConfig.minAddonFixedRate - 1n;

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, borrowerConfig))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_INVALID_BORROWER_CONFIGURATION);
    });

    it("Is reverted if the addon fixed rate is greater than credit line`s maximum one", async () => {
      const { creditLineUnderAdmin, creditLineConfig } = await setUpFixture(deployAndConfigureContracts);
      const borrowerConfig = createBorrowerConfiguration();

      borrowerConfig.addonFixedRate = creditLineConfig.maxAddonFixedRate + 1n;

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, borrowerConfig))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_INVALID_BORROWER_CONFIGURATION);
    });

    it("Is reverted if the addon period rate is less than credit line`s minimum one", async () => {
      const { creditLineUnderAdmin, creditLineConfig } = await setUpFixture(deployAndConfigureContracts);
      const borrowerConfig = createBorrowerConfiguration();

      borrowerConfig.addonPeriodRate = creditLineConfig.minAddonPeriodRate - 1n;

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, borrowerConfig))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_INVALID_BORROWER_CONFIGURATION);
    });

    it("Is reverted if the addon period rate is greater than credit line`s maximum one", async () => {
      const { creditLineUnderAdmin, creditLineConfig } = await setUpFixture(deployAndConfigureContracts);
      const borrowerConfig = createBorrowerConfiguration();

      borrowerConfig.addonPeriodRate = creditLineConfig.maxAddonPeriodRate + 1n;

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, borrowerConfig))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_INVALID_BORROWER_CONFIGURATION);
    });
  });

  describe("Function 'configureBorrowers()'", async () => {
    it("Executes as expected and emits correct events if is called by an admin", async () => {
      const { creditLineUnderAdmin } = await setUpFixture(deployAndConfigureContracts);
      const { borrowers, configs } = await prepareDataForBatchBorrowerConfig();

      const tx = creditLineUnderAdmin.configureBorrowers(borrowers, configs);

      const creditLineAddress = getAddress(creditLineUnderAdmin);
      for (let i = 0; i < borrowers.length; i++) {
        await expect(tx)
          .to.emit(creditLineUnderAdmin, EVENT_NAME_BORROWER_CONFIGURED)
          .withArgs(creditLineAddress, borrowers[i]);
        const expectedConfig = configs[i];
        const actualConfig = await creditLineUnderAdmin.getBorrowerConfiguration(borrowers[i]);
        checkEquality(actualConfig, expectedConfig);
      }
    });

    it("Is reverted if the caller does not have the admin role", async () => {
      const { creditLine } = await setUpFixture(deployAndConfigureContracts);
      const { borrowers, configs } = await prepareDataForBatchBorrowerConfig();

      await expect(connect(creditLine, lender).configureBorrowers(borrowers, configs))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(lender.address, ADMIN_ROLE);
    });

    it("Is reverted if the contract is paused", async () => {
      const { creditLine, creditLineUnderAdmin } = await setUpFixture(deployAndConfigureContracts);
      const { borrowers, configs } = await prepareDataForBatchBorrowerConfig();

      await proveTx(creditLine.pause());

      await expect(creditLineUnderAdmin.configureBorrowers(borrowers, configs))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the length of arrays is different", async () => {
      const { creditLineUnderAdmin } = await setUpFixture(deployAndConfigureContracts);
      const { borrowers, configs } = await prepareDataForBatchBorrowerConfig();

      borrowers.push(attacker.address);

      await expect(creditLineUnderAdmin.configureBorrowers(borrowers, configs))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_ARRAYS_LENGTH_MISMATCH);
    });
  });

  describe("Function 'onBeforeLoanTaken()'", async () => {
    it("Executes as expected", async () => {
      const fixture = await setUpFixture(deployAndConfigureContractsWithBorrower);
      const { creditLine, creditLineUnderAdmin, market, borrowerConfig: expectedBorrowerConfig } = fixture;
      const expectedBorrowerState: BorrowerState = {
        ...defaultBorrowerState,
        activeLoanCount: maxUintForBits(16) - 2n,
        closedLoanCount: 1n,
        totalActiveLoanAmount: maxUintForBits(64) - BigInt(BORROW_AMOUNT * 2n),
        totalClosedLoanAmount: BigInt(BORROW_AMOUNT)
      };

      await proveTx(creditLineUnderAdmin.configureBorrower(borrower.address, expectedBorrowerConfig));
      await proveTx(creditLineUnderAdmin.setBorrowerState(borrower.address, expectedBorrowerState));
      const loanState: LoanState = await prepareLoan(market);

      await expect(market.callOnBeforeLoanTakenCreditLine(getAddress(creditLine), LOAN_ID))
        .to.emit(market, EVENT_NAME_HOOK_CALL_RESULT)
        .withArgs(true);

      expectedBorrowerState.activeLoanCount += 1n;
      expectedBorrowerState.totalActiveLoanAmount += BigInt(loanState.borrowAmount);
      const actualBorrowerState: BorrowerState = await creditLine.getBorrowerState(borrower.address);
      checkEquality(actualBorrowerState, expectedBorrowerState);
      const actualBorrowerConfig: BorrowerConfig = await creditLine.getBorrowerConfiguration(borrower.address);
      checkEquality(actualBorrowerConfig, expectedBorrowerConfig);
    });

    it("Is reverted if the caller is not the configured market", async () => {
      const { creditLine } = await setUpFixture(deployAndConfigureContractsWithBorrower);

      await expect(creditLine.onBeforeLoanTaken(LOAN_ID))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_UNAUTHORIZED);
    });

    it("Is reverted if the contract is paused", async () => {
      const { creditLine, market } = await setUpFixture(deployAndConfigureContractsWithBorrower);
      await proveTx(creditLine.pause());

      await expect(market.callOnBeforeLoanTakenCreditLine(getAddress(creditLine), LOAN_ID))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the result total number of loans is greater than 16-bit unsigned integer", async () => {
      const { creditLine, creditLineUnderAdmin, market } = await setUpFixture(deployAndConfigureContractsWithBorrower);
      const borrowerState: BorrowerState = {
        ...defaultBorrowerState,
        activeLoanCount: 0n,
        closedLoanCount: maxUintForBits(16)
      };
      await proveTx(creditLineUnderAdmin.setBorrowerState(borrower.address, borrowerState));
      await prepareLoan(market);

      await expect(market.callOnBeforeLoanTakenCreditLine(getAddress(creditLine), LOAN_ID))
        .to.revertedWithCustomError(creditLine, ERROR_NAME_BORROWER_STATE_OVERFLOW);
    });

    it("Is reverted if the result total amount of loans is greater than 64-bit unsigned integer", async () => {
      const { creditLine, creditLineUnderAdmin, market } = await setUpFixture(deployAndConfigureContractsWithBorrower);
      const borrowerState: BorrowerState = {
        ...defaultBorrowerState,
        totalActiveLoanAmount: 0n,
        totalClosedLoanAmount: maxUintForBits(64) - BORROW_AMOUNT + 1n
      };
      await proveTx(creditLineUnderAdmin.setBorrowerState(borrower.address, borrowerState));
      await prepareLoan(market);

      await expect(market.callOnBeforeLoanTakenCreditLine(getAddress(creditLine), LOAN_ID))
        .to.revertedWithCustomError(creditLine, ERROR_NAME_BORROWER_STATE_OVERFLOW);
    });
  });

  describe("Function onAfterLoanPayment()", async () => {
    it("Executes as expected if the loan tracked balance is not zero", async () => {
      const { creditLine, market } = await setUpFixture(deployAndConfigureContractsWithBorrower);
      await prepareLoan(market, { trackedBalance: 123n });
      const expectedBorrowerState: BorrowerState = { ...defaultBorrowerState };

      await expect(market.callOnAfterLoanPaymentCreditLine(
        getAddress(creditLine),
        LOAN_ID,
        REPAY_AMOUNT
      )).to.emit(
        market,
        EVENT_NAME_HOOK_CALL_RESULT
      ).withArgs(true);

      const actualBorrowerState = await creditLine.getBorrowerState(borrower.address);
      checkEquality(actualBorrowerState, expectedBorrowerState);
    });

    it("Executes as expected if the loan tracked balance is zero", async () => {
      const { creditLine, market } = await setUpFixture(deployAndConfigureContractsWithBorrower);
      const loanState: LoanState = await prepareLoan(market, { trackedBalance: 0n });
      const expectedBorrowerState: BorrowerState = {
        ...defaultBorrowerState,
        activeLoanCount: maxUintForBits(16),
        closedLoanCount: maxUintForBits(16) - 1n,
        totalActiveLoanAmount: maxUintForBits(64),
        totalClosedLoanAmount: maxUintForBits(64) - BigInt(loanState.borrowAmount)
      };
      await proveTx(creditLine.setBorrowerState(borrower.address, expectedBorrowerState));

      await expect(market.callOnAfterLoanPaymentCreditLine(
        getAddress(creditLine),
        LOAN_ID,
        REPAY_AMOUNT
      )).to.emit(
        market,
        EVENT_NAME_HOOK_CALL_RESULT
      ).withArgs(true);
      processLoanClosing(expectedBorrowerState, BigInt(loanState.borrowAmount));

      const actualBorrowerState = await creditLine.getBorrowerState(borrower.address);
      checkEquality(actualBorrowerState, expectedBorrowerState);
    });

    it("Is reverted if caller is not the market", async () => {
      const { creditLine } = await setUpFixture(deployAndConfigureContractsWithBorrower);

      await expect(connect(creditLine, attacker).onAfterLoanPayment(LOAN_ID, REPAY_AMOUNT))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_UNAUTHORIZED);
    });

    it("Is reverted if contract is paused", async () => {
      const { creditLine, market } = await setUpFixture(deployAndConfigureContractsWithBorrower);
      await proveTx(creditLine.pause());

      await expect(market.callOnAfterLoanPaymentCreditLine(
        getAddress(creditLine),
        LOAN_ID,
        REPAY_AMOUNT
      )).to.be.revertedWithCustomError(creditLine, ERROR_NAME_ENFORCED_PAUSED);
    });
  });

  describe("Function 'onAfterLoanRevocation()'", async () => {
    it("Executes as expected", async () => {
      const { creditLine, market } = await setUpFixture(deployAndConfigureContractsWithBorrower);
      const loanState: LoanState = await prepareLoan(market);
      const expectedBorrowerState: BorrowerState = {
        ...defaultBorrowerState,
        activeLoanCount: maxUintForBits(16),
        closedLoanCount: maxUintForBits(16) - 1n,
        totalActiveLoanAmount: maxUintForBits(64),
        totalClosedLoanAmount: maxUintForBits(64) - BigInt(loanState.borrowAmount)
      };
      await proveTx(creditLine.setBorrowerState(borrower.address, expectedBorrowerState));

      await expect(market.callOnAfterLoanRevocationCreditLine(getAddress(creditLine), LOAN_ID))
        .to.emit(market, EVENT_NAME_HOOK_CALL_RESULT)
        .withArgs(true);

      processLoanClosing(expectedBorrowerState, BigInt(loanState.borrowAmount));

      const actualBorrowerState = await creditLine.getBorrowerState(borrower.address);
      checkEquality(actualBorrowerState, expectedBorrowerState);
    });

    it("Is reverted if caller is not the market", async () => {
      const { creditLine } = await setUpFixture(deployAndConfigureContractsWithBorrower);

      await expect(connect(creditLine, attacker).onAfterLoanRevocation(LOAN_ID))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_UNAUTHORIZED);
    });

    it("Is reverted if contract is paused", async () => {
      const { creditLine, market } = await setUpFixture(deployAndConfigureContractsWithBorrower);
      await proveTx(creditLine.pause());

      await expect(market.callOnAfterLoanRevocationCreditLine(getAddress(creditLine), LOAN_ID))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ENFORCED_PAUSED);
    });
  });

  describe("Function 'determineLoanTerms()'", async () => {
    async function executeAndCheck(borrowPolicy: BorrowPolicy) {
      const fixture = await setUpFixture(deployAndConfigureContractsWithBorrower);
      const { creditLine, creditLineUnderAdmin, borrowerConfig } = fixture;
      const borrowAmount = (borrowerConfig.minBorrowAmount + borrowerConfig.maxBorrowAmount) / 2n;
      const durationInPeriods = INTEREST_RATE_FACTOR / 2n / borrowerConfig.addonPeriodRate;
      const borrowerState: BorrowerState = {
        ...defaultBorrowerState,
        activeLoanCount: borrowPolicy == BorrowPolicy.SingleActiveLoan ? 0n : maxUintForBits(16),
        closedLoanCount: maxUintForBits(16),
        totalActiveLoanAmount: maxUintForBits(64),
        totalClosedLoanAmount: maxUintForBits(64)
      };
      if (borrowPolicy == BorrowPolicy.TotalActiveAmountLimit) {
        borrowerState.totalActiveLoanAmount = BigInt(borrowerConfig.maxBorrowAmount) - BigInt(borrowAmount);
      }
      await proveTx(creditLineUnderAdmin.configureBorrower(borrower.address, borrowerConfig));
      await proveTx(creditLineUnderAdmin.setBorrowerState(borrower.address, borrowerState));

      const expectedTerms: LoanTerms = createLoanTerms(
        borrowAmount,
        durationInPeriods,
        borrowerConfig
      );
      const actualTerms: LoanTerms = await creditLine.determineLoanTerms(
        borrower.address,
        borrowAmount,
        durationInPeriods
      );

      checkEquality(actualTerms, expectedTerms);
    }

    it("Executes as expected if the borrowing policy is 'SingleActiveLoan'", async () => {
      await executeAndCheck(BorrowPolicy.SingleActiveLoan);
    });

    it("Executes as expected if the borrowing policy is 'MultipleActiveLoan'", async () => {
      await executeAndCheck(BorrowPolicy.MultipleActiveLoans);
    });

    it("Executes as expected if the borrowing policy is 'TotalActiveAmountLimit'", async () => {
      await executeAndCheck(BorrowPolicy.TotalActiveAmountLimit);
    });

    it("Is reverted if the borrower address is zero", async () => {
      const { creditLine, borrowerConfig } = await setUpFixture(deployAndConfigureContractsWithBorrower);
      await expect(creditLine.determineLoanTerms(
        ZERO_ADDRESS, // borrower
        borrowerConfig.minBorrowAmount,
        borrowerConfig.minDurationInPeriods
      )).to.be.revertedWithCustomError(creditLine, ERROR_NAME_ZERO_ADDRESS);
    });

    it("Is reverted if the borrow amount is zero", async () => {
      const { creditLine, borrowerConfig } = await setUpFixture(deployAndConfigureContractsWithBorrower);
      await expect(creditLine.determineLoanTerms(
        borrower.address,
        0, // borrowAmount
        borrowerConfig.minDurationInPeriods
      )).to.be.revertedWithCustomError(creditLine, ERROR_NAME_INVALID_AMOUNT);
    });

    it("Is reverted if the borrower configuration has been expired", async () => {
      const fixture = await setUpFixture(deployAndConfigureContractsWithBorrower);
      const { creditLine, creditLineUnderAdmin, borrowerConfig } = fixture;
      const borrowerConfigNew = { ...borrowerConfig };

      borrowerConfigNew.expiration = BigInt(await getLatestBlockTimestamp()) - NEGATIVE_TIME_OFFSET - 1n;
      await proveTx(creditLineUnderAdmin.configureBorrower(borrower.address, borrowerConfigNew));

      await expect(creditLine.determineLoanTerms(
        borrower.address,
        borrowerConfig.minBorrowAmount, // borrowAmount
        borrowerConfig.minDurationInPeriods // durationInPeriods
      )).to.be.revertedWithCustomError(creditLine, ERROR_NAME_BORROWER_CONFIGURATION_EXPIRED);
    });

    it("Is reverted if the borrow amount is greater than the max allowed one", async () => {
      const { creditLine, borrowerConfig } = await setUpFixture(deployAndConfigureContractsWithBorrower);
      await expect(creditLine.determineLoanTerms(
        borrower.address,
        borrowerConfig.maxBorrowAmount + 1n, // borrowAmount
        borrowerConfig.minDurationInPeriods // durationInPeriods
      )).to.be.revertedWithCustomError(creditLine, ERROR_NAME_INVALID_AMOUNT);
    });

    it("Is reverted if the borrow amount is less than the min allowed one", async () => {
      const { creditLine, borrowerConfig } = await setUpFixture(deployAndConfigureContractsWithBorrower);
      await expect(creditLine.determineLoanTerms(
        borrower.address,
        borrowerConfig.minBorrowAmount - 1n, // borrowAmount
        borrowerConfig.minDurationInPeriods // durationInPeriods
      )).to.be.revertedWithCustomError(creditLine, ERROR_NAME_INVALID_AMOUNT);
    });

    it("Is reverted if the loan duration is less than the min allowed one", async () => {
      const { creditLine, borrowerConfig } = await setUpFixture(deployAndConfigureContractsWithBorrower);
      await expect(creditLine.determineLoanTerms(
        borrower.address,
        borrowerConfig.minBorrowAmount, // borrowAmount
        borrowerConfig.minDurationInPeriods - 1n // durationInPeriods
      )).to.be.revertedWithCustomError(creditLine, ERROR_NAME_LOAN_DURATION_OUT_OF_RANGE);
    });

    it("Is reverted if the loan duration is greater than the max allowed one", async () => {
      const { creditLine, borrowerConfig } = await setUpFixture(deployAndConfigureContractsWithBorrower);
      await expect(creditLine.determineLoanTerms(
        borrower.address,
        borrowerConfig.minBorrowAmount, // borrowAmount
        borrowerConfig.maxDurationInPeriods + 1n // durationInPeriods
      )).to.be.revertedWithCustomError(creditLine, ERROR_NAME_LOAN_DURATION_OUT_OF_RANGE);
    });

    it("Is reverted if the borrow policy is 'SingleActiveLoan' but there is another active loan", async () => {
      const fixture = await setUpFixture(deployAndConfigureContractsWithBorrower);
      const { creditLine, creditLineUnderAdmin, borrowerConfig } = fixture;
      const borrowerConfigNew = { ...borrowerConfig, borrowPolicy: BorrowPolicy.SingleActiveLoan };
      const borrowerState: BorrowerState = {
        ...defaultBorrowerState,
        activeLoanCount: 1n
      };
      await proveTx(creditLineUnderAdmin.configureBorrower(borrower.address, borrowerConfigNew));
      await proveTx(creditLineUnderAdmin.setBorrowerState(borrower.address, borrowerState));

      await expect(creditLine.determineLoanTerms(
        borrower.address,
        borrowerConfig.minBorrowAmount, // borrowAmount
        borrowerConfig.minDurationInPeriods // durationInPeriods
      )).to.revertedWithCustomError(creditLine, ERROR_NAME_LIMIT_VIOLATION_ON_SINGLE_ACTIVE_LOAN);
    });

    it("Is reverted if the borrow policy is 'TotalActiveAmountLimit' but total amount excess happens", async () => {
      const fixture = await setUpFixture(deployAndConfigureContractsWithBorrower);
      const { creditLine, creditLineUnderAdmin, borrowerConfig } = fixture;
      const borrowerConfigNew = { ...borrowerConfig, borrowPolicy: BorrowPolicy.TotalActiveAmountLimit };
      const borrowerState: BorrowerState = {
        ...defaultBorrowerState,
        totalActiveLoanAmount: borrowerConfig.maxBorrowAmount - BORROW_AMOUNT + 1n
      };
      await proveTx(creditLineUnderAdmin.configureBorrower(borrower.address, borrowerConfigNew));
      await proveTx(creditLineUnderAdmin.setBorrowerState(borrower.address, borrowerState));

      await expect(creditLine.determineLoanTerms(
        borrower.address,
        BORROW_AMOUNT,
        borrowerConfig.minDurationInPeriods // durationInPeriods
      )).to.revertedWithCustomError(
        creditLine,
        ERROR_NAME_LIMIT_VIOLATION_ON_TOTAL_ACTIVE_LOAN_AMOUNT
      ).withArgs(borrowerState.totalActiveLoanAmount + BigInt(BORROW_AMOUNT));
    });
  });

  describe("Function 'calculateAddonAmount()'", async () => {
    it("Returns correct values", async () => {
      const { creditLine } = await setUpFixture(deployAndConfigureContractsWithBorrower);
      const durationInPeriods = INTEREST_RATE_FACTOR / 2n / MIN_ADDON_PERIOD_RATE;
      const actualValue = await creditLine.calculateAddonAmount(
        BORROW_AMOUNT,
        durationInPeriods,
        MIN_ADDON_FIXED_RATE,
        MIN_ADDON_PERIOD_RATE,
        INTEREST_RATE_FACTOR
      );

      const expectedValue = calculateAddonAmount(
        BORROW_AMOUNT,
        durationInPeriods,
        MIN_ADDON_FIXED_RATE,
        MIN_ADDON_PERIOD_RATE,
        INTEREST_RATE_FACTOR
      );

      expect(actualValue).to.eq(expectedValue);
    });
  });
});
