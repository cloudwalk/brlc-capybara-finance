import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { connect, getAddress, proveTx } from "../../test-utils/eth";
import { checkEquality, setUpFixture } from "../../test-utils/common";

const ZERO_ADDRESS = ethers.ZeroAddress;

interface CreditLineConfig {
  minBorrowAmount: number;
  maxBorrowAmount: number;
  minInterestRatePrimary: number;
  maxInterestRatePrimary: number;
  minInterestRateSecondary: number;
  maxInterestRateSecondary: number;
  minDurationInPeriods: number;
  maxDurationInPeriods: number;
  minAddonFixedRate: number;
  maxAddonFixedRate: number;
  minAddonPeriodRate: number;
  maxAddonPeriodRate: number;

  [key: string]: number; // Index signature
}

interface LoanState {
  programId: number;
  borrowAmount: number;
  addonAmount: number;
  startTimestamp: number;
  durationInPeriods: number;
  token: string;
  borrower: string;
  interestRatePrimary: number;
  interestRateSecondary: number;
  repaidAmount: number;
  trackedBalance: number;
  trackedTimestamp: number;
  freezeTimestamp: number;
}

interface BorrowerConfig {
  expiration: number;
  minDurationInPeriods: number;
  maxDurationInPeriods: number;
  minBorrowAmount: number;
  maxBorrowAmount: number;
  borrowPolicy: BorrowPolicy;
  interestRatePrimary: number;
  interestRateSecondary: number;
  addonFixedRate: number;
  addonPeriodRate: number;

  [key: string]: number | BorrowPolicy; // Index signature
}

interface BorrowerState {
  activeLoanCount: number;
  closedLoanCount: number;
  totalActiveLoanAmount: bigint;
  totalClosedLoanAmount: bigint;

  [key: string]: number | bigint; // Index signature
}

interface MigrationState {
  nextLoanId: bigint;
  done: boolean;
  borrowerConfigurationPaused: boolean;

  [key: string]: bigint | boolean; // Index signature
}

interface LoanTerms {
  token: string;
  durationInPeriods: number;
  interestRatePrimary: number;
  interestRateSecondary: number;
  addonAmount: number;

  [key: string]: string | number; // Index signature
}

interface Version {
  major: number;
  minor: number;
  patch: number;

  [key: string]: number; // Indexing signature to ensure that fields are iterated over in a key-value style
}

enum BorrowPolicy {
  SingleActiveLoan = 0,
  MultipleActiveLoans = 1,
  TotalActiveAmountLimit = 2
}

const defaultLoanState: LoanState = {
  programId: 0,
  borrowAmount: 0,
  addonAmount: 0,
  startTimestamp: 0,
  durationInPeriods: 0,
  token: ZERO_ADDRESS,
  borrower: ZERO_ADDRESS,
  interestRatePrimary: 0,
  interestRateSecondary: 0,
  repaidAmount: 0,
  trackedBalance: 0,
  trackedTimestamp: 0,
  freezeTimestamp: 0
};

const defaultBorrowerState: BorrowerState = {
  activeLoanCount: 0,
  closedLoanCount: 0,
  totalActiveLoanAmount: 0n,
  totalClosedLoanAmount: 0n
};

const defaultMigrationState: MigrationState = {
  nextLoanId: 0n,
  done: false,
  borrowerConfigurationPaused: false
};

function maxUintForBits(numberOfBits: number): bigint {
  return 2n ** BigInt(numberOfBits) - 1n;
}

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

const OWNER_ROLE = ethers.id("OWNER_ROLE");
const ADMIN_ROLE = ethers.id("ADMIN_ROLE");
const PAUSER_ROLE = ethers.id("PAUSER_ROLE");

const DEFAULT_MIN_DURATION_IN_PERIODS = 7;
const DEFAULT_MAX_DURATION_IN_PERIODS = 14;
const DEFAULT_MIN_BORROW_AMOUNT = 10_000_000;
const DEFAULT_MAX_BORROW_AMOUNT = 100_000_000;
const DEFAULT_MIN_INTEREST_RATE_PRIMARY = 1;
const DEFAULT_MAX_INTEREST_RATE_PRIMARY = 10;
const DEFAULT_MIN_INTEREST_RATE_SECONDARY = 10;
const DEFAULT_MAX_INTEREST_RATE_SECONDARY = 20;
const DEFAULT_MIN_ADDON_FIXED_RATE = 1;
const DEFAULT_MAX_ADDON_FIXED_RATE = 10;
const DEFAULT_MIN_ADDON_PERIOD_RATE = 1;
const DEFAULT_MAX_ADDON_PERIOD_RATE = 10;
const DEFAULT_EXPIRATION_TIME = 4294967295;
const INTEREST_RATE_FACTOR = 10 ** 9;
const BORROWERS_NUMBER = 3;
const BORROW_AMOUNT = 100_000;
const DEFAULT_LOAN_ID = 123;
const DEFAULT_ADDON_AMOUNT = 321;
const DEFAULT_REPAY_AMOUNT = 322;
const EXPECTED_VERSION: Version = {
  major: 1,
  minor: 0,
  patch: 0
};

describe("Contract 'CreditLineConfigurable'", async () => {
  let creditLineFactory: ContractFactory;
  let marketFactory: ContractFactory;

  let market: Contract;

  let deployer: HardhatEthersSigner;
  let lender: HardhatEthersSigner;
  let admin: HardhatEthersSigner;
  let token: HardhatEthersSigner;
  let attacker: HardhatEthersSigner;
  let borrower: HardhatEthersSigner;
  let users: HardhatEthersSigner[];

  let marketAddress: string;

  before(async () => {
    [deployer, lender, admin, token, attacker, borrower, ...users] =
      await ethers.getSigners();

    creditLineFactory = await ethers.getContractFactory("CreditLineConfigurableTestable");
    creditLineFactory.connect(deployer); // Explicitly specifying the deployer account

    marketFactory = await ethers.getContractFactory("LendingMarketMock");
    marketFactory = marketFactory.connect(deployer);

    market = await marketFactory.deploy() as Contract;
    await market.waitForDeployment();
    market = connect(market, deployer); // Explicitly specifying the initial account
    marketAddress = getAddress(market);
  });

  function createDefaultCreditLineConfiguration(): CreditLineConfig {
    return {
      minDurationInPeriods: DEFAULT_MIN_DURATION_IN_PERIODS,
      maxDurationInPeriods: DEFAULT_MAX_DURATION_IN_PERIODS,
      minBorrowAmount: DEFAULT_MIN_BORROW_AMOUNT,
      maxBorrowAmount: DEFAULT_MAX_BORROW_AMOUNT,
      minInterestRatePrimary: DEFAULT_MIN_INTEREST_RATE_PRIMARY,
      maxInterestRatePrimary: DEFAULT_MAX_INTEREST_RATE_PRIMARY,
      minInterestRateSecondary: DEFAULT_MIN_INTEREST_RATE_SECONDARY,
      maxInterestRateSecondary: DEFAULT_MAX_INTEREST_RATE_SECONDARY,
      minAddonFixedRate: DEFAULT_MIN_ADDON_FIXED_RATE,
      maxAddonFixedRate: DEFAULT_MAX_ADDON_FIXED_RATE,
      minAddonPeriodRate: DEFAULT_MIN_ADDON_PERIOD_RATE,
      maxAddonPeriodRate: DEFAULT_MAX_ADDON_PERIOD_RATE
    };
  }

  function createDefaultBorrowerConfiguration(
    borrowPolicy: BorrowPolicy = BorrowPolicy.MultipleActiveLoans
  ): BorrowerConfig {
    return {
      expiration: DEFAULT_EXPIRATION_TIME,
      minDurationInPeriods: DEFAULT_MIN_DURATION_IN_PERIODS,
      maxDurationInPeriods: DEFAULT_MAX_DURATION_IN_PERIODS,
      minBorrowAmount: DEFAULT_MIN_BORROW_AMOUNT,
      maxBorrowAmount: DEFAULT_MAX_BORROW_AMOUNT,
      borrowPolicy: borrowPolicy,
      interestRatePrimary: DEFAULT_MIN_INTEREST_RATE_PRIMARY,
      interestRateSecondary: DEFAULT_MIN_INTEREST_RATE_SECONDARY,
      addonFixedRate: DEFAULT_MIN_ADDON_FIXED_RATE,
      addonPeriodRate: DEFAULT_MIN_ADDON_PERIOD_RATE
    };
  }

  function createLoanTerms(
    borrowAmount: number,
    durationInPeriods: number,
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
      addonAmount: addonAmount
    };
  }

  async function prepareLoan(props: { trackedBalance?: number } = {}): Promise<LoanState> {
    const loanState: LoanState = {
      ...defaultLoanState,
      borrowAmount: BORROW_AMOUNT,
      addonAmount: DEFAULT_ADDON_AMOUNT,
      borrower: borrower.address,
      trackedBalance: props.trackedBalance ?? 0
    };
    await proveTx(market.mockLoanState(DEFAULT_LOAN_ID, loanState));

    return loanState;
  }

  function calculateAddonAmount(
    borrowAmount: number,
    durationInPeriods: number,
    addonFixedRate: number,
    addonPeriodRate: number,
    interestRateFactor: number
  ): number {
    const addonRate = addonPeriodRate * durationInPeriods + addonFixedRate;
    return Math.floor((borrowAmount * addonRate) / (interestRateFactor - addonRate));
  }

  async function prepareDataForBatchBorrowerConfig(borrowersNumber: number): Promise<{
    borrowers: string[];
    configs: BorrowerConfig[];
  }> {
    const config = createDefaultBorrowerConfiguration();
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
    configs.forEach((config, index) => config.maxBorrowAmount + index);

    return {
      borrowers,
      configs
    };
  }

  async function deployCreditLine(): Promise<{ creditLine: Contract }> {
    let creditLine = await upgrades.deployProxy(creditLineFactory, [
      lender.address,
      marketAddress,
      token.address
    ]);
    await creditLine.waitForDeployment();
    creditLine = connect(creditLine, lender); // Explicitly specifying the initial account

    await proveTx(creditLine.grantRole(PAUSER_ROLE, lender.address));

    return { creditLine };
  }

  async function deployAndConfigureCreditLine(): Promise<{
    creditLine: Contract;
    creditLineUnderAdmin: Contract;
  }> {
    const { creditLine } = await deployCreditLine();

    await proveTx(creditLine.grantRole(ADMIN_ROLE, admin.address));
    const creditLineUnderAdmin = connect(creditLine, admin);
    const initialCreditLineConfig = createDefaultCreditLineConfiguration();
    await proveTx(creditLine.configureCreditLine(initialCreditLineConfig));

    return { creditLine, creditLineUnderAdmin };
  }

  async function deployAndConfigureCreditLineWithBorrower(): Promise<{
    creditLine: Contract;
    creditLineUnderAdmin: Contract;
  }> {
    const { creditLine, creditLineUnderAdmin } = await deployAndConfigureCreditLine();

    const borrowerConfig = createDefaultBorrowerConfiguration();
    await proveTx(creditLineUnderAdmin.configureBorrower(borrower.address, borrowerConfig));

    return { creditLine, creditLineUnderAdmin };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { creditLine } = await setUpFixture(deployCreditLine);
      expect(await creditLine.hasRole(OWNER_ROLE, lender.address)).to.eq(true);
      expect(await creditLine.isAdmin(lender.address)).to.eq(false);
      expect(await creditLine.token()).to.eq(token.address);
      expect(await creditLine.market()).to.eq(marketAddress);
      expect(await creditLine.paused()).to.eq(false);
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
      await expect(upgrades.deployProxy(creditLineFactory, [
        marketAddress,
        lender.address,
        ZERO_ADDRESS // token
      ])).to.be.revertedWithCustomError(creditLineFactory, ERROR_NAME_ZERO_ADDRESS);
    });

    it("Is reverted if called a second time", async () => {
      const { creditLine } = await setUpFixture(deployCreditLine);

      await expect(creditLine.initialize(marketAddress, lender.address, token.address))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ALREADY_INITIALIZED);
    });
  });

  describe("Function '$__VERSION()'", async () => {
    it("Returns expected values", async () => {
      const { creditLine } = await setUpFixture(deployCreditLine);
      const creditLineVersion = await creditLine.$__VERSION();
      checkEquality(creditLineVersion, EXPECTED_VERSION);
    });
  });

  describe("Function 'pause()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { creditLine } = await setUpFixture(deployCreditLine);

      await expect(creditLine.pause())
        .to.emit(creditLine, EVENT_NAME_PAUSED)
        .withArgs(lender.address);
      expect(await creditLine.paused()).to.eq(true);
    });

    it("Is reverted if the caller is not the pauser", async () => {
      const { creditLine } = await setUpFixture(deployCreditLine);

      await expect(connect(creditLine, attacker).pause())
        .to.be.revertedWithCustomError(creditLineFactory, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(attacker.address, PAUSER_ROLE);
    });

    it("Is reverted if the contract is already paused", async () => {
      const { creditLine } = await setUpFixture(deployCreditLine);

      await proveTx(creditLine.pause());
      await expect(creditLine.pause())
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ENFORCED_PAUSED);
    });
  });

  describe("Function 'unpause()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { creditLine } = await setUpFixture(deployCreditLine);

      await proveTx(creditLine.pause());
      expect(await creditLine.paused()).to.eq(true);

      await expect(creditLine.unpause())
        .to.emit(creditLine, EVENT_NAME_UNPAUSED)
        .withArgs(lender.address);

      expect(await creditLine.paused()).to.eq(false);
    });

    it("Is reverted if the caller is not the owner", async () => {
      const { creditLine } = await setUpFixture(deployCreditLine);

      await expect(connect(creditLine, attacker).unpause())
        .to.be.revertedWithCustomError(creditLineFactory, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(attacker.address, PAUSER_ROLE);
    });

    it("Is reverted if the contract is not paused yet", async () => {
      const { creditLine } = await setUpFixture(deployCreditLine);

      await expect(creditLine.unpause())
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_NOT_PAUSED);
    });
  });

  describe("Function 'configureCreditLine()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { creditLine } = await setUpFixture(deployCreditLine);
      const config = createDefaultCreditLineConfiguration();

      await expect(creditLine.configureCreditLine(config))
        .to.emit(creditLine, EVENT_NAME_CREDIT_LINE_CONFIGURED)
        .withArgs(getAddress(creditLine));

      const onChainConfig: CreditLineConfig = await creditLine.creditLineConfiguration();

      checkEquality(onChainConfig, config);
    });

    it("Is reverted if the caller is not the owner", async () => {
      const { creditLine } = await setUpFixture(deployCreditLine);
      const config = createDefaultCreditLineConfiguration();

      await expect(connect(creditLine, attacker).configureCreditLine(config))
        .to.be.revertedWithCustomError(creditLineFactory, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(attacker.address, OWNER_ROLE);

      // Even an admin cannot configure a credit line
      await proveTx(creditLine.grantRole(ADMIN_ROLE, admin.address));
      await expect(connect(creditLine, admin).configureCreditLine(config))
        .to.be.revertedWithCustomError(creditLineFactory, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(admin.address, OWNER_ROLE);
    });

    it("Is reverted if the min borrow amount is bigger than the max one", async () => {
      const { creditLine } = await setUpFixture(deployCreditLine);
      const config = createDefaultCreditLineConfiguration();

      config.minBorrowAmount = config.maxBorrowAmount + 1;

      await expect(creditLine.configureCreditLine(config))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_INVALID_CREDIT_LINE_CONFIGURATION);
    });

    it("Is reverted if the min loan duration is bigger than the max one", async () => {
      const { creditLine } = await setUpFixture(deployCreditLine);
      const config = createDefaultCreditLineConfiguration();

      config.minDurationInPeriods = config.maxDurationInPeriods + 1;

      await expect(creditLine.configureCreditLine(config))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_INVALID_CREDIT_LINE_CONFIGURATION);
    });

    it("Is reverted if the min primary interest rate is bigger than the max one", async () => {
      const { creditLine } = await setUpFixture(deployCreditLine);
      const config = createDefaultCreditLineConfiguration();

      config.minInterestRatePrimary = config.maxInterestRatePrimary + 1;

      await expect(creditLine.configureCreditLine(config))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_INVALID_CREDIT_LINE_CONFIGURATION);
    });

    it("Is reverted if the min secondary interest rate is bigger than the max one", async () => {
      const { creditLine } = await setUpFixture(deployCreditLine);
      const config = createDefaultCreditLineConfiguration();

      config.minInterestRateSecondary = config.maxInterestRateSecondary + 1;

      await expect(creditLine.configureCreditLine(config))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_INVALID_CREDIT_LINE_CONFIGURATION);
    });

    it("Is reverted if the min addon fixed rate is bigger than the max one", async () => {
      const { creditLine } = await setUpFixture(deployCreditLine);
      const config = createDefaultCreditLineConfiguration();

      config.minAddonFixedRate = config.maxAddonFixedRate + 1;

      await expect(creditLine.configureCreditLine(config))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_INVALID_CREDIT_LINE_CONFIGURATION);
    });

    it("Is reverted if the min addon period rate is bigger than the max one", async () => {
      const { creditLine } = await setUpFixture(deployCreditLine);
      const config = createDefaultCreditLineConfiguration();

      config.minAddonPeriodRate = config.maxAddonPeriodRate + 1;

      await expect(creditLine.configureCreditLine(config))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_INVALID_CREDIT_LINE_CONFIGURATION);
    });
  });

  describe("Function 'configureBorrower()'", async () => {
    it("Executes as expected and emits the correct event if is called by an admin", async () => {
      const { creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLine);
      const config = createDefaultBorrowerConfiguration();

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, config))
        .to.emit(creditLineUnderAdmin, EVENT_NAME_BORROWER_CONFIGURED)
        .withArgs(getAddress(creditLineUnderAdmin), borrower.address);

      const onChainConfig: BorrowerConfig = await creditLineUnderAdmin.getBorrowerConfiguration(borrower.address);

      checkEquality(onChainConfig, config);
    });

    it("Is reverted if the caller is not an admin", async () => {
      const { creditLine } = await setUpFixture(deployAndConfigureCreditLine);
      const config = createDefaultBorrowerConfiguration();

      await expect(connect(creditLine, attacker).configureBorrower(attacker.address, config))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(attacker.address, ADMIN_ROLE);

      // Even the lender cannot configure a borrower
      await expect(connect(creditLine, lender).configureBorrower(attacker.address, config))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(lender.address, ADMIN_ROLE);
    });

    it("Is reverted if the contract is paused", async () => {
      const { creditLine, creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLine);
      const config = createDefaultBorrowerConfiguration();

      await proveTx(creditLine.pause());

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, config))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the borrower configuration is paused", async () => {
      const { creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLine);
      const config = createDefaultBorrowerConfiguration();
      await proveTx(creditLineUnderAdmin.setMigrationState({
        ...defaultMigrationState,
        borrowerConfigurationPaused: true
      }));

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, config))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the borrower address is zero", async () => {
      const { creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLine);
      const config = createDefaultBorrowerConfiguration();

      await expect(creditLineUnderAdmin.configureBorrower(
        ZERO_ADDRESS, // borrower
        config
      )).to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_ZERO_ADDRESS);
    });

    it("Is reverted if the min borrow amount is greater than the max one", async () => {
      const { creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLine);
      const config = createDefaultBorrowerConfiguration();

      config.minBorrowAmount = DEFAULT_MAX_BORROW_AMOUNT + 1;

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, config))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_INVALID_BORROWER_CONFIGURATION);
    });

    it("Is reverted if the min borrow amount is less than credit line`s one", async () => {
      const { creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLine);
      const config = createDefaultBorrowerConfiguration();

      config.minBorrowAmount = DEFAULT_MIN_BORROW_AMOUNT - 1;

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, config))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_INVALID_BORROWER_CONFIGURATION);
    });

    it("Is reverted if the max borrow amount is greater than credit line`s one", async () => {
      const { creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLine);
      const config = createDefaultBorrowerConfiguration();

      config.maxBorrowAmount = DEFAULT_MAX_BORROW_AMOUNT + 1;

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, config))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_INVALID_BORROWER_CONFIGURATION);
    });

    it("Is reverted if the min duration in periods is greater than the max one", async () => {
      const { creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLine);
      const config = createDefaultBorrowerConfiguration();

      config.minDurationInPeriods = DEFAULT_MAX_DURATION_IN_PERIODS + 1;

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, config))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_INVALID_BORROWER_CONFIGURATION);
    });

    it("Is reverted if the min loan duration is less than credit line`s one", async () => {
      const { creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLine);
      const config = createDefaultBorrowerConfiguration();

      config.minDurationInPeriods = DEFAULT_MIN_DURATION_IN_PERIODS - 1;

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, config))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_INVALID_BORROWER_CONFIGURATION);
    });

    it("Is reverted if the max loan duration is greater than credit line`s one", async () => {
      const { creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLine);
      const config = createDefaultBorrowerConfiguration();

      config.maxDurationInPeriods = DEFAULT_MAX_DURATION_IN_PERIODS + 1;

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, config))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_INVALID_BORROWER_CONFIGURATION);
    });

    it("Is reverted if the primary interest rate is less than credit line`s minimum one", async () => {
      const { creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLine);
      const config = createDefaultBorrowerConfiguration();

      config.interestRatePrimary = DEFAULT_MIN_INTEREST_RATE_PRIMARY - 1;

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, config))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_INVALID_BORROWER_CONFIGURATION);
    });

    it("Is reverted if the primary interest rate is greater than credit line`s maximum one", async () => {
      const { creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLine);
      const config = createDefaultBorrowerConfiguration();

      config.interestRatePrimary = DEFAULT_MAX_INTEREST_RATE_PRIMARY + 1;

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, config))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_INVALID_BORROWER_CONFIGURATION);
    });

    it("Is reverted if the secondary interest rate is less than credit line`s minimum one", async () => {
      const { creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLine);
      const config = createDefaultBorrowerConfiguration();

      config.interestRateSecondary = DEFAULT_MIN_INTEREST_RATE_SECONDARY - 1;

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, config))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_INVALID_BORROWER_CONFIGURATION);
    });

    it("Is reverted if the secondary interest rate is greater than credit line`s maximum one", async () => {
      const { creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLine);
      const config = createDefaultBorrowerConfiguration();

      config.interestRateSecondary = DEFAULT_MAX_INTEREST_RATE_SECONDARY + 1;

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, config))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_INVALID_BORROWER_CONFIGURATION);
    });

    it("Is reverted if the addon fixed rate is less than credit line`s minimum one", async () => {
      const { creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLine);
      const config = createDefaultBorrowerConfiguration();

      config.addonFixedRate = DEFAULT_MIN_ADDON_FIXED_RATE - 1;

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, config))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_INVALID_BORROWER_CONFIGURATION);
    });

    it("Is reverted if the addon fixed rate is greater than credit line`s maximum one", async () => {
      const { creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLine);
      const config = createDefaultBorrowerConfiguration();

      config.addonFixedRate = DEFAULT_MAX_ADDON_FIXED_RATE + 1;

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, config))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_INVALID_BORROWER_CONFIGURATION);
    });

    it("Is reverted if the addon period rate is less than credit line`s minimum one", async () => {
      const { creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLine);
      const config = createDefaultBorrowerConfiguration();

      config.addonPeriodRate = DEFAULT_MIN_ADDON_PERIOD_RATE - 1;

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, config))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_INVALID_BORROWER_CONFIGURATION);
    });

    it("Is reverted if the addon period rate is greater than credit line`s maximum one", async () => {
      const { creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLine);
      const config = createDefaultBorrowerConfiguration();

      config.addonPeriodRate = DEFAULT_MAX_ADDON_PERIOD_RATE + 1;

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, config))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_INVALID_BORROWER_CONFIGURATION);
    });
  });

  describe("Function 'configureBorrowers()'", async () => {
    it("Executes as expected and emits correct events if is called by an admin", async () => {
      const { creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLine);
      const { borrowers, configs } = await prepareDataForBatchBorrowerConfig(BORROWERS_NUMBER);

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

    it("Is reverted if the caller is not an admin", async () => {
      const { creditLine } = await setUpFixture(deployAndConfigureCreditLine);
      const { borrowers, configs } = await prepareDataForBatchBorrowerConfig(BORROWERS_NUMBER);

      await expect(connect(creditLine, attacker).configureBorrowers(borrowers, configs))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(attacker.address, ADMIN_ROLE);

      // Even the lender cannot configure a borrower
      await expect(connect(creditLine, lender).configureBorrowers(borrowers, configs))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(lender.address, ADMIN_ROLE);
    });

    it("Is reverted if the contract is paused", async () => {
      const { creditLine, creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLine);
      const { borrowers, configs } = await prepareDataForBatchBorrowerConfig(BORROWERS_NUMBER);

      await proveTx(creditLine.pause());

      await expect(creditLineUnderAdmin.configureBorrowers(borrowers, configs))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the borrower configuration is paused", async () => {
      const { creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLine);
      const { borrowers, configs } = await prepareDataForBatchBorrowerConfig(BORROWERS_NUMBER);
      await proveTx(creditLineUnderAdmin.setMigrationState({
        ...defaultMigrationState,
        borrowerConfigurationPaused: true
      }));

      await expect(creditLineUnderAdmin.configureBorrowers(borrowers, configs))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the length of arrays is different", async () => {
      const { creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLine);
      const { borrowers, configs } = await prepareDataForBatchBorrowerConfig(BORROWERS_NUMBER);

      borrowers.push(attacker.address);

      await expect(creditLineUnderAdmin.configureBorrowers(borrowers, configs))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_ARRAYS_LENGTH_MISMATCH);
    });
  });

  describe("Function 'onBeforeLoanTaken()'", async () => {
    describe("Before the limitation logic migration", async () => {
      async function executeAndCheck(borrowPolicy: BorrowPolicy) {
        const { creditLine, creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);
        const borrowerConfig = createDefaultBorrowerConfiguration(borrowPolicy);

        await proveTx(creditLineUnderAdmin.configureBorrower(borrower.address, borrowerConfig));
        const loanState: LoanState = await prepareLoan();

        await expect(market.callOnBeforeLoanTakenCreditLine(getAddress(creditLine), DEFAULT_LOAN_ID))
          .to.emit(market, EVENT_NAME_HOOK_CALL_RESULT)
          .withArgs(true);

        const expectedBorrowerConfig: BorrowerConfig = createDefaultBorrowerConfiguration();
        expectedBorrowerConfig.borrowPolicy = borrowPolicy;

        switch (borrowPolicy) {
          case BorrowPolicy.TotalActiveAmountLimit:
            expectedBorrowerConfig.maxBorrowAmount -= loanState.borrowAmount;
            break;
          case BorrowPolicy.SingleActiveLoan:
            expectedBorrowerConfig.maxBorrowAmount = 0;
            break;
          case BorrowPolicy.MultipleActiveLoans:
            expectedBorrowerConfig.maxBorrowAmount = DEFAULT_MAX_BORROW_AMOUNT;
            break;
        }

        const onChainBorrowerConfig: BorrowerConfig = await creditLine.getBorrowerConfiguration(borrower.address);

        checkEquality(onChainBorrowerConfig, expectedBorrowerConfig);
      }

      it("Executes as expected if the borrow policy is 'MultipleActiveLoans'", async () => {
        await executeAndCheck(BorrowPolicy.MultipleActiveLoans);
      });

      it("Executes as expected if the borrow policy is 'SingleActiveLoan'", async () => {
        await executeAndCheck(BorrowPolicy.SingleActiveLoan);
      });

      it("Executes as expected if the borrow policy is 'TotalActiveAmountLimit'", async () => {
        await executeAndCheck(BorrowPolicy.TotalActiveAmountLimit);
      });
    });
    describe("After the limitation logic migration", async () => {
      async function setUpCreditLine(
        creditLineUnderAdmin: Contract,
        borrowConfig: BorrowerConfig,
        borrowState: BorrowerState
      ): Promise<LoanState> {
        await proveTx(creditLineUnderAdmin.configureBorrower(borrower.address, borrowConfig));
        await proveTx(creditLineUnderAdmin.setBorrowerState(borrower.address, borrowState));
        await proveTx(creditLineUnderAdmin.setMigrationState({ ...defaultMigrationState, done: true }));
        return prepareLoan();
      }

      async function executeAndCheck(
        borrowPolicy: BorrowPolicy
      ) {
        const { creditLine, creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);
        const expectedBorrowerConfig = createDefaultBorrowerConfiguration(borrowPolicy);
        const expectedBorrowerState: BorrowerState = {
          ...defaultBorrowerState,
          activeLoanCount: borrowPolicy == BorrowPolicy.SingleActiveLoan ? 0 : 123,
          totalActiveLoanAmount: BigInt(expectedBorrowerConfig.maxBorrowAmount)
        };
        if (borrowPolicy == BorrowPolicy.TotalActiveAmountLimit) {
          expectedBorrowerState.totalActiveLoanAmount -= BigInt(BORROW_AMOUNT);
        }
        expectedBorrowerState.closedLoanCount = Number(maxUintForBits(16)) - expectedBorrowerState.activeLoanCount - 1;
        expectedBorrowerState.totalClosedLoanAmount =
          maxUintForBits(64) - expectedBorrowerState.totalActiveLoanAmount - BigInt(BORROW_AMOUNT);

        const loanState: LoanState = await setUpCreditLine(
          creditLineUnderAdmin,
          expectedBorrowerConfig,
          expectedBorrowerState
        );

        await expect(market.callOnBeforeLoanTakenCreditLine(getAddress(creditLine), DEFAULT_LOAN_ID))
          .to.emit(market, EVENT_NAME_HOOK_CALL_RESULT)
          .withArgs(true);

        expectedBorrowerState.activeLoanCount += 1;
        expectedBorrowerState.totalActiveLoanAmount += BigInt(loanState.borrowAmount);
        const onChainBorrowerState: BorrowerState = await creditLine.getBorrowerState(borrower.address);
        checkEquality(onChainBorrowerState, expectedBorrowerState);
        const onChainBorrowerConfig: BorrowerConfig = await creditLine.getBorrowerConfiguration(borrower.address);
        checkEquality(onChainBorrowerConfig, expectedBorrowerConfig);
      }

      it("Executes as expected if the borrow policy is 'SingleActiveLoan'", async () => {
        await executeAndCheck(BorrowPolicy.SingleActiveLoan);
      });

      it("Executes as expected if the borrow policy is 'MultipleActiveLoan'", async () => {
        await executeAndCheck(BorrowPolicy.MultipleActiveLoans);
      });

      it("Executes as expected if the borrow policy is 'TotalActiveAmountLimit'", async () => {
        await executeAndCheck(BorrowPolicy.TotalActiveAmountLimit);
      });

      it("Is reverted if the caller is not the configured market", async () => {
        const { creditLine } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);

        await expect(creditLine.onBeforeLoanTaken(
          DEFAULT_LOAN_ID
        )).to.be.revertedWithCustomError(creditLine, ERROR_NAME_UNAUTHORIZED);
      });

      it("Is reverted if the contract is paused", async () => {
        const { creditLine } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);
        await proveTx(creditLine.pause());

        await expect(market.callOnBeforeLoanTakenCreditLine(getAddress(creditLine), DEFAULT_LOAN_ID))
          .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ENFORCED_PAUSED);
      });

      it("Is reverted if the borrow policy is 'SingleActiveLoan' but there is another active loan", async () => {
        const { creditLine, creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);
        const borrowerConfig = createDefaultBorrowerConfiguration(BorrowPolicy.SingleActiveLoan);
        const borrowerState: BorrowerState = {
          ...defaultBorrowerState,
          activeLoanCount: 1
        };
        await setUpCreditLine(creditLineUnderAdmin, borrowerConfig, borrowerState);

        await expect(market.callOnBeforeLoanTakenCreditLine(getAddress(creditLine), DEFAULT_LOAN_ID))
          .to.revertedWithCustomError(creditLine, ERROR_NAME_LIMIT_VIOLATION_ON_SINGLE_ACTIVE_LOAN);
      });

      it("Is reverted if the borrow policy is 'TotalActiveAmountLimit' but total amount excess happens", async () => {
        const { creditLine, creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);
        const borrowerConfig = createDefaultBorrowerConfiguration(BorrowPolicy.TotalActiveAmountLimit);
        const borrowerState: BorrowerState = {
          ...defaultBorrowerState,
          totalActiveLoanAmount: BigInt(borrowerConfig.maxBorrowAmount - BORROW_AMOUNT + 1)
        };
        await setUpCreditLine(creditLineUnderAdmin, borrowerConfig, borrowerState);

        await expect(market.callOnBeforeLoanTakenCreditLine(getAddress(creditLine), DEFAULT_LOAN_ID))
          .to.revertedWithCustomError(creditLine, ERROR_NAME_LIMIT_VIOLATION_ON_TOTAL_ACTIVE_LOAN_AMOUNT);
      });

      it("Is reverted if the result total number of loans is greater than 16-bit unsigned integer", async () => {
        const { creditLine, creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);
        const borrowerConfig = createDefaultBorrowerConfiguration(BorrowPolicy.MultipleActiveLoans);
        const borrowerState: BorrowerState = {
          ...defaultBorrowerState,
          activeLoanCount: 0,
          closedLoanCount: Number(maxUintForBits(16))
        };
        await setUpCreditLine(creditLineUnderAdmin, borrowerConfig, borrowerState);

        await expect(market.callOnBeforeLoanTakenCreditLine(getAddress(creditLine), DEFAULT_LOAN_ID))
          .to.revertedWithCustomError(creditLine, ERROR_NAME_BORROWER_STATE_OVERFLOW);
      });

      it("Is reverted if the result total amount of loans is greater than 64-bit unsigned integer", async () => {
        const { creditLine, creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);
        const borrowerConfig = createDefaultBorrowerConfiguration(BorrowPolicy.MultipleActiveLoans);
        const borrowerState: BorrowerState = {
          ...defaultBorrowerState,
          totalActiveLoanAmount: 0n,
          totalClosedLoanAmount: maxUintForBits(64) - BigInt(BORROW_AMOUNT - 1)
        };
        await setUpCreditLine(creditLineUnderAdmin, borrowerConfig, borrowerState);

        await expect(market.callOnBeforeLoanTakenCreditLine(getAddress(creditLine), DEFAULT_LOAN_ID))
          .to.revertedWithCustomError(creditLine, ERROR_NAME_BORROWER_STATE_OVERFLOW);
      });
    });
  });

  describe("Function onAfterLoanPayment()", async () => {
    describe("Before the limitation logic migration", async () => {
      describe("Executes as expected if", async () => {
        it("The borrow policy is 'MultipleActiveLoans'", async () => {
          const { creditLine } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);
          await prepareLoan();

          await expect(market.callOnAfterLoanPaymentCreditLine(
            getAddress(creditLine),
            DEFAULT_LOAN_ID,
            DEFAULT_REPAY_AMOUNT
          )).to.emit(
            market,
            EVENT_NAME_HOOK_CALL_RESULT
          ).withArgs(true);
        });

        it("The borrow policy is 'TotalActiveAmountLimit' and the loan tracked balance is not zero", async () => {
          const { creditLine, creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);
          const loanState: LoanState = await prepareLoan();

          const borrowerConfig: BorrowerConfig = createDefaultBorrowerConfiguration();
          borrowerConfig.borrowPolicy = BorrowPolicy.TotalActiveAmountLimit;
          await proveTx(creditLineUnderAdmin.configureBorrower(borrower.address, borrowerConfig));

          loanState.trackedBalance = DEFAULT_REPAY_AMOUNT;
          await proveTx(market.mockLoanState(DEFAULT_LOAN_ID, loanState));

          await expect(market.callOnAfterLoanPaymentCreditLine(
            getAddress(creditLine),
            DEFAULT_LOAN_ID,
            DEFAULT_REPAY_AMOUNT
          )).to.emit(
            market,
            EVENT_NAME_HOOK_CALL_RESULT
          ).withArgs(true);

          const configAfter: BorrowerConfig = await creditLine.getBorrowerConfiguration(borrower.address);
          expect(configAfter.maxBorrowAmount).to.eq(borrowerConfig.maxBorrowAmount);
        });

        it("The borrow policy is 'TotalActiveAmountLimit' and the loan tracked balance is zero", async () => {
          const { creditLine, creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);
          const loanState: LoanState = await prepareLoan();

          const borrowerConfig: BorrowerConfig = createDefaultBorrowerConfiguration();
          borrowerConfig.borrowPolicy = BorrowPolicy.TotalActiveAmountLimit;
          await proveTx(creditLineUnderAdmin.configureBorrower(borrower.address, borrowerConfig));

          loanState.trackedBalance = 0;
          await proveTx(market.mockLoanState(DEFAULT_LOAN_ID, loanState));

          await expect(market.callOnAfterLoanPaymentCreditLine(
            getAddress(creditLine),
            DEFAULT_LOAN_ID,
            DEFAULT_REPAY_AMOUNT
          )).to.emit(
            market,
            EVENT_NAME_HOOK_CALL_RESULT
          ).withArgs(true);

          const configAfter: BorrowerConfig = await creditLine.getBorrowerConfiguration(borrower.address);
          expect(configAfter.maxBorrowAmount).to.eq(borrowerConfig.maxBorrowAmount + loanState.borrowAmount);
        });
      });
    });
    describe("After the limitation logic migration", async () => {
      it("Executes as expected if the loan tracked balance is not zero", async () => {
        const { creditLine } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);
        await proveTx(creditLine.setMigrationState({ ...defaultMigrationState, done: true }));
        await prepareLoan({ trackedBalance: 123 });
        const expectedBorrowerState: BorrowerState = { ...defaultBorrowerState };

        await expect(market.callOnAfterLoanPaymentCreditLine(
          getAddress(creditLine),
          DEFAULT_LOAN_ID,
          DEFAULT_REPAY_AMOUNT
        )).to.emit(
          market,
          EVENT_NAME_HOOK_CALL_RESULT
        ).withArgs(true);

        const actualBorrowerState = await creditLine.getBorrowerState(borrower.address);
        checkEquality(actualBorrowerState, expectedBorrowerState);
      });

      it("Executes as expected if the loan tracked balance is zero", async () => {
        const { creditLine } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);
        await proveTx(creditLine.setMigrationState({ ...defaultMigrationState, done: true }));
        const loanState: LoanState = await prepareLoan({ trackedBalance: 0 });
        const expectedBorrowerState: BorrowerState = {
          ...defaultBorrowerState,
          activeLoanCount: 123,
          closedLoanCount: 456,
          totalActiveLoanAmount: maxUintForBits(64),
          totalClosedLoanAmount: maxUintForBits(64) - BigInt(loanState.borrowAmount)
        };
        await proveTx(creditLine.setBorrowerState(borrower.address, expectedBorrowerState));

        await expect(market.callOnAfterLoanPaymentCreditLine(
          getAddress(creditLine),
          DEFAULT_LOAN_ID,
          DEFAULT_REPAY_AMOUNT
        )).to.emit(
          market,
          EVENT_NAME_HOOK_CALL_RESULT
        ).withArgs(true);
        expectedBorrowerState.activeLoanCount -= 1;
        expectedBorrowerState.closedLoanCount += 1;
        expectedBorrowerState.totalActiveLoanAmount -= BigInt(loanState.borrowAmount);
        expectedBorrowerState.totalClosedLoanAmount += BigInt(loanState.borrowAmount);

        const actualBorrowerState = await creditLine.getBorrowerState(borrower.address);
        checkEquality(actualBorrowerState, expectedBorrowerState);
      });

      it("Is reverted if caller is not the market", async () => {
        const { creditLine } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);

        await expect(connect(creditLine, attacker).onAfterLoanPayment(DEFAULT_LOAN_ID, DEFAULT_REPAY_AMOUNT))
          .to.be.revertedWithCustomError(creditLine, ERROR_NAME_UNAUTHORIZED);
      });

      it("Is reverted if contract is paused", async () => {
        const { creditLine } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);
        await proveTx(creditLine.pause());

        await expect(market.callOnAfterLoanPaymentCreditLine(
          getAddress(creditLine),
          DEFAULT_LOAN_ID,
          DEFAULT_REPAY_AMOUNT
        )).to.be.revertedWithCustomError(creditLine, ERROR_NAME_ENFORCED_PAUSED);
      });
    });
  });

  describe("Function 'onAfterLoanRevocation()'", async () => {
    describe("Before the limitation logic migration", async () => {
      it("Executes as expected", async () => {
        const { creditLine, creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);
        const loanState: LoanState = await prepareLoan();
        const borrowerConfig: BorrowerConfig = createDefaultBorrowerConfiguration();
        borrowerConfig.borrowPolicy = BorrowPolicy.TotalActiveAmountLimit;
        await proveTx(creditLineUnderAdmin.configureBorrower(borrower.address, borrowerConfig));

        // borrow policy == iterate
        await expect(market.callOnAfterLoanRevocationCreditLine(getAddress(creditLine), DEFAULT_LOAN_ID))
          .to.emit(market, EVENT_NAME_HOOK_CALL_RESULT)
          .withArgs(true);

        const configAfter: BorrowerConfig = await creditLine.getBorrowerConfiguration(borrower.address);
        expect(configAfter.maxBorrowAmount)
          .to.eq(borrowerConfig.maxBorrowAmount + loanState.borrowAmount);

        borrowerConfig.borrowPolicy = BorrowPolicy.MultipleActiveLoans;
        await proveTx(creditLineUnderAdmin.configureBorrower(borrower.address, borrowerConfig));

        await expect(market.callOnAfterLoanRevocationCreditLine(getAddress(creditLine), DEFAULT_LOAN_ID))
          .to.emit(market, EVENT_NAME_HOOK_CALL_RESULT)
          .withArgs(true);
      });
    });
    describe("After the limitation logic migration", async () => {
      it("Executes as expected", async () => {
        const { creditLine } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);
        await proveTx(creditLine.setMigrationState({ ...defaultMigrationState, done: true }));
        const loanState: LoanState = await prepareLoan();
        const expectedBorrowerState: BorrowerState = {
          ...defaultBorrowerState,
          activeLoanCount: 123,
          closedLoanCount: 456,
          totalActiveLoanAmount: maxUintForBits(64),
          totalClosedLoanAmount: maxUintForBits(64) - BigInt(loanState.borrowAmount)
        };
        await proveTx(creditLine.setBorrowerState(borrower.address, expectedBorrowerState));

        await expect(market.callOnAfterLoanRevocationCreditLine(getAddress(creditLine), DEFAULT_LOAN_ID))
          .to.emit(market, EVENT_NAME_HOOK_CALL_RESULT)
          .withArgs(true);

        expectedBorrowerState.activeLoanCount -= 1;
        expectedBorrowerState.closedLoanCount += 1;
        expectedBorrowerState.totalActiveLoanAmount -= BigInt(loanState.borrowAmount);
        expectedBorrowerState.totalClosedLoanAmount += BigInt(loanState.borrowAmount);

        const actualBorrowerState = await creditLine.getBorrowerState(borrower.address);
        checkEquality(actualBorrowerState, expectedBorrowerState);
      });

      it("Is reverted if caller is not the market", async () => {
        const { creditLine } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);

        await expect(connect(creditLine, attacker).onAfterLoanRevocation(DEFAULT_LOAN_ID))
          .to.be.revertedWithCustomError(creditLine, ERROR_NAME_UNAUTHORIZED);
      });

      it("Is reverted if contract is paused", async () => {
        const { creditLine } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);
        await proveTx(creditLine.pause());

        await expect(market.callOnAfterLoanRevocationCreditLine(getAddress(creditLine), DEFAULT_LOAN_ID))
          .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ENFORCED_PAUSED);
      });
    });
  });

  describe("Function 'determineLoanTerms()'", async () => {
    async function executeAndCheck() {
      const { creditLine } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);
      const borrowerConfig = createDefaultBorrowerConfiguration();
      const borrowAmount = Math.floor((borrowerConfig.minBorrowAmount + borrowerConfig.maxBorrowAmount) / 2);
      const durationInPeriods = Math.floor(
        (borrowerConfig.minDurationInPeriods + borrowerConfig.maxDurationInPeriods) / 2
      );

      const expectedTerms: LoanTerms = createLoanTerms(
        borrowAmount,
        durationInPeriods,
        borrowerConfig
      );
      const onChainTerms: LoanTerms = await creditLine.determineLoanTerms(
        borrower.address,
        borrowAmount,
        durationInPeriods
      );

      checkEquality(onChainTerms, expectedTerms);
    }

    it("Executes as expected", async () => {
      await executeAndCheck();
    });

    it("Is reverted if the borrower address is zero", async () => {
      const { creditLine } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);
      await expect(creditLine.determineLoanTerms(
        ZERO_ADDRESS, // borrower
        DEFAULT_MIN_BORROW_AMOUNT,
        DEFAULT_MIN_DURATION_IN_PERIODS
      )).to.be.revertedWithCustomError(creditLine, ERROR_NAME_ZERO_ADDRESS);
    });

    it("Is reverted if the borrow amount is zero", async () => {
      const { creditLine } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);
      await expect(creditLine.determineLoanTerms(
        borrower.address,
        0, // borrowAmount
        DEFAULT_MIN_DURATION_IN_PERIODS
      )).to.be.revertedWithCustomError(creditLine, ERROR_NAME_INVALID_AMOUNT);
    });

    it("Is reverted if the borrower configuration has been expired", async () => {
      const { creditLine, creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLine);
      const borrowerConfig = createDefaultBorrowerConfiguration();

      borrowerConfig.expiration = 0;
      await proveTx(creditLineUnderAdmin.configureBorrower(borrower.address, borrowerConfig));

      await expect(creditLine.determineLoanTerms(
        borrower.address,
        DEFAULT_MIN_BORROW_AMOUNT, // borrowAmount
        DEFAULT_MIN_DURATION_IN_PERIODS // durationInPeriods
      )).to.be.revertedWithCustomError(creditLine, ERROR_NAME_BORROWER_CONFIGURATION_EXPIRED);
    });

    it("Is reverted if the borrow amount is greater than the max allowed one", async () => {
      const { creditLine } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);
      await expect(creditLine.determineLoanTerms(
        borrower.address,
        DEFAULT_MAX_BORROW_AMOUNT + 1, // borrowAmount
        DEFAULT_MIN_DURATION_IN_PERIODS // durationInPeriods
      )).to.be.revertedWithCustomError(creditLine, ERROR_NAME_INVALID_AMOUNT);
    });

    it("Is reverted if the borrow amount is less than the min allowed one", async () => {
      const { creditLine } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);
      await expect(creditLine.determineLoanTerms(
        borrower.address,
        DEFAULT_MIN_BORROW_AMOUNT - 1, // borrowAmount
        DEFAULT_MIN_DURATION_IN_PERIODS // durationInPeriods
      )).to.be.revertedWithCustomError(creditLine, ERROR_NAME_INVALID_AMOUNT);
    });

    it("Is reverted if the loan duration is less than the min allowed one", async () => {
      const { creditLine } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);
      await expect(creditLine.determineLoanTerms(
        borrower.address,
        DEFAULT_MIN_BORROW_AMOUNT, // borrowAmount
        DEFAULT_MIN_DURATION_IN_PERIODS - 1 // durationInPeriods
      )).to.be.revertedWithCustomError(creditLine, ERROR_NAME_LOAN_DURATION_OUT_OF_RANGE);
    });

    it("Is reverted if the loan duration is greater than the max allowed one", async () => {
      const { creditLine } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);
      await expect(creditLine.determineLoanTerms(
        borrower.address,
        DEFAULT_MIN_BORROW_AMOUNT, // borrowAmount
        DEFAULT_MAX_DURATION_IN_PERIODS + 1 // durationInPeriods
      )).to.be.revertedWithCustomError(creditLine, ERROR_NAME_LOAN_DURATION_OUT_OF_RANGE);
    });
  });

  describe("Function 'calculateAddonAmount()'", async () => {
    it("Returns correct values", async () => {
      const { creditLine } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);
      const contractValue = await creditLine.calculateAddonAmount(
        BORROW_AMOUNT,
        DEFAULT_MIN_DURATION_IN_PERIODS,
        DEFAULT_MIN_ADDON_FIXED_RATE,
        DEFAULT_MIN_ADDON_PERIOD_RATE,
        INTEREST_RATE_FACTOR
      );

      const expectedValue = calculateAddonAmount(
        BORROW_AMOUNT,
        DEFAULT_MIN_DURATION_IN_PERIODS,
        DEFAULT_MIN_ADDON_FIXED_RATE,
        DEFAULT_MIN_ADDON_PERIOD_RATE,
        INTEREST_RATE_FACTOR
      );

      expect(contractValue).to.eq(expectedValue);
    });
  });

  describe("Function 'migrateBorrowerState()'", async () => {
    it("Executes as expected", async () => {
      const { creditLine } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);
      const loanIds = [0, 1, 2, 3, 4];
      const loanStates: LoanState[] = loanIds.map(loanId => ({
        ...defaultLoanState,
        borrowAmount: BORROW_AMOUNT + loanId,
        borrower: borrower.address,
        trackedBalance: loanId % 2 == 0 ? 0 : Number.MAX_SAFE_INTEGER - loanId
      }));
      const expectedBorrowerState: BorrowerState = { ...defaultBorrowerState };
      const expectedMigrationState: MigrationState = { ...defaultMigrationState };

      async function updateExpectedStatesAndCheck(processedLoanIds: number[]) {
        for (const processedLoanId of processedLoanIds) {
          const loanState: LoanState = loanStates[processedLoanId];
          if (loanState.trackedBalance == 0) {
            expectedBorrowerState.closedLoanCount += 1;
            expectedBorrowerState.totalClosedLoanAmount += BigInt(loanState.borrowAmount);
          } else {
            expectedBorrowerState.activeLoanCount += 1;
            expectedBorrowerState.totalActiveLoanAmount += BigInt(loanState.borrowAmount);
          }
        }
        if (processedLoanIds.length > 0) {
          expectedMigrationState.nextLoanId = BigInt(processedLoanIds.slice(-1)[0] + 1);
        }

        const actualBorrowerState = await creditLine.getBorrowerState(borrower.address);
        const actualMigrationState = await creditLine.migrationState();
        checkEquality(actualBorrowerState, expectedBorrowerState);
        checkEquality(actualMigrationState, expectedMigrationState);
      }

      for (let i = 0; i < loanIds.length; ++i) {
        await proveTx(market.mockLoanState(i, loanStates[i]));
      }
      await proveTx(market.setLoanIdCounter(loanStates.length));

      // Check initial state
      await updateExpectedStatesAndCheck([]);

      // Migrate 1 loan
      await proveTx(creditLine.migrateBorrowerState(1));
      await updateExpectedStatesAndCheck([0]);

      // Migrate 2 more loans
      await proveTx(creditLine.migrateBorrowerState(2));
      await updateExpectedStatesAndCheck([1, 2]);

      // Migrate the rest loans
      await proveTx(creditLine.migrateBorrowerState(ethers.MaxUint256));
      await updateExpectedStatesAndCheck([3, 4]);
    });
  });

  describe("Function 'migrateLoanLimitationLogic()'", async () => {
    it("Executes as expected", async () => {
      const { creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);
      const loanIds = [0, 1, 2];
      const loanStates: LoanState[] = loanIds.map(loanId => ({
        ...defaultLoanState,
        borrowAmount: BORROW_AMOUNT + loanId,
        borrower: borrower.address,
        trackedBalance: 1
      }));
      const expectedBorrowerState: BorrowerState = {
        ...defaultBorrowerState,
        activeLoanCount: loanIds.length,
        totalActiveLoanAmount: BigInt(loanIds.length + BORROW_AMOUNT * loanIds.length)
      };
      const expectedMigrationState: MigrationState = {
        ...defaultMigrationState,
        nextLoanId: BigInt(loanIds.length),
        done: true
      };

      for (let i = 0; i < loanIds.length; ++i) {
        await proveTx(market.mockLoanState(i, loanStates[i]));
      }
      await proveTx(market.setLoanIdCounter(loanStates.length));

      // Call first time
      await proveTx(creditLineUnderAdmin.migrateLoanLimitationLogic());
      let actualBorrowerState = await creditLineUnderAdmin.getBorrowerState(borrower.address);
      let actualMigrationState = await creditLineUnderAdmin.migrationState();
      checkEquality(actualBorrowerState, expectedBorrowerState);
      checkEquality(actualMigrationState, expectedMigrationState);

      // Reset the 'done' fields and call again. Nothing except the 'done' field should be changed
      await proveTx(creditLineUnderAdmin.setMigrationState({ ...expectedMigrationState, done: false }));
      await proveTx(creditLineUnderAdmin.migrateLoanLimitationLogic());
      actualBorrowerState = await creditLineUnderAdmin.getBorrowerState(borrower.address);
      actualMigrationState = await creditLineUnderAdmin.migrationState();
      checkEquality(actualBorrowerState, expectedBorrowerState);
      checkEquality(actualMigrationState, expectedMigrationState);

      // Call second time, nothing should be changed
      await proveTx(creditLineUnderAdmin.migrateLoanLimitationLogic());
      actualBorrowerState = await creditLineUnderAdmin.getBorrowerState(borrower.address);
      actualMigrationState = await creditLineUnderAdmin.migrationState();
      checkEquality(actualBorrowerState, expectedBorrowerState);
      checkEquality(actualMigrationState, expectedMigrationState);
    });

    it("Is reverted if the caller is not an admin", async () => {
      const { creditLine } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);

      await expect(connect(creditLine, lender).migrateLoanLimitationLogic())
        .to.be.revertedWithCustomError(creditLineFactory, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(lender.address, ADMIN_ROLE);
    });
  });

  describe("Function 'setBorrowerConfigurationPause()'", async () => {
    it("Executes as expected", async () => {
      const { creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);
      const expectedMigrationState: MigrationState = { ...defaultMigrationState };

      // Does not change the state if the borrower state migration is not done
      await proveTx(creditLineUnderAdmin.setBorrowerConfigurationPause(true));
      let actualMigrationState = await creditLineUnderAdmin.migrationState();
      checkEquality(actualMigrationState, expectedMigrationState);

      // Changes the state if the borrower state migration is done
      expectedMigrationState.done = true;
      await proveTx(creditLineUnderAdmin.setMigrationState(expectedMigrationState));
      await proveTx(creditLineUnderAdmin.setBorrowerConfigurationPause(true));
      expectedMigrationState.borrowerConfigurationPaused = true;
      actualMigrationState = await creditLineUnderAdmin.migrationState();
      checkEquality(actualMigrationState, expectedMigrationState);
    });

    it("Is reverted if the caller is not an admin", async () => {
      const { creditLine } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);

      await expect(connect(creditLine, lender).setBorrowerConfigurationPause(true))
        .to.be.revertedWithCustomError(creditLineFactory, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(lender.address, ADMIN_ROLE);
    });
  });

  describe("Function 'setMaxBorrowAmount()'", async () => {
    it("Executes as expected", async () => {
      const { creditLineUnderAdmin } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);
      const migrationState: MigrationState = { ...defaultMigrationState };
      const expectedBorrowerConfig: BorrowerConfig = createDefaultBorrowerConfiguration();
      const newMaxBorrowAmount = expectedBorrowerConfig.maxBorrowAmount * 2;

      // Does not change the borrower configuration if the borrower state migration is not done
      migrationState.done = true;
      await proveTx(creditLineUnderAdmin.setMigrationState(migrationState));
      await proveTx(creditLineUnderAdmin.setMaxBorrowAmount(borrower.address, newMaxBorrowAmount));
      let actualBorrowerConfig = await creditLineUnderAdmin.getBorrowerConfiguration(borrower.address);
      checkEquality(actualBorrowerConfig, expectedBorrowerConfig);

      // Does not change the borrower configuration if the borrower configuration is not paused
      migrationState.done = false;
      migrationState.borrowerConfigurationPaused = true;
      await proveTx(creditLineUnderAdmin.setMigrationState(migrationState));
      await proveTx(creditLineUnderAdmin.setMaxBorrowAmount(borrower.address, newMaxBorrowAmount));
      actualBorrowerConfig = await creditLineUnderAdmin.getBorrowerConfiguration(borrower.address);
      checkEquality(actualBorrowerConfig, expectedBorrowerConfig);

      // Changes the borrower configuration if the borrower state migration is done and borrower configuration is paused
      migrationState.done = true;
      migrationState.borrowerConfigurationPaused = true;
      await proveTx(creditLineUnderAdmin.setMigrationState(migrationState));
      await proveTx(creditLineUnderAdmin.setMaxBorrowAmount(borrower.address, newMaxBorrowAmount));
      expectedBorrowerConfig.maxBorrowAmount = newMaxBorrowAmount;
      actualBorrowerConfig = await creditLineUnderAdmin.getBorrowerConfiguration(borrower.address);
      checkEquality(actualBorrowerConfig, expectedBorrowerConfig);
    });

    it("Is reverted if the caller is not an admin", async () => {
      const { creditLine } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);

      await expect(connect(creditLine, lender).setBorrowerConfigurationPause(true))
        .to.be.revertedWithCustomError(creditLineFactory, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(lender.address, ADMIN_ROLE);
    });
  });

  describe("Function 'clearMigrationState()'", async () => {
    it("Executes as expected", async () => {
      const { creditLine } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);
      const expectedMigrationState: MigrationState = {
        ...defaultMigrationState,
        nextLoanId: 123n,
        done: true,
        borrowerConfigurationPaused: true
      };
      await proveTx(creditLine.setMigrationState(expectedMigrationState));
      let actualMigrationState = await creditLine.migrationState();
      checkEquality(actualMigrationState, expectedMigrationState);

      // Check clearing if all needed fields have not default values
      await proveTx(creditLine.clearMigrationState());
      actualMigrationState = await creditLine.migrationState();
      checkEquality(actualMigrationState, defaultMigrationState);

      // Check clearing not working if only the 'done' field is set
      expectedMigrationState.nextLoanId = 0n;
      await proveTx(creditLine.setMigrationState(expectedMigrationState));
      await proveTx(creditLine.clearMigrationState());
      actualMigrationState = await creditLine.migrationState();
      checkEquality(actualMigrationState, expectedMigrationState);

      // Check clearing not working if only the 'nextLoanId' field is set
      expectedMigrationState.done = false;
      expectedMigrationState.nextLoanId = 321n;
      await proveTx(creditLine.setMigrationState(expectedMigrationState));
      await proveTx(creditLine.clearMigrationState());
      actualMigrationState = await creditLine.migrationState();
      checkEquality(actualMigrationState, expectedMigrationState);
    });

    it("Is reverted if the caller is not the owner", async () => {
      const { creditLine } = await setUpFixture(deployAndConfigureCreditLineWithBorrower);

      await expect(connect(creditLine, admin).clearMigrationState())
        .to.be.revertedWithCustomError(creditLineFactory, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(admin.address, OWNER_ROLE);
    });
  });
});
