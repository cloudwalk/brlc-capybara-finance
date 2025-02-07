import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  checkContractUupsUpgrading,
  connect,
  deployAndConnectContract,
  getAddress,
  getLatestBlockTimestamp,
  proveTx
} from "../test-utils/eth";
import { checkEquality, maxUintForBits, setUpFixture } from "../test-utils/common";

enum BorrowingPolicy {
  SingleActiveLoan = 0,
  MultipleActiveLoans = 1,
  TotalActiveAmountLimit = 2
}

enum LateFeePolicy {
  Common = 0,
  Individual = 1
}

interface CreditLineConfig {
  minBorrowedAmount: bigint;
  maxBorrowedAmount: bigint;
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
  lateFeeRate: bigint;

  [key: string]: bigint; // Index signature
}

interface BorrowerConfig {
  expiration: bigint;
  minDurationInPeriods: bigint;
  maxDurationInPeriods: bigint;
  minBorrowedAmount: bigint;
  maxBorrowedAmount: bigint;
  borrowingPolicy: BorrowingPolicy;
  interestRatePrimary: bigint;
  interestRateSecondary: bigint;
  addonFixedRate: bigint;
  addonPeriodRate: bigint;
  lateFeePolicy: LateFeePolicy;
  lateFeeRate: bigint;

  [key: string]: bigint | BorrowingPolicy; // Index signature
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
  borrowedAmount: bigint;
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
  firstInstallmentId: bigint;
  installmentCount: bigint;
  lateFeeAmount: bigint;
  discountAmount: bigint;
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
  creditLineConfig: CreditLineConfig;
  borrowerConfig: BorrowerConfig;
}

const ZERO_ADDRESS = ethers.ZeroAddress;

const defaultCreditLineConfig: CreditLineConfig = {
  minBorrowedAmount: 0n,
  maxBorrowedAmount: 0n,
  minInterestRatePrimary: 0n,
  maxInterestRatePrimary: 0n,
  minInterestRateSecondary: 0n,
  maxInterestRateSecondary: 0n,
  minDurationInPeriods: 0n,
  maxDurationInPeriods: 0n,
  minAddonFixedRate: 0n,
  maxAddonFixedRate: 0n,
  minAddonPeriodRate: 0n,
  maxAddonPeriodRate: 0n,
  lateFeeRate: 0n
};

const defaultBorrowerConfig: BorrowerConfig = {
  expiration: 0n,
  minDurationInPeriods: 0n,
  maxDurationInPeriods: 0n,
  minBorrowedAmount: 0n,
  maxBorrowedAmount: 0n,
  borrowingPolicy: BorrowingPolicy.SingleActiveLoan,
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
  borrowedAmount: 0n,
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
  freezeTimestamp: 0n,
  firstInstallmentId: 0n,
  installmentCount: 0n,
  lateFeeAmount: 0n,
  discountAmount: 0n
};

const ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED = "AccessControlUnauthorizedAccount";
const ERROR_NAME_ALREADY_INITIALIZED = "InvalidInitialization";
const ERROR_NAME_ARRAYS_LENGTH_MISMATCH = "ArrayLengthMismatch";
const ERROR_NAME_BORROWER_CONFIGURATION_EXPIRED = "BorrowerConfigurationExpired";
const ERROR_NAME_BORROWER_STATE_OVERFLOW = "BorrowerStateOverflow";
const ERROR_NAME_CONTRACT_ADDRESS_INVALID = "ContractAddressInvalid";
const ERROR_NAME_CONTRACT_IS_NOT_INITIALIZING = "NotInitializing";
const ERROR_NAME_ENFORCED_PAUSED = "EnforcedPause";
const ERROR_NAME_INVALID_AMOUNT = "InvalidAmount";
const ERROR_NAME_INVALID_BORROWER_CONFIGURATION = "InvalidBorrowerConfiguration";
const ERROR_NAME_INVALID_CREDIT_LINE_CONFIGURATION = "InvalidCreditLineConfiguration";
const ERROR_NAME_IMPLEMENTATION_ADDRESS_INVALID = "ImplementationAddressInvalid";
const ERROR_NAME_LOAN_DURATION_OUT_OF_RANGE = "LoanDurationOutOfRange";
const ERROR_NAME_LIMIT_VIOLATION_ON_SINGLE_ACTIVE_LOAN = "LimitViolationOnSingleActiveLoan";
const ERROR_NAME_LIMIT_VIOLATION_ON_TOTAL_ACTIVE_LOAN_AMOUNT = "LimitViolationOnTotalActiveLoanAmount";
const ERROR_NAME_UNAUTHORIZED = "Unauthorized";
const ERROR_NAME_ZERO_ADDRESS = "ZeroAddress";

const EVENT_NAME_BORROWER_CONFIGURED = "BorrowerConfigured";
const EVENT_NAME_CREDIT_LINE_CONFIGURED = "CreditLineConfigured";

const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
const OWNER_ROLE = ethers.id("OWNER_ROLE");
const ADMIN_ROLE = ethers.id("ADMIN_ROLE");
const PAUSER_ROLE = ethers.id("PAUSER_ROLE");

const MIN_BORROWED_AMOUNT = 2n;
const MAX_BORROWED_AMOUNT = maxUintForBits(64) - 1n;
const MIN_INTEREST_RATE_PRIMARY = 1n;
const MAX_INTEREST_RATE_PRIMARY = maxUintForBits(32) - 1n;
const MIN_INTEREST_RATE_SECONDARY = 10n;
const MAX_INTEREST_RATE_SECONDARY = maxUintForBits(32) - 1n;
const MIN_DURATION_IN_PERIODS = 1n;
const MAX_DURATION_IN_PERIODS = maxUintForBits(32) - 1n;
const NEGATIVE_TIME_OFFSET = 3n * 60n * 60n;
const EXPIRATION_TIME = maxUintForBits(32);
const BORROWED_AMOUNT = 1234_567_890n;
const LOAN_ID = 123n;
const ADDON_AMOUNT = 123456789n;
const REPAYMENT_AMOUNT = 12345678n;
const LATE_FEE_RATE = 987654321n;
const INTEREST_RATE_FACTOR = 10n ** 9n;

const EXPECTED_VERSION: Version = {
  major: 1,
  minor: 10,
  patch: 0
};

function processLoanClosing(borrowerState: BorrowerState, borrowedAmount: bigint) {
  borrowerState.activeLoanCount -= 1n;
  borrowerState.closedLoanCount += 1n;
  borrowerState.totalActiveLoanAmount -= borrowedAmount;
  borrowerState.totalClosedLoanAmount += borrowedAmount;
}

describe("Contract 'CreditLine'", async () => {
  let creditLineFactory: ContractFactory;
  let marketFactory: ContractFactory;
  let tokenFactory: ContractFactory;

  let market: Contract;
  let token: Contract;

  let marketAddress: string;
  let tokenAddress: string;

  let deployer: HardhatEthersSigner;
  let owner: HardhatEthersSigner;
  let admin: HardhatEthersSigner;
  let attacker: HardhatEthersSigner;
  let borrower: HardhatEthersSigner;
  let users: HardhatEthersSigner[];

  before(async () => {
    [deployer, owner, admin, attacker, borrower, ...users] = await ethers.getSigners();

    creditLineFactory = await ethers.getContractFactory("CreditLineTestable");
    creditLineFactory.connect(deployer); // Explicitly specifying the deployer account

    marketFactory = await ethers.getContractFactory("LendingMarketMock");
    marketFactory = marketFactory.connect(deployer); // Explicitly specifying the deployer account

    tokenFactory = await ethers.getContractFactory("ERC20Mock");
    tokenFactory = tokenFactory.connect(deployer); // Explicitly specifying the deployer account

    market = await deployAndConnectContract(marketFactory, deployer);
    marketAddress = getAddress(market);

    token = await deployAndConnectContract(tokenFactory, deployer);
    tokenAddress = getAddress(token);
  });

  async function deployContracts(): Promise<Fixture> {
    let creditLine = await upgrades.deployProxy(
      creditLineFactory,
      [
        owner.address,
        marketAddress,
        tokenAddress
      ],
      { kind: "uups" }
    );
    await creditLine.waitForDeployment();
    creditLine = connect(creditLine, owner); // Explicitly specifying the initial account
    const creditLineUnderAdmin = creditLine.connect(admin) as Contract;
    const creditLineAddress = getAddress(creditLine);

    return {
      creditLine,
      creditLineUnderAdmin,
      creditLineAddress,
      creditLineConfig: defaultCreditLineConfig,
      borrowerConfig: defaultBorrowerConfig
    };
  }

  async function deployAndConfigureContracts(): Promise<Fixture> {
    const fixture: Fixture = await deployContracts();
    const { creditLine } = fixture;

    await proveTx(creditLine.grantRole(PAUSER_ROLE, owner.address));
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
      minBorrowedAmount: MIN_BORROWED_AMOUNT,
      maxBorrowedAmount: MAX_BORROWED_AMOUNT,
      minInterestRatePrimary: MIN_INTEREST_RATE_PRIMARY,
      maxInterestRatePrimary: MAX_INTEREST_RATE_PRIMARY,
      minInterestRateSecondary: MIN_INTEREST_RATE_SECONDARY,
      maxInterestRateSecondary: MAX_INTEREST_RATE_SECONDARY,
      minDurationInPeriods: MIN_DURATION_IN_PERIODS,
      maxDurationInPeriods: MAX_DURATION_IN_PERIODS,
      minAddonFixedRate: 0n,
      maxAddonFixedRate: 0n,
      minAddonPeriodRate: 0n,
      maxAddonPeriodRate: 0n,
      lateFeeRate: LATE_FEE_RATE
    };
  }

  function createBorrowerConfiguration(
    borrowingPolicy: BorrowingPolicy = BorrowingPolicy.MultipleActiveLoans
  ): BorrowerConfig {
    return {
      expiration: EXPIRATION_TIME,
      minDurationInPeriods: MIN_DURATION_IN_PERIODS,
      maxDurationInPeriods: MAX_DURATION_IN_PERIODS,
      minBorrowedAmount: MIN_BORROWED_AMOUNT,
      maxBorrowedAmount: MAX_BORROWED_AMOUNT,
      borrowingPolicy: borrowingPolicy,
      interestRatePrimary: MIN_INTEREST_RATE_PRIMARY,
      interestRateSecondary: MIN_INTEREST_RATE_SECONDARY,
      addonFixedRate: 0n,
      addonPeriodRate: 0n,
      lateFeePolicy: LateFeePolicy.Common,
      lateFeeRate: 0n
    };
  }


  function createLoanTerms(
    tokenAddress: string,
    durationInPeriods: bigint,
    borrowerConfig: BorrowerConfig
  ): LoanTerms {
    return {
      token: tokenAddress,
      interestRatePrimary: borrowerConfig.interestRatePrimary,
      interestRateSecondary: borrowerConfig.interestRateSecondary,
      durationInPeriods,
      addonAmount: 0n
    };
  }

  async function prepareLoan(market: Contract, props: { trackedBalance?: bigint } = {}): Promise<LoanState> {
    const loanState: LoanState = {
      ...defaultLoanState,
      borrowedAmount: BORROWED_AMOUNT,
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
    configs.forEach((config, index) => config.maxBorrowedAmount + BigInt(index));

    return {
      borrowers,
      configs
    };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { creditLine } = await setUpFixture(deployContracts);
      // Role hashes
      expect(await creditLine.OWNER_ROLE()).to.equal(OWNER_ROLE);
      expect(await creditLine.ADMIN_ROLE()).to.equal(ADMIN_ROLE);
      expect(await creditLine.PAUSER_ROLE()).to.equal(PAUSER_ROLE);

      // The role admins
      expect(await creditLine.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE);
      expect(await creditLine.getRoleAdmin(ADMIN_ROLE)).to.equal(OWNER_ROLE);
      expect(await creditLine.getRoleAdmin(PAUSER_ROLE)).to.equal(OWNER_ROLE);

      // Roles
      expect(await creditLine.hasRole(OWNER_ROLE, deployer.address)).to.equal(false);
      expect(await creditLine.hasRole(ADMIN_ROLE, deployer.address)).to.equal(false);
      expect(await creditLine.hasRole(PAUSER_ROLE, deployer.address)).to.equal(false);
      expect(await creditLine.hasRole(OWNER_ROLE, owner.address)).to.equal(true); // !!!
      expect(await creditLine.hasRole(ADMIN_ROLE, owner.address)).to.equal(false);
      expect(await creditLine.hasRole(PAUSER_ROLE, owner.address)).to.equal(false);

      // The initial contract state is unpaused
      expect(await creditLine.paused()).to.equal(false);

      // Other important parameters
      expect(await creditLine.token()).to.eq(tokenAddress);
      expect(await creditLine.market()).to.eq(marketAddress);

      // Default values of the internal structures. Also checks the set of fields
      checkEquality(await creditLine.creditLineConfiguration(), defaultCreditLineConfig);
      checkEquality(await creditLine.getBorrowerConfiguration(borrower.address), defaultBorrowerConfig);
      checkEquality(await creditLine.getBorrowerState(borrower.address), defaultBorrowerState);
    });

    it("Is reverted if the owner address is zero", async () => {
      const wrongOwnerAddress = (ZERO_ADDRESS);
      await expect(upgrades.deployProxy(creditLineFactory, [
        wrongOwnerAddress,
        marketAddress,
        tokenAddress
      ])).to.be.revertedWithCustomError(creditLineFactory, ERROR_NAME_ZERO_ADDRESS);
    });

    it("Is reverted if the market address is zero", async () => {
      const wrongMarketAddress = (ZERO_ADDRESS);
      await expect(upgrades.deployProxy(creditLineFactory, [
        owner.address,
        wrongMarketAddress,
        tokenAddress
      ])).to.be.revertedWithCustomError(creditLineFactory, ERROR_NAME_ZERO_ADDRESS);
    });

    it("Is reverted if the market address does not belong to a contract", async () => {
      const wrongMarketAddress = deployer.address;
      await expect(upgrades.deployProxy(creditLineFactory, [
        owner.address,
        wrongMarketAddress,
        tokenAddress
      ])).to.be.revertedWithCustomError(creditLineFactory, ERROR_NAME_CONTRACT_ADDRESS_INVALID);
    });

    it("Is reverted if the market address does not belong to a lending market contract", async () => {
      const wrongMarketAddress = (tokenAddress);
      await expect(upgrades.deployProxy(creditLineFactory, [
        owner.address,
        wrongMarketAddress,
        tokenAddress
      ])).to.be.revertedWithCustomError(creditLineFactory, ERROR_NAME_CONTRACT_ADDRESS_INVALID);
    });

    it("Is reverted if the token address is zero", async () => {
      const wrongTokenAddress = (ZERO_ADDRESS);
      await expect(upgrades.deployProxy(creditLineFactory, [
        owner.address,
        marketAddress,
        wrongTokenAddress
      ])).to.be.revertedWithCustomError(creditLineFactory, ERROR_NAME_ZERO_ADDRESS);
    });

    it("Is reverted if the token address does not belong to a contract", async () => {
      const wrongTokenAddress = deployer.address;
      await expect(upgrades.deployProxy(creditLineFactory, [
        owner.address,
        marketAddress,
        wrongTokenAddress
      ])).to.be.revertedWithCustomError(creditLineFactory, ERROR_NAME_CONTRACT_ADDRESS_INVALID);
    });

    it("Is reverted if the token address does not belong to a token contract", async () => {
      const wrongTokenAddress = (marketAddress);
      await expect(upgrades.deployProxy(creditLineFactory, [
        owner.address,
        marketAddress,
        wrongTokenAddress
      ])).to.be.revertedWithCustomError(creditLineFactory, ERROR_NAME_CONTRACT_ADDRESS_INVALID);
    });

    it("Is reverted if called a second time", async () => {
      const { creditLine } = await setUpFixture(deployContracts);

      await expect(creditLine.initialize(owner.address, marketAddress, tokenAddress))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ALREADY_INITIALIZED);
    });

    it("Is reverted if the internal initializer is called outside the init process", async () => {
      const { creditLine } = await setUpFixture(deployContracts);
      await expect(
        // Call via the testable version
        creditLine.call_parent_initialize(owner.address, marketAddress, tokenAddress)
      ).to.be.revertedWithCustomError(creditLine, ERROR_NAME_CONTRACT_IS_NOT_INITIALIZING);
    });

    it("Is reverted if the unchained internal initializer is called outside the init process", async () => {
      const { creditLine } = await setUpFixture(deployContracts);
      await expect(
        // Call via the testable version
        creditLine.call_parent_initialize_unchained(owner.address, marketAddress, tokenAddress)
      ).to.be.revertedWithCustomError(creditLine, ERROR_NAME_CONTRACT_IS_NOT_INITIALIZING);
    });
  });

  describe("Function '$__VERSION()'", async () => {
    it("Returns expected values", async () => {
      const { creditLine } = await setUpFixture(deployContracts);
      const creditLineVersion = await creditLine.$__VERSION();
      checkEquality(creditLineVersion, EXPECTED_VERSION);
    });
  });

  describe("Function 'upgradeToAndCall()'", async () => {
    it("Executes as expected", async () => {
      const { creditLine } = await setUpFixture(deployContracts);
      await checkContractUupsUpgrading(creditLine, creditLineFactory);
    });

    it("Is reverted if the caller does not have the owner role", async () => {
      const { creditLine } = await setUpFixture(deployContracts);

      await expect(connect(creditLine, admin).upgradeToAndCall(creditLine, "0x"))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(admin.address, OWNER_ROLE);
      await expect(connect(creditLine, attacker).upgradeToAndCall(creditLine, "0x"))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(attacker.address, OWNER_ROLE);
    });

    it("Is reverted if the provided implementation address is not a credit line contract", async () => {
      const { creditLine } = await setUpFixture(deployContracts);

      const mockContractFactory = await ethers.getContractFactory("UUPSExtUpgradeableMock");
      const mockContract = await mockContractFactory.deploy() as Contract;
      await mockContract.waitForDeployment();

      await expect(creditLine.upgradeToAndCall(mockContract, "0x"))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_IMPLEMENTATION_ADDRESS_INVALID);
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
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(admin.address, OWNER_ROLE);
    });

    it("Is reverted if the min borrowed amount is bigger than the max one", async () => {
      const { creditLine } = await setUpFixture(deployContracts);
      const config = createCreditLineConfiguration();
      config.minBorrowedAmount = config.maxBorrowedAmount + 1n;

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

    it("Is reverted if the min addon fixed rate is not zero", async () => {
      const { creditLine } = await setUpFixture(deployContracts);
      const config = createCreditLineConfiguration();
      config.minAddonFixedRate = 1n;

      await expect(creditLine.configureCreditLine(config))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_INVALID_CREDIT_LINE_CONFIGURATION);
    });

    it("Is reverted if the max addon fixed rate is not zero", async () => {
      const { creditLine } = await setUpFixture(deployContracts);
      const config = createCreditLineConfiguration();
      config.maxAddonFixedRate = 1n;

      await expect(creditLine.configureCreditLine(config))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_INVALID_CREDIT_LINE_CONFIGURATION);
    });

    it("Is reverted if the min addon period rate is not zero", async () => {
      const { creditLine } = await setUpFixture(deployContracts);
      const config = createCreditLineConfiguration();
      config.minAddonPeriodRate = 1n;

      await expect(creditLine.configureCreditLine(config))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_INVALID_CREDIT_LINE_CONFIGURATION);
    });

    it("Is reverted if the max addon period rate is not zero", async () => {
      const { creditLine } = await setUpFixture(deployContracts);
      const config = createCreditLineConfiguration();
      config.maxAddonPeriodRate = 1n;

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

      // Even the owner cannot configure a borrower
      await expect(connect(creditLine, owner).configureBorrower(attacker.address, config))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(owner.address, ADMIN_ROLE);
      await expect(connect(creditLine, attacker).configureBorrower(attacker.address, config))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(attacker.address, ADMIN_ROLE);
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

    it("Is reverted if the min borrowed amount is greater than the max one", async () => {
      const { creditLineUnderAdmin } = await setUpFixture(deployAndConfigureContracts);
      const config = createBorrowerConfiguration();
      config.minBorrowedAmount = config.maxBorrowedAmount + 1n;

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, config))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_INVALID_BORROWER_CONFIGURATION);
    });

    it("Is reverted if the min borrowed amount is less than credit line`s one", async () => {
      const { creditLineUnderAdmin, creditLineConfig } = await setUpFixture(deployAndConfigureContracts);
      const borrowerConfig = createBorrowerConfiguration();
      borrowerConfig.minBorrowedAmount = creditLineConfig.minBorrowedAmount - 1n;

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, borrowerConfig))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_INVALID_BORROWER_CONFIGURATION);
    });

    it("Is reverted if the max borrowed amount is greater than credit line`s one", async () => {
      const { creditLineUnderAdmin, creditLineConfig } = await setUpFixture(deployAndConfigureContracts);
      const borrowerConfig = createBorrowerConfiguration();
      borrowerConfig.maxBorrowedAmount = creditLineConfig.maxBorrowedAmount + 1n;

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

    it("Is reverted if the addon fixed rate is not zero", async () => {
      const { creditLineUnderAdmin } = await setUpFixture(deployAndConfigureContracts);
      const borrowerConfig = createBorrowerConfiguration();
      borrowerConfig.addonFixedRate = 1n;

      await expect(creditLineUnderAdmin.configureBorrower(borrower.address, borrowerConfig))
        .to.be.revertedWithCustomError(creditLineUnderAdmin, ERROR_NAME_INVALID_BORROWER_CONFIGURATION);
    });

    it("Is reverted if the addon period rate is not zero", async () => {
      const { creditLineUnderAdmin } = await setUpFixture(deployAndConfigureContracts);
      const borrowerConfig = createBorrowerConfiguration();
      borrowerConfig.addonPeriodRate = 1n;

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

      await expect(connect(creditLine, owner).configureBorrowers(borrowers, configs))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(owner.address, ADMIN_ROLE);
      await expect(connect(creditLine, attacker).configureBorrowers(borrowers, configs))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(attacker.address, ADMIN_ROLE);
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
      const { creditLine, creditLineUnderAdmin, borrowerConfig: expectedBorrowerConfig } = fixture;
      const expectedBorrowerState: BorrowerState = {
        ...defaultBorrowerState,
        activeLoanCount: maxUintForBits(16) - 2n,
        closedLoanCount: 1n,
        totalActiveLoanAmount: maxUintForBits(64) - BigInt(BORROWED_AMOUNT * 2n),
        totalClosedLoanAmount: BigInt(BORROWED_AMOUNT)
      };

      await proveTx(creditLineUnderAdmin.configureBorrower(borrower.address, expectedBorrowerConfig));
      await proveTx(creditLineUnderAdmin.setBorrowerState(borrower.address, expectedBorrowerState));
      const loanState: LoanState = await prepareLoan(market);

      await proveTx(market.callOnBeforeLoanTakenCreditLine(getAddress(creditLine), LOAN_ID));

      expectedBorrowerState.activeLoanCount += 1n;
      expectedBorrowerState.totalActiveLoanAmount += BigInt(loanState.borrowedAmount);
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
      const { creditLine } = await setUpFixture(deployAndConfigureContractsWithBorrower);
      await proveTx(creditLine.pause());

      await expect(market.callOnBeforeLoanTakenCreditLine(getAddress(creditLine), LOAN_ID))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the result total number of loans is greater than 16-bit unsigned integer", async () => {
      const { creditLine, creditLineUnderAdmin } = await setUpFixture(deployAndConfigureContractsWithBorrower);
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
      const { creditLine, creditLineUnderAdmin } = await setUpFixture(deployAndConfigureContractsWithBorrower);
      const borrowerState: BorrowerState = {
        ...defaultBorrowerState,
        totalActiveLoanAmount: 0n,
        totalClosedLoanAmount: maxUintForBits(64) - BORROWED_AMOUNT + 1n
      };
      await proveTx(creditLineUnderAdmin.setBorrowerState(borrower.address, borrowerState));
      await prepareLoan(market);

      await expect(market.callOnBeforeLoanTakenCreditLine(getAddress(creditLine), LOAN_ID))
        .to.revertedWithCustomError(creditLine, ERROR_NAME_BORROWER_STATE_OVERFLOW);
    });
  });

  describe("Function onAfterLoanPayment()", async () => {
    it("Executes as expected if the loan tracked balance is not zero", async () => {
      const { creditLine } = await setUpFixture(deployAndConfigureContractsWithBorrower);
      await prepareLoan(market, { trackedBalance: 123n });
      const expectedBorrowerState: BorrowerState = { ...defaultBorrowerState };

      await proveTx(market.callOnAfterLoanPaymentCreditLine(getAddress(creditLine), LOAN_ID, REPAYMENT_AMOUNT));

      const actualBorrowerState = await creditLine.getBorrowerState(borrower.address);
      checkEquality(actualBorrowerState, expectedBorrowerState);
    });

    it("Executes as expected if the loan tracked balance is zero", async () => {
      const { creditLine } = await setUpFixture(deployAndConfigureContractsWithBorrower);
      const loanState: LoanState = await prepareLoan(market, { trackedBalance: 0n });
      const expectedBorrowerState: BorrowerState = {
        ...defaultBorrowerState,
        activeLoanCount: maxUintForBits(16),
        closedLoanCount: maxUintForBits(16) - 1n,
        totalActiveLoanAmount: maxUintForBits(64),
        totalClosedLoanAmount: maxUintForBits(64) - BigInt(loanState.borrowedAmount)
      };
      await proveTx(creditLine.setBorrowerState(borrower.address, expectedBorrowerState));

      await proveTx(market.callOnAfterLoanPaymentCreditLine(getAddress(creditLine), LOAN_ID, REPAYMENT_AMOUNT));
      processLoanClosing(expectedBorrowerState, BigInt(loanState.borrowedAmount));

      const actualBorrowerState = await creditLine.getBorrowerState(borrower.address);
      checkEquality(actualBorrowerState, expectedBorrowerState);
    });

    it("Is reverted if caller is not the market", async () => {
      const { creditLine } = await setUpFixture(deployAndConfigureContractsWithBorrower);

      await expect(connect(creditLine, attacker).onAfterLoanPayment(LOAN_ID, REPAYMENT_AMOUNT))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_UNAUTHORIZED);
    });

    it("Is reverted if contract is paused", async () => {
      const { creditLine } = await setUpFixture(deployAndConfigureContractsWithBorrower);
      await proveTx(creditLine.pause());

      await expect(market.callOnAfterLoanPaymentCreditLine(
        getAddress(creditLine),
        LOAN_ID,
        REPAYMENT_AMOUNT
      )).to.be.revertedWithCustomError(creditLine, ERROR_NAME_ENFORCED_PAUSED);
    });
  });

  describe("Function 'onAfterLoanRevocation()'", async () => {
    it("Executes as expected", async () => {
      const { creditLine } = await setUpFixture(deployAndConfigureContractsWithBorrower);
      const loanState: LoanState = await prepareLoan(market);
      const expectedBorrowerState: BorrowerState = {
        ...defaultBorrowerState,
        activeLoanCount: maxUintForBits(16),
        closedLoanCount: maxUintForBits(16) - 1n,
        totalActiveLoanAmount: maxUintForBits(64),
        totalClosedLoanAmount: maxUintForBits(64) - BigInt(loanState.borrowedAmount)
      };
      await proveTx(creditLine.setBorrowerState(borrower.address, expectedBorrowerState));

      await proveTx(market.callOnAfterLoanRevocationCreditLine(getAddress(creditLine), LOAN_ID));

      processLoanClosing(expectedBorrowerState, BigInt(loanState.borrowedAmount));

      const actualBorrowerState = await creditLine.getBorrowerState(borrower.address);
      checkEquality(actualBorrowerState, expectedBorrowerState);
    });

    it("Is reverted if caller is not the market", async () => {
      const { creditLine } = await setUpFixture(deployAndConfigureContractsWithBorrower);

      await expect(connect(creditLine, attacker).onAfterLoanRevocation(LOAN_ID))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_UNAUTHORIZED);
    });

    it("Is reverted if contract is paused", async () => {
      const { creditLine } = await setUpFixture(deployAndConfigureContractsWithBorrower);
      await proveTx(creditLine.pause());

      await expect(market.callOnAfterLoanRevocationCreditLine(getAddress(creditLine), LOAN_ID))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ENFORCED_PAUSED);
    });
  });

  describe("Function 'determineLoanTerms()'", async () => {
    async function executeAndCheck(borrowingPolicy: BorrowingPolicy) {
      const fixture = await setUpFixture(deployAndConfigureContractsWithBorrower);
      const { creditLine, creditLineUnderAdmin } = fixture;
      const borrowerConfig = { ...fixture.borrowerConfig, borrowingPolicy };
      const borrowedAmount = (borrowerConfig.minBorrowedAmount + borrowerConfig.maxBorrowedAmount) / 2n;
      const durationInPeriods = (borrowerConfig.minDurationInPeriods + borrowerConfig.maxDurationInPeriods) / 2n;
      const borrowerState: BorrowerState = {
        ...defaultBorrowerState,
        activeLoanCount: borrowingPolicy == BorrowingPolicy.SingleActiveLoan ? 0n : maxUintForBits(16),
        closedLoanCount: maxUintForBits(16),
        totalActiveLoanAmount: maxUintForBits(64),
        totalClosedLoanAmount: maxUintForBits(64)
      };
      if (borrowingPolicy == BorrowingPolicy.TotalActiveAmountLimit) {
        borrowerState.totalActiveLoanAmount = BigInt(borrowerConfig.maxBorrowedAmount) - BigInt(borrowedAmount);
      }
      await proveTx(creditLineUnderAdmin.configureBorrower(borrower.address, borrowerConfig));
      await proveTx(creditLineUnderAdmin.setBorrowerState(borrower.address, borrowerState));

      const expectedTerms: LoanTerms = createLoanTerms(tokenAddress, durationInPeriods, borrowerConfig);
      const actualTerms: LoanTerms = await creditLine.determineLoanTerms(
        borrower.address,
        borrowedAmount,
        durationInPeriods
      );

      checkEquality(actualTerms, expectedTerms);
    }

    it("Executes as expected if the borrowing policy is 'SingleActiveLoan'", async () => {
      await executeAndCheck(BorrowingPolicy.SingleActiveLoan);
    });

    it("Executes as expected if the borrowing policy is 'MultipleActiveLoan'", async () => {
      await executeAndCheck(BorrowingPolicy.MultipleActiveLoans);
    });

    it("Executes as expected if the borrowing policy is 'TotalActiveAmountLimit'", async () => {
      await executeAndCheck(BorrowingPolicy.TotalActiveAmountLimit);
    });

    it("Is reverted if the borrower address is zero", async () => {
      const { creditLine, borrowerConfig } = await setUpFixture(deployAndConfigureContractsWithBorrower);
      await expect(creditLine.determineLoanTerms(
        ZERO_ADDRESS, // borrower
        borrowerConfig.minBorrowedAmount,
        borrowerConfig.minDurationInPeriods
      )).to.be.revertedWithCustomError(creditLine, ERROR_NAME_ZERO_ADDRESS);
    });

    it("Is reverted if the borrowed amount is zero", async () => {
      const { creditLine, borrowerConfig } = await setUpFixture(deployAndConfigureContractsWithBorrower);
      await expect(creditLine.determineLoanTerms(
        borrower.address,
        0, // borrowedAmount
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
        borrowerConfig.minBorrowedAmount, // borrowedAmount
        borrowerConfig.minDurationInPeriods // durationInPeriods
      )).to.be.revertedWithCustomError(creditLine, ERROR_NAME_BORROWER_CONFIGURATION_EXPIRED);
    });

    it("Is reverted if the borrowed amount is greater than the max allowed one", async () => {
      const { creditLine, borrowerConfig } = await setUpFixture(deployAndConfigureContractsWithBorrower);
      await expect(creditLine.determineLoanTerms(
        borrower.address,
        borrowerConfig.maxBorrowedAmount + 1n, // borrowedAmount
        borrowerConfig.minDurationInPeriods // durationInPeriods
      )).to.be.revertedWithCustomError(creditLine, ERROR_NAME_INVALID_AMOUNT);
    });

    it("Is reverted if the borrowed amount is less than the min allowed one", async () => {
      const { creditLine, borrowerConfig } = await setUpFixture(deployAndConfigureContractsWithBorrower);
      await expect(creditLine.determineLoanTerms(
        borrower.address,
        borrowerConfig.minBorrowedAmount - 1n, // borrowedAmount
        borrowerConfig.minDurationInPeriods // durationInPeriods
      )).to.be.revertedWithCustomError(creditLine, ERROR_NAME_INVALID_AMOUNT);
    });

    it("Is reverted if the loan duration is less than the min allowed one", async () => {
      const { creditLine, borrowerConfig } = await setUpFixture(deployAndConfigureContractsWithBorrower);
      await expect(creditLine.determineLoanTerms(
        borrower.address,
        borrowerConfig.minBorrowedAmount, // borrowedAmount
        borrowerConfig.minDurationInPeriods - 1n // durationInPeriods
      )).to.be.revertedWithCustomError(creditLine, ERROR_NAME_LOAN_DURATION_OUT_OF_RANGE);
    });

    it("Is reverted if the loan duration is greater than the max allowed one", async () => {
      const { creditLine, borrowerConfig } = await setUpFixture(deployAndConfigureContractsWithBorrower);
      await expect(creditLine.determineLoanTerms(
        borrower.address,
        borrowerConfig.minBorrowedAmount, // borrowedAmount
        borrowerConfig.maxDurationInPeriods + 1n // durationInPeriods
      )).to.be.revertedWithCustomError(creditLine, ERROR_NAME_LOAN_DURATION_OUT_OF_RANGE);
    });

    it("Is reverted if the borrowing policy is 'SingleActiveLoan' but there is another active loan", async () => {
      const fixture = await setUpFixture(deployAndConfigureContractsWithBorrower);
      const { creditLine, creditLineUnderAdmin, borrowerConfig } = fixture;
      const borrowerConfigNew = { ...borrowerConfig, borrowingPolicy: BorrowingPolicy.SingleActiveLoan };
      const borrowerState: BorrowerState = {
        ...defaultBorrowerState,
        activeLoanCount: 1n
      };
      await proveTx(creditLineUnderAdmin.configureBorrower(borrower.address, borrowerConfigNew));
      await proveTx(creditLineUnderAdmin.setBorrowerState(borrower.address, borrowerState));

      await expect(creditLine.determineLoanTerms(
        borrower.address,
        borrowerConfig.minBorrowedAmount, // borrowedAmount
        borrowerConfig.minDurationInPeriods // durationInPeriods
      )).to.revertedWithCustomError(creditLine, ERROR_NAME_LIMIT_VIOLATION_ON_SINGLE_ACTIVE_LOAN);
    });

    it("Is reverted if the borrowing policy is 'TotalActiveAmountLimit' but total amount excess happens", async () => {
      const fixture = await setUpFixture(deployAndConfigureContractsWithBorrower);
      const { creditLine, creditLineUnderAdmin, borrowerConfig } = fixture;
      const borrowerConfigNew = { ...borrowerConfig, borrowingPolicy: BorrowingPolicy.TotalActiveAmountLimit };
      const borrowerState: BorrowerState = {
        ...defaultBorrowerState,
        totalActiveLoanAmount: borrowerConfig.maxBorrowedAmount - BORROWED_AMOUNT + 1n
      };
      await proveTx(creditLineUnderAdmin.configureBorrower(borrower.address, borrowerConfigNew));
      await proveTx(creditLineUnderAdmin.setBorrowerState(borrower.address, borrowerState));

      await expect(creditLine.determineLoanTerms(
        borrower.address,
        BORROWED_AMOUNT,
        borrowerConfig.minDurationInPeriods // durationInPeriods
      )).to.revertedWithCustomError(
        creditLine,
        ERROR_NAME_LIMIT_VIOLATION_ON_TOTAL_ACTIVE_LOAN_AMOUNT
      ).withArgs(borrowerState.totalActiveLoanAmount + BigInt(BORROWED_AMOUNT));
    });
  });

  describe("Function 'determineLateFeeAmount()'", async () => {
    it("Returns the expected value", async () => {
      const { creditLine, creditLineConfig } = await setUpFixture(deployAndConfigureContractsWithBorrower);
      const lateFeeRate = INTEREST_RATE_FACTOR / 1000n;
      const creditLineConfigNew = { ...creditLineConfig, lateFeeRate };
      await proveTx(creditLine.configureCreditLine(creditLineConfigNew));

      const borrowerAddress = borrower.address;

      let loanTrackedBalance = 0n;
      let actualValue = await creditLine.determineLateFeeAmount(borrowerAddress, loanTrackedBalance);
      let expectedValue = 0n; // round(loanTrackedBalance * lateFeeRate / INTEREST_RATE_FACTOR)
      expect(actualValue).to.equal(expectedValue);

      loanTrackedBalance = 1000n;
      actualValue = await creditLine.determineLateFeeAmount(borrowerAddress, loanTrackedBalance);
      expectedValue = 1n; // round(loanTrackedBalance * lateFeeRate / INTEREST_RATE_FACTOR)
      expect(actualValue).to.equal(expectedValue);

      loanTrackedBalance = 1499n;
      actualValue = await creditLine.determineLateFeeAmount(borrowerAddress, loanTrackedBalance);
      expectedValue = 1n; // round(loanTrackedBalance * lateFeeRate / INTEREST_RATE_FACTOR)
      expect(actualValue).to.equal(expectedValue);

      loanTrackedBalance = 1500n;
      actualValue = await creditLine.determineLateFeeAmount(borrowerAddress, loanTrackedBalance);
      expectedValue = 2n; // round(loanTrackedBalance * lateFeeRate / INTEREST_RATE_FACTOR)
      expect(actualValue).to.equal(expectedValue);
    });
  });

  describe("Function 'migrateAccessControl()'", async () => {
    it("Executes as expected", async () => {
      const { creditLine } = await setUpFixture(deployAndConfigureContractsWithBorrower);
      await proveTx(creditLine.setRoleAdmin(OWNER_ROLE, DEFAULT_ADMIN_ROLE));

      expect(await creditLine.getRoleAdmin(OWNER_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);

      await proveTx(creditLine.migrateAccessControl());

      expect(await creditLine.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE);
    });

    it("Is reverted if the caller does not have the owner role", async () => {
      const { creditLine } = await setUpFixture(deployAndConfigureContractsWithBorrower);

      await expect(connect(creditLine, admin).migrateAccessControl())
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(admin.address, OWNER_ROLE);
      await expect(connect(creditLine, attacker).migrateAccessControl())
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(attacker.address, OWNER_ROLE);
    });
  });
});
