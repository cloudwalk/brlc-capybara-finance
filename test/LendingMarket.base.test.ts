import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory, TransactionResponse } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  connect,
  getAddress,
  getBlockTimestamp,
  getLatestBlockTimestamp,
  getNumberOfEvents,
  getTxTimestamp,
  increaseBlockTimestampTo,
  proveTx
} from "../test-utils/eth";
import { checkEquality, maxUintForBits, roundMath, setUpFixture } from "../test-utils/common";

enum LoanType {
  Ordinary = 0,
  Installment = 1
}

interface LoanTerms {
  token: string;
  addonAmount: number;
  durationInPeriods: number;
  interestRatePrimary: number;
  interestRateSecondary: number;
}

interface LoanConfig {
  lateFeeRate: number;
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
  firstInstallmentId: number;
  installmentCount: number;
  lateFeeAmount: number;

  [key: string]: string | number; // Index signature
}

interface Loan {
  id: number;
  config: LoanConfig;
  state: LoanState;
}

interface LoanPreview {
  periodIndex: number;
  trackedBalance: number;
  outstandingBalance: number;

  [key: string]: number; // Index signature
}

interface LoanPreviewExtended {
  periodIndex: number;
  trackedBalance: number;
  outstandingBalance: number;
  borrowAmount: number;
  addonAmount: number;
  repaidAmount: number;
  lateFeeAmount: number;
  programId: number;
  borrower: string;
  previewTimestamp: number;
  startTimestamp: number;
  trackedTimestamp: number;
  freezeTimestamp: number;
  durationInPeriods: number;
  interestRatePrimary: number;
  interestRateSecondary: number;
  firstInstallmentId: number;
  installmentCount: number;

  [key: string]: number | string; // Index signature
}

interface InstallmentLoanPreview {
  firstInstallmentId: number;
  installmentCount: number;
  periodIndex: number;
  totalTrackedBalance: number;
  totalOutstandingBalance: number;
  totalBorrowAmount: number;
  totalAddonAmount: number;
  totalRepaidAmount: number;
  totalLateFeeAmount: number;
  installmentPreviews: LoanPreviewExtended[];

  [key: string]: number | LoanPreviewExtended[]; // Index signature
}

interface Fixture {
  market: Contract;
  marketUnderLender: Contract;
  marketAddress: string;
  ordinaryLoan: Loan;
  ordinaryLoanStartPeriod: number;
  installmentLoanParts: Loan[];
  installmentLoanStartPeriodIndex: number;
}

interface Version {
  major: number;
  minor: number;
  patch: number;

  [key: string]: number; // Indexing signature to ensure that fields are iterated over in a key-value style
}

enum PayerKind {
  Borrower = 0,
  LiquidityPool = 1,
  Stranger = 2
}

const ERROR_NAME_ALREADY_CONFIGURED = "AlreadyConfigured";
const ERROR_NAME_ALREADY_INITIALIZED = "InvalidInitialization";
const ERROR_NAME_CONTRACT_ADDRESS_INVALID = "ContractAddressInvalid";
const ERROR_NAME_CREDIT_LINE_LENDER_NOT_CONFIGURED = "CreditLineLenderNotConfigured";
const ERROR_NAME_ENFORCED_PAUSED = "EnforcedPause";
const ERROR_NAME_LOAN_ALREADY_FROZEN = "LoanAlreadyFrozen";
const ERROR_NAME_LOAN_ALREADY_REPAID = "LoanAlreadyRepaid";
const ERROR_NAME_LOAN_NOT_EXIST = "LoanNotExist";
const ERROR_NAME_LOAN_NOT_FROZEN = "LoanNotFrozen";
const ERROR_NAME_INAPPROPRIATE_DURATION_IN_PERIODS = "InappropriateLoanDuration";
const ERROR_NAME_INAPPROPRIATE_INTEREST_RATE = "InappropriateInterestRate";
const ERROR_NAME_INVALID_AMOUNT = "InvalidAmount";
const ERROR_NAME_LIQUIDITY_POOL_LENDER_NOT_CONFIGURED = "LiquidityPoolLenderNotConfigured";
const ERROR_NAME_NOT_PAUSED = "ExpectedPause";
const ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED = "AccessControlUnauthorizedAccount";
const ERROR_NAME_UNAUTHORIZED = "Unauthorized";
const ERROR_NAME_ZERO_ADDRESS = "ZeroAddress";
const ERROR_NAME_PROGRAM_NOT_EXIST = "ProgramNotExist";
const ERROR_NAME_COOLDOWN_PERIOD_PASSED = "CooldownPeriodHasPassed";
const ERROR_NAME_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST = "SafeCastOverflowedUintDowncast";
const ERROR_NAME_DURATION_ARRAY_INVALID = "DurationArrayInvalid";
const ERROR_NAME_INSTALLMENT_COUNT_EXCESS = "InstallmentCountExcess";
const ERROR_NAME_ARRAY_LENGTH_MISMATCH = "ArrayLengthMismatch";
const ERROR_NAME_LOAN_TYPE_UNEXPECTED = "LoanTypeUnexpected";
const ERROR_NAME_LOAN_ID_EXCESS = "LoanIdExcess";

const EVENT_NAME_CREDIT_LINE_REGISTERED = "CreditLineRegistered";
const EVENT_NAME_LENDER_ALIAS_CONFIGURED = "LenderAliasConfigured";
const EVENT_NAME_PROGRAM_CREATED = "ProgramCreated";
const EVENT_NAME_PROGRAM_UPDATED = "ProgramUpdated";
const EVENT_NAME_LIQUIDITY_POOL_REGISTERED = "LiquidityPoolRegistered";
const EVENT_NAME_LOAN_INTEREST_RATE_PRIMARY_UPDATED = "LoanInterestRatePrimaryUpdated";
const EVENT_NAME_LOAN_INTEREST_RATE_SECONDARY_UPDATED = "LoanInterestRateSecondaryUpdated";
const EVENT_NAME_LOAN_DURATION_UPDATED = "LoanDurationUpdated";
const EVENT_NAME_LOAN_FROZEN = "LoanFrozen";
const EVENT_NAME_LOAN_REPAYMENT = "LoanRepayment";
const EVENT_NAME_LOAN_TAKEN = "LoanTaken";
const EVENT_NAME_INSTALLMENT_LOAN_TAKEN = "InstallmentLoanTaken";
const EVENT_NAME_LOAN_UNFROZEN = "LoanUnfrozen";
const EVENT_NAME_ON_BEFORE_LOAN_TAKEN = "OnBeforeLoanTakenCalled";
const EVENT_NAME_ON_AFTER_LOAN_PAYMENT = "OnAfterLoanPaymentCalled";
const EVENT_NAME_PAUSED = "Paused";
const EVENT_NAME_UNPAUSED = "Unpaused";
const EVENT_NAME_LOAN_REVOKED = "LoanRevoked";
const EVENT_NAME_INSTALLMENT_LOAN_REVOKED = "InstallmentLoanRevoked";
const EVENT_NAME_ON_AFTER_LOAN_REVOCATION = "OnAfterLoanRevocationCalled";
const EVENT_NAME_TRANSFER = "Transfer";

const OWNER_ROLE = ethers.id("OWNER_ROLE");

const ZERO_ADDRESS = ethers.ZeroAddress;
const ACCURACY_FACTOR = 10_000;
const INITIAL_BALANCE = 1000_000_000_000;
const BORROW_AMOUNT = 100_000_000_000;
const ADDON_AMOUNT = 100_000;
const REPAYMENT_AMOUNT = 50_000_000_000;
const FULL_REPAYMENT_AMOUNT = ethers.MaxUint256;
const INTEREST_RATE_FACTOR = 10 ** 9;
const INTEREST_RATE_PRIMARY = INTEREST_RATE_FACTOR / 10;
const INTEREST_RATE_SECONDARY = INTEREST_RATE_FACTOR / 5;
const LATE_FEE_RATE = INTEREST_RATE_FACTOR / 50; // 2%
const PERIOD_IN_SECONDS = 86400;
const DURATION_IN_PERIODS = 10;
const ALIAS_STATUS_CONFIGURED = true;
const ALIAS_STATUS_NOT_CONFIGURED = false;
const PROGRAM_ID = 1;
const NEGATIVE_TIME_OFFSET = 3 * 60 * 60; // 3 hours
const COOLDOWN_IN_PERIODS = 3;

const INSTALLMENT_COUNT = 3;
const BORROW_AMOUNTS: number[] = [BORROW_AMOUNT * 3 - 2, BORROW_AMOUNT * 2 + 1, BORROW_AMOUNT + 1];
const ADDON_AMOUNTS: number[] = [ADDON_AMOUNT * 3 - 2, ADDON_AMOUNT * 2 + 1, ADDON_AMOUNT + 1];
const DURATIONS_IN_PERIODS: number[] = [0, DURATION_IN_PERIODS / 2, DURATION_IN_PERIODS];

const EXPECTED_VERSION: Version = {
  major: 1,
  minor: 6,
  patch: 0
};

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
  freezeTimestamp: 0,
  firstInstallmentId: 0,
  installmentCount: 0,
  lateFeeAmount: 0
};

const defaultLoanConfig: LoanConfig = {
  lateFeeRate: 0
};

const defaultLoan: Loan = {
  state: defaultLoanState,
  config: defaultLoanConfig,
  id: 0
};

function clone(originLoan: Loan): Loan {
  return {
    state: { ...originLoan.state },
    config: { ...originLoan.config },
    id: originLoan.id
  };
}

async function deployAndConnectContract(
  contractFactory: ContractFactory,
  account: HardhatEthersSigner
): Promise<Contract> {
  let contract = (await contractFactory.deploy()) as Contract;
  await contract.waitForDeployment();
  contract = connect(contract, account); // Explicitly specifying the initial account
  return contract;
}

async function getLoanStates(contract: Contract, lonaIds: number[]): Promise<LoanState[]> {
  const loanStatePromises: Promise<LoanState>[] = [];
  for (const loanId of lonaIds) {
    loanStatePromises.push(contract.getLoanState(loanId));
  }
  return Promise.all(loanStatePromises);
}

function checkInstallmentLoanPreviewEquality(
  actualPreview: InstallmentLoanPreview,
  expectedPreview: InstallmentLoanPreview
) {
  checkEquality(
    actualPreview,
    expectedPreview,
    undefined, // index
    { ignoreObjects: true }
  );
  expect(actualPreview.installmentPreviews.length).to.eq(expectedPreview.installmentPreviews.length);
  for (let i = 0; i < expectedPreview.installmentPreviews.length; i++) {
    checkEquality(actualPreview.installmentPreviews[i], expectedPreview.installmentPreviews[i], i);
  }
}

describe("Contract 'LendingMarket': base tests", async () => {
  let lendingMarketFactory: ContractFactory;
  let creditLineFactory: ContractFactory;
  let liquidityPoolFactory: ContractFactory;
  let tokenFactory: ContractFactory;

  let creditLine: Contract;
  let anotherCreditLine: Contract;
  let liquidityPool: Contract;
  let anotherLiquidityPool: Contract;
  let token: Contract;

  let owner: HardhatEthersSigner;
  let lender: HardhatEthersSigner;
  let borrower: HardhatEthersSigner;
  let alias: HardhatEthersSigner;
  let attacker: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;
  let addonTreasury: HardhatEthersSigner;

  let creditLineAddress: string;
  let anotherCreditLineAddress: string;
  let liquidityPoolAddress: string;
  let anotherLiquidityPoolAddress: string;
  let tokenAddress: string;

  before(async () => {
    [owner, lender, borrower, alias, attacker, stranger, addonTreasury] = await ethers.getSigners();

    // Factories with an explicitly specified deployer account
    lendingMarketFactory = await ethers.getContractFactory("LendingMarketTestable");
    lendingMarketFactory = lendingMarketFactory.connect(owner);
    creditLineFactory = await ethers.getContractFactory("CreditLineMock");
    creditLineFactory = creditLineFactory.connect(owner);
    liquidityPoolFactory = await ethers.getContractFactory("LiquidityPoolMock");
    liquidityPoolFactory = liquidityPoolFactory.connect(owner);
    tokenFactory = await ethers.getContractFactory("ERC20Mock");
    tokenFactory = tokenFactory.connect(owner);

    creditLine = await deployAndConnectContract(creditLineFactory, owner);
    anotherCreditLine = await deployAndConnectContract(creditLineFactory, owner);
    liquidityPool = await deployAndConnectContract(liquidityPoolFactory, owner);
    anotherLiquidityPool = await deployAndConnectContract(liquidityPoolFactory, owner);
    token = await deployAndConnectContract(tokenFactory, owner);

    creditLineAddress = getAddress(creditLine);
    anotherCreditLineAddress = getAddress(anotherCreditLine);
    liquidityPoolAddress = getAddress(liquidityPool);
    anotherLiquidityPoolAddress = getAddress(anotherLiquidityPool);
    tokenAddress = getAddress(token);

    // Start tests at the beginning of a loan period to avoid rare failures due to crossing a border between two periods
    const periodIndex = calculatePeriodIndex(calculateTimestampWithOffset(await getLatestBlockTimestamp()));
    await increaseBlockTimestampToPeriodIndex(periodIndex + 1);
  });

  function creatLoanTerms(): LoanTerms {
    return {
      token: tokenAddress,
      addonAmount: ADDON_AMOUNT,
      durationInPeriods: DURATION_IN_PERIODS,
      interestRatePrimary: INTEREST_RATE_PRIMARY,
      interestRateSecondary: INTEREST_RATE_SECONDARY
    };
  }

  function createLoan(props: {
    id: number;
    borrowAmount: number;
    addonAmount: number;
    lateFeeRate: number;
    timestamp: number;
  }): Loan {
    const timestampWithOffset = calculateTimestampWithOffset(props.timestamp);
    const loanState: LoanState = {
      ...defaultLoanState,
      programId: PROGRAM_ID,
      borrowAmount: props.borrowAmount,
      addonAmount: props.addonAmount,
      startTimestamp: timestampWithOffset,
      durationInPeriods: DURATION_IN_PERIODS,
      token: tokenAddress,
      borrower: borrower.address,
      interestRatePrimary: INTEREST_RATE_PRIMARY,
      interestRateSecondary: INTEREST_RATE_SECONDARY,
      trackedBalance: props.borrowAmount + props.addonAmount,
      trackedTimestamp: timestampWithOffset
    };
    const loanConfig: LoanConfig = {
      ...defaultLoanConfig,
      lateFeeRate: props.lateFeeRate
    };
    return {
      id: props.id,
      state: loanState,
      config: loanConfig
    };
  }

  function createInstallmentLoanParts(props: {
    firstInstallmentId: number;
    borrowAmounts: number[];
    addonAmounts: number[];
    durations: number[];
    lateFeeRate: number;
    timestamp: number;
  }): Loan[] {
    const timestampWithOffset = calculateTimestampWithOffset(props.timestamp);
    const loans: Loan[] = [];
    for (let i = 0; i < props.borrowAmounts.length; ++i) {
      const loanState = {
        ...defaultLoanState,
        programId: PROGRAM_ID,
        borrowAmount: props.borrowAmounts[i],
        addonAmount: props.addonAmounts[i],
        startTimestamp: timestampWithOffset,
        durationInPeriods: DURATIONS_IN_PERIODS[i],
        token: tokenAddress,
        borrower: borrower.address,
        interestRatePrimary: INTEREST_RATE_PRIMARY,
        interestRateSecondary: INTEREST_RATE_SECONDARY,
        trackedBalance: props.borrowAmounts[i] + props.addonAmounts[i],
        trackedTimestamp: timestampWithOffset,
        firstInstallmentId: props.firstInstallmentId,
        installmentCount: props.borrowAmounts.length
      };
      const loanConfig: LoanConfig = {
        ...defaultLoanConfig,
        lateFeeRate: props.lateFeeRate
      };
      loans.push({ id: props.firstInstallmentId + i, state: loanState, config: loanConfig });
    }
    return loans;
  }

  function calculateOutstandingBalance(originalBalance: number, numberOfPeriods: number, interestRate: number): number {
    return Math.round(originalBalance * Math.pow(1 + interestRate / INTEREST_RATE_FACTOR, numberOfPeriods));
  }

  function calculatePeriodIndex(timestamp: number): number {
    return Math.floor(timestamp / PERIOD_IN_SECONDS);
  }

  function calculateTimestampWithOffset(timestamp: number) {
    return timestamp - NEGATIVE_TIME_OFFSET;
  }

  function removeTimestampOffset(timestamp: number) {
    return timestamp + NEGATIVE_TIME_OFFSET;
  }

  async function increaseBlockTimestampToPeriodIndex(periodIndex: number): Promise<number> {
    const featureTimestamp = removeTimestampOffset(periodIndex * PERIOD_IN_SECONDS);
    await increaseBlockTimestampTo(featureTimestamp);
    return featureTimestamp;
  }

  function determineLateFeeAmount(loan: Loan, timestamp: number): number {
    let timestampWithOffset = calculateTimestampWithOffset(timestamp);
    if (loan.state.freezeTimestamp != 0) {
      timestampWithOffset = loan.state.freezeTimestamp;
    }
    const periodIndex = calculatePeriodIndex(timestampWithOffset);
    const trackedPeriodIndex = calculatePeriodIndex(loan.state.trackedTimestamp);
    const startPeriodIndex = calculatePeriodIndex(loan.state.startTimestamp);
    const duePeriodIndex = startPeriodIndex + loan.state.durationInPeriods;

    if (periodIndex > duePeriodIndex && trackedPeriodIndex <= duePeriodIndex) {
      const outstandingBalance = calculateOutstandingBalance(
        loan.state.trackedBalance,
        duePeriodIndex - trackedPeriodIndex,
        loan.state.interestRatePrimary
      );
      return Math.round(outstandingBalance * loan.config.lateFeeRate / INTEREST_RATE_FACTOR);
    } else {
      return 0;
    }
  }

  function determineLoanPreview(loan: Loan, timestamp: number): LoanPreview {
    let outstandingBalance = loan.state.trackedBalance;
    let timestampWithOffset = calculateTimestampWithOffset(timestamp);
    if (loan.state.freezeTimestamp != 0) {
      timestampWithOffset = loan.state.freezeTimestamp;
    }
    const periodIndex = calculatePeriodIndex(timestampWithOffset);
    const trackedPeriodIndex = calculatePeriodIndex(loan.state.trackedTimestamp);
    const startPeriodIndex = calculatePeriodIndex(loan.state.startTimestamp);
    const duePeriodIndex = startPeriodIndex + loan.state.durationInPeriods;
    const numberOfPeriods = periodIndex - trackedPeriodIndex;
    const numberOfPeriodsWithSecondaryRate =
      trackedPeriodIndex > duePeriodIndex ? numberOfPeriods : periodIndex - duePeriodIndex;
    const numberOfPeriodsWithPrimaryRate =
      numberOfPeriodsWithSecondaryRate > 0 ? numberOfPeriods - numberOfPeriodsWithSecondaryRate : numberOfPeriods;

    if (numberOfPeriodsWithPrimaryRate > 0) {
      outstandingBalance = calculateOutstandingBalance(
        outstandingBalance,
        numberOfPeriodsWithPrimaryRate,
        loan.state.interestRatePrimary
      );
    }

    if (numberOfPeriodsWithSecondaryRate > 0) {
      outstandingBalance += determineLateFeeAmount(loan, timestamp);
      outstandingBalance = calculateOutstandingBalance(
        outstandingBalance,
        numberOfPeriodsWithSecondaryRate,
        loan.state.interestRateSecondary
      );
    }
    return {
      periodIndex,
      trackedBalance: outstandingBalance,
      outstandingBalance: Number(roundMath(outstandingBalance, ACCURACY_FACTOR))
    };
  }

  function determineLoanPreviewExtended(loan: Loan, timestamp: number): LoanPreviewExtended {
    const loanPreview: LoanPreview = determineLoanPreview(loan, timestamp);
    const lateFeeAmount = determineLateFeeAmount(loan, timestamp);
    return {
      periodIndex: loanPreview.periodIndex,
      trackedBalance: loanPreview.trackedBalance,
      outstandingBalance: loanPreview.outstandingBalance,
      borrowAmount: loan.state.borrowAmount,
      addonAmount: loan.state.addonAmount,
      repaidAmount: loan.state.repaidAmount,
      lateFeeAmount: loan.state.lateFeeAmount + lateFeeAmount,
      programId: loan.state.programId,
      borrower: loan.state.borrower,
      previewTimestamp: calculateTimestampWithOffset(timestamp),
      startTimestamp: loan.state.startTimestamp,
      trackedTimestamp: loan.state.trackedTimestamp,
      freezeTimestamp: loan.state.freezeTimestamp,
      durationInPeriods: loan.state.durationInPeriods,
      interestRatePrimary: loan.state.interestRatePrimary,
      interestRateSecondary: loan.state.interestRateSecondary,
      firstInstallmentId: loan.state.firstInstallmentId,
      installmentCount: loan.state.installmentCount
    };
  }

  function defineInstallmentLoanPreview(loans: Loan[], timestamp: number): InstallmentLoanPreview {
    const loanPreviews: LoanPreviewExtended[] = loans.map(loan => determineLoanPreviewExtended(loan, timestamp));
    return {
      firstInstallmentId: loans[0].state.firstInstallmentId,
      installmentCount: loans[0].state.installmentCount,
      periodIndex: loanPreviews[0].periodIndex,
      totalTrackedBalance: loanPreviews
        .map(preview => preview.trackedBalance)
        .reduce((sum, amount) => sum + amount),
      totalOutstandingBalance: loanPreviews
        .map(preview => preview.outstandingBalance)
        .reduce((sum, amount) => sum + amount),
      totalBorrowAmount: loans.map(loan => loan.state.borrowAmount).reduce((sum, amount) => sum + amount),
      totalAddonAmount: loans.map(loan => loan.state.addonAmount).reduce((sum, amount) => sum + amount),
      totalRepaidAmount: loans.map(loan => loan.state.repaidAmount).reduce((sum, amount) => sum + amount),
      totalLateFeeAmount: loanPreviews.map(preview => preview.lateFeeAmount).reduce((sum, amount) => sum + amount),
      installmentPreviews: loanPreviews
    };
  }

  function processRepayment(loan: Loan, props: {
    repaymentAmount: number | bigint;
    repaymentTimestamp: number;
  }) {
    const repaymentTimestampWithOffset = calculateTimestampWithOffset(props.repaymentTimestamp);
    if (loan.state.trackedTimestamp >= repaymentTimestampWithOffset) {
      return;
    }
    let repaymentAmount = props.repaymentAmount;
    const loanPreviewBeforeRepayment = determineLoanPreview(loan, props.repaymentTimestamp);
    loan.state.lateFeeAmount = determineLateFeeAmount(loan, props.repaymentTimestamp);
    if (loanPreviewBeforeRepayment.outstandingBalance === repaymentAmount) {
      repaymentAmount = FULL_REPAYMENT_AMOUNT;
    }
    if (repaymentAmount === FULL_REPAYMENT_AMOUNT) {
      loan.state.trackedBalance = 0;
      loan.state.repaidAmount += loanPreviewBeforeRepayment.outstandingBalance;
    } else {
      repaymentAmount = Number(repaymentAmount);
      loan.state.trackedBalance = loanPreviewBeforeRepayment.trackedBalance - repaymentAmount;
      loan.state.repaidAmount += repaymentAmount;
    }
    loan.state.trackedTimestamp = repaymentTimestampWithOffset;
  }

  async function deployLendingMarket(): Promise<Fixture> {
    let market = await upgrades.deployProxy(lendingMarketFactory, [owner.address]);

    market = connect(market, owner); // Explicitly specifying the initial account
    const marketUnderLender = connect(market, lender);
    const marketAddress = getAddress(market);

    return {
      market,
      marketUnderLender,
      marketAddress,
      ordinaryLoan: defaultLoan,
      ordinaryLoanStartPeriod: -1,
      installmentLoanParts: [],
      installmentLoanStartPeriodIndex: -1
    };
  }

  async function deployLendingMarketAndConfigureItForLoan(): Promise<Fixture> {
    const fixture: Fixture = await deployLendingMarket();
    const { marketUnderLender, marketAddress } = fixture;

    // register and configure a credit line & liquidity pool
    await proveTx(marketUnderLender.registerCreditLine(creditLineAddress));
    await proveTx(marketUnderLender.registerLiquidityPool(liquidityPoolAddress));
    await proveTx(marketUnderLender.createProgram(creditLineAddress, liquidityPoolAddress));

    // configure an alias
    await proveTx(marketUnderLender.configureAlias(alias.address, ALIAS_STATUS_CONFIGURED));

    // mock configurations
    await proveTx(creditLine.mockTokenAddress(tokenAddress));
    await proveTx(creditLine.mockLoanTerms(borrower.address, BORROW_AMOUNT, creatLoanTerms()));

    // supply tokens
    await proveTx(token.mint(lender.address, INITIAL_BALANCE));
    await proveTx(token.mint(borrower.address, INITIAL_BALANCE));
    await proveTx(token.mint(stranger.address, INITIAL_BALANCE));
    await proveTx(token.mint(liquidityPoolAddress, INITIAL_BALANCE));
    await proveTx(token.mint(addonTreasury.address, INITIAL_BALANCE));
    await proveTx(liquidityPool.approveMarket(marketAddress, tokenAddress));
    await proveTx(connect(token, borrower).approve(marketAddress, ethers.MaxUint256));
    await proveTx(connect(token, stranger).approve(marketAddress, ethers.MaxUint256));
    await proveTx(connect(token, addonTreasury).approve(marketAddress, ethers.MaxUint256));

    return fixture;
  }

  async function deployLendingMarketAndTakeLoans(): Promise<Fixture> {
    const fixture = await deployLendingMarketAndConfigureItForLoan();
    const { market, marketUnderLender } = fixture;

    // Configure the late fee rate
    const lateFeeRate = (LATE_FEE_RATE);
    await proveTx(creditLine.mockLateFeeRate(lateFeeRate));

    // Take an ordinary loan
    const ordinaryLoanId = Number(await market.loanCounter());
    const txReceipt1 = await proveTx(marketUnderLender.takeLoanFor(
      borrower.address,
      PROGRAM_ID,
      BORROW_AMOUNT,
      ADDON_AMOUNT,
      DURATION_IN_PERIODS
    ));
    fixture.ordinaryLoan = createLoan({
      id: ordinaryLoanId,
      borrowAmount: BORROW_AMOUNT,
      addonAmount: ADDON_AMOUNT,
      lateFeeRate,
      timestamp: await getBlockTimestamp(txReceipt1.blockNumber)
    });
    fixture.ordinaryLoanStartPeriod = calculatePeriodIndex(fixture.ordinaryLoan.state.startTimestamp);

    // Take an installment loan
    const firstInstallmentId = Number(await market.loanCounter());
    const txReceipt2 = await proveTx(marketUnderLender.takeInstallmentLoanFor(
      borrower.address,
      PROGRAM_ID,
      BORROW_AMOUNTS,
      ADDON_AMOUNTS,
      DURATIONS_IN_PERIODS
    ));

    const timestamp = await getBlockTimestamp(txReceipt2.blockNumber);
    fixture.installmentLoanParts = createInstallmentLoanParts({
      firstInstallmentId,
      borrowAmounts: BORROW_AMOUNTS,
      addonAmounts: ADDON_AMOUNTS,
      durations: DURATIONS_IN_PERIODS,
      lateFeeRate,
      timestamp
    });
    fixture.installmentLoanStartPeriodIndex =
      calculatePeriodIndex(fixture.installmentLoanParts[0].state.startTimestamp);
    return fixture;
  }

  describe("Function initialize()", async () => {
    it("Configures the contract as expected", async () => {
      const { market } = await setUpFixture(deployLendingMarket);

      // Role hashes
      expect(await market.OWNER_ROLE()).to.equal(OWNER_ROLE);

      // The role admins
      expect(await market.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE);

      // Only the owner should have the same role
      expect(await market.hasRole(OWNER_ROLE, owner.address)).to.equal(true);
      expect(await market.hasRole(OWNER_ROLE, lender.address)).to.equal(false);

      // The initial contract state is unpaused
      expect(await market.paused()).to.equal(false);

      // Other important parameters
      expect(await market.loanCounter()).to.eq(0);
      expect(await market.programCounter()).to.eq(0);
      expect(await market.interestRateFactor()).to.eq(INTEREST_RATE_FACTOR);
      expect(await market.periodInSeconds()).to.eq(PERIOD_IN_SECONDS);
      expect(await market.timeOffset()).to.deep.eq([NEGATIVE_TIME_OFFSET, false]);

      // Default values of the internal structures, mappings and variables. Also checks the set of fields
      const expectedLoanPreview: LoanPreview = determineLoanPreview(defaultLoan, await getLatestBlockTimestamp());
      const someLoanId = 123;
      checkEquality(await market.getLoanState(someLoanId), defaultLoanState);
      checkEquality(await market.getLoanPreview(someLoanId, 0), expectedLoanPreview);
      expect(await market.getProgramLender(PROGRAM_ID)).to.eq(ZERO_ADDRESS);
      expect(await market.getProgramCreditLine(PROGRAM_ID)).to.eq(ZERO_ADDRESS);
      expect(await market.getCreditLineLender(creditLineAddress)).to.eq(ZERO_ADDRESS);
      expect(await market.getLiquidityPoolLender(liquidityPoolAddress)).to.eq(ZERO_ADDRESS);
      expect(await market.isLenderOrAlias(someLoanId, lender.address)).to.eq(false);
      expect(await market.hasAlias(lender.address, lender.address)).to.eq(false);
    });

    it("Is reverted if called a second time", async () => {
      const { market } = await setUpFixture(deployLendingMarket);

      await expect(market.initialize(owner.address)).to.be.revertedWithCustomError(
        market,
        ERROR_NAME_ALREADY_INITIALIZED
      );
    });
  });

  describe("Function '$__VERSION()'", async () => {
    it("Returns expected values", async () => {
      const { market } = await setUpFixture(deployLendingMarket);
      const marketVersion = await market.$__VERSION();
      checkEquality(marketVersion, EXPECTED_VERSION);
    });
  });

  describe("Function 'pause()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { market } = await setUpFixture(deployLendingMarket);

      await expect(market.pause()).to.emit(market, EVENT_NAME_PAUSED).withArgs(owner.address);
      expect(await market.paused()).to.eq(true);
    });

    it("Is reverted if the caller does not have the owner role", async () => {
      const { market } = await setUpFixture(deployLendingMarket);

      await expect(connect(market, attacker).pause())
        .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(attacker.address, OWNER_ROLE);
    });

    it("Is reverted if the contract is already paused", async () => {
      const { market } = await setUpFixture(deployLendingMarket);

      await proveTx(market.pause());
      await expect(market.pause()).to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
    });
  });

  describe("Function 'unpause()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { market } = await setUpFixture(deployLendingMarket);

      await proveTx(market.pause());
      expect(await market.paused()).to.eq(true);

      await expect(market.unpause()).to.emit(market, EVENT_NAME_UNPAUSED).withArgs(owner.address);

      expect(await market.paused()).to.eq(false);
    });

    it("Is reverted if the caller does not have the owner role", async () => {
      const { market } = await setUpFixture(deployLendingMarket);

      await expect(connect(market, attacker).unpause())
        .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(attacker.address, OWNER_ROLE);
    });

    it("Is reverted if the contract is not paused yet", async () => {
      const { market } = await setUpFixture(deployLendingMarket);

      await expect(market.unpause()).to.be.revertedWithCustomError(market, ERROR_NAME_NOT_PAUSED);
    });
  });

  describe("Function 'configureAlias()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { market } = await setUpFixture(deployLendingMarket);

      await expect(connect(market, lender).configureAlias(alias.address, ALIAS_STATUS_CONFIGURED))
        .to.emit(market, EVENT_NAME_LENDER_ALIAS_CONFIGURED)
        .withArgs(lender.address, alias.address, ALIAS_STATUS_CONFIGURED);
      expect(await market.hasAlias(lender.address, alias.address)).to.eq(ALIAS_STATUS_CONFIGURED);

      await expect(connect(market, lender).configureAlias(alias.address, ALIAS_STATUS_NOT_CONFIGURED))
        .to.emit(market, EVENT_NAME_LENDER_ALIAS_CONFIGURED)
        .withArgs(lender.address, alias.address, ALIAS_STATUS_NOT_CONFIGURED);
      expect(await market.hasAlias(lender.address, alias.address)).to.eq(ALIAS_STATUS_NOT_CONFIGURED);
    });

    it("Is reverted if the contract is paused", async () => {
      const { market } = await setUpFixture(deployLendingMarket);
      await proveTx(market.pause());

      await expect(market.configureAlias(alias.address, ALIAS_STATUS_CONFIGURED))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the provided account address is zero", async () => {
      const { market } = await setUpFixture(deployLendingMarket);

      await expect(market.configureAlias(ZERO_ADDRESS, ALIAS_STATUS_CONFIGURED))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ZERO_ADDRESS);
    });

    it("Is reverted if the new alias state is the same as the previous one", async () => {
      const { market } = await setUpFixture(deployLendingMarket);
      await expect(market.configureAlias(alias.address, ALIAS_STATUS_NOT_CONFIGURED))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ALREADY_CONFIGURED);

      await proveTx(market.configureAlias(alias.address, ALIAS_STATUS_CONFIGURED));

      await expect(market.configureAlias(alias.address, ALIAS_STATUS_CONFIGURED))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ALREADY_CONFIGURED);
    });
  });

  describe("Function 'registerCreditLine()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { market } = await setUpFixture(deployLendingMarket);

      await expect(connect(market, stranger).registerCreditLine(creditLineAddress))
        .to.emit(market, EVENT_NAME_CREDIT_LINE_REGISTERED)
        .withArgs(stranger.address, creditLineAddress);

      expect(await market.getCreditLineLender(creditLineAddress)).to.eq(stranger.address);
    });

    it("Is reverted if the credit line address is zero", async () => {
      const { market } = await setUpFixture(deployLendingMarket);

      await expect(market.registerCreditLine(ZERO_ADDRESS))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ZERO_ADDRESS);
    });

    it("Is reverted if the same credit line is already registered", async () => {
      const { marketUnderLender } = await setUpFixture(deployLendingMarket);
      await proveTx(marketUnderLender.registerCreditLine(creditLineAddress));

      await expect(marketUnderLender.registerCreditLine(creditLineAddress))
        .to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_ALREADY_CONFIGURED);
    });

    it("Is reverted if the contract is paused", async () => {
      const { market } = await setUpFixture(deployLendingMarket);
      await proveTx(market.pause());

      await expect(market.registerCreditLine(creditLineAddress))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the provided address is not a contract", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoans);
      const wrongCreditLineAddress = "0x0000000000000000000000000000000000000001";

      await expect(market.registerCreditLine(wrongCreditLineAddress))
        .to.be.revertedWithCustomError(market, ERROR_NAME_CONTRACT_ADDRESS_INVALID);
    });

    it("Is reverted if the provided address is not a credit line contract", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoans);
      const wrongCreditLineAddress = (tokenAddress);

      await expect(market.registerCreditLine(wrongCreditLineAddress))
        .to.be.revertedWithCustomError(market, ERROR_NAME_CONTRACT_ADDRESS_INVALID);
    });
  });

  describe("Function 'registerLiquidityPool()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { market } = await setUpFixture(deployLendingMarket);

      await expect(connect(market, stranger).registerLiquidityPool(liquidityPoolAddress))
        .to.emit(market, EVENT_NAME_LIQUIDITY_POOL_REGISTERED)
        .withArgs(stranger.address, liquidityPoolAddress);

      expect(await market.getLiquidityPoolLender(liquidityPoolAddress)).to.eq(stranger.address);
    });

    it("Is reverted if the liquidity pool address is zero", async () => {
      const { market } = await setUpFixture(deployLendingMarket);

      await expect(market.registerLiquidityPool(ZERO_ADDRESS))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ZERO_ADDRESS);
    });

    it("Is reverted if the liquidity pool lender is already registered", async () => {
      const { marketUnderLender } = await setUpFixture(deployLendingMarket);

      // Any registered account as the lender must prohibit registration of the same liquidity pool
      await proveTx(marketUnderLender.registerLiquidityPool(liquidityPoolAddress));
      await expect(marketUnderLender.registerLiquidityPool(liquidityPoolAddress))
        .to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_ALREADY_CONFIGURED);
    });

    it("Is reverted if the contract is paused", async () => {
      const { market } = await setUpFixture(deployLendingMarket);
      await proveTx(market.pause());

      await expect(market.registerLiquidityPool(liquidityPoolAddress))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the provided address is not a contract", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoans);
      const wrongLiquidityPoolAddress = "0x0000000000000000000000000000000000000001";

      await expect(market.registerLiquidityPool(wrongLiquidityPoolAddress))
        .to.be.revertedWithCustomError(market, ERROR_NAME_CONTRACT_ADDRESS_INVALID);
    });

    it("Is reverted if the provided address is not a liquidity pool contract", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoans);
      const wrongLiquidityPoolAddress = (tokenAddress);

      await expect(market.registerLiquidityPool(wrongLiquidityPoolAddress))
        .to.be.revertedWithCustomError(market, ERROR_NAME_CONTRACT_ADDRESS_INVALID);
    });
  });

  describe("Function 'createProgram()'", async () => {
    it("Executes as expected and emits the correct events", async () => {
      const { marketUnderLender } = await setUpFixture(deployLendingMarket);
      await proveTx(marketUnderLender.registerCreditLine(creditLineAddress));
      await proveTx(marketUnderLender.registerLiquidityPool(liquidityPoolAddress));

      const tx = marketUnderLender.createProgram(creditLineAddress, liquidityPoolAddress);
      await expect(tx)
        .to.emit(marketUnderLender, EVENT_NAME_PROGRAM_CREATED)
        .withArgs(lender.address, PROGRAM_ID);
      await expect(tx)
        .to.emit(marketUnderLender, EVENT_NAME_PROGRAM_UPDATED)
        .withArgs(PROGRAM_ID, creditLineAddress, liquidityPoolAddress);

      expect(await marketUnderLender.getProgramLender(PROGRAM_ID)).to.eq(lender.address);
      expect(await marketUnderLender.getProgramCreditLine(PROGRAM_ID)).to.eq(creditLineAddress);
      expect(await marketUnderLender.getProgramLiquidityPool(PROGRAM_ID)).to.eq(liquidityPool);
    });

    it("Is reverted if the contract is paused", async () => {
      const { market } = await setUpFixture(deployLendingMarket);
      await proveTx(market.pause());

      await expect(market.createProgram(creditLineAddress, liquidityPoolAddress)).to.be.revertedWithCustomError(
        market,
        ERROR_NAME_ENFORCED_PAUSED
      );
    });

    it("Is reverted if the provided credit line address is zero", async () => {
      const { market } = await setUpFixture(deployLendingMarket);
      const wrongCreditLineAddress = (ZERO_ADDRESS);

      await expect(market.createProgram(wrongCreditLineAddress, liquidityPoolAddress))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ZERO_ADDRESS);
    });

    it("Is reverted if the provided liquidity pool address is zero", async () => {
      const { market } = await setUpFixture(deployLendingMarket);
      const wrongLiquidityPoolAddress = (ZERO_ADDRESS);

      await expect(market.createProgram(creditLineAddress, wrongLiquidityPoolAddress))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ZERO_ADDRESS);
    });

    it("Is reverted if the provided credit line is not registered", async () => {
      const { market } = await setUpFixture(deployLendingMarket);

      await expect(
        connect(market, attacker).createProgram(creditLineAddress, liquidityPoolAddress)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
    });

    it("Is reverted if the credit line is registered by other lender", async () => {
      const { market, marketUnderLender } = await setUpFixture(deployLendingMarket);
      await proveTx(connect(market, stranger).registerCreditLine(creditLineAddress));
      await proveTx(marketUnderLender.registerLiquidityPool(liquidityPoolAddress));

      await expect(
        connect(market, attacker).createProgram(creditLineAddress, liquidityPoolAddress)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
    });

    it("Is reverted if the liquidityPool is not registered", async () => {
      const { market, marketUnderLender } = await setUpFixture(deployLendingMarket);
      await proveTx(marketUnderLender.registerCreditLine(creditLineAddress));

      await expect(
        connect(market, attacker).createProgram(creditLineAddress, liquidityPoolAddress)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
    });

    it("Is reverted if the liquidityPool is registered by other lender", async () => {
      const { market, marketUnderLender } = await setUpFixture(deployLendingMarket);
      await proveTx(marketUnderLender.registerCreditLine(creditLineAddress));
      await proveTx(connect(market, stranger).registerLiquidityPool(liquidityPoolAddress));

      await expect(
        marketUnderLender.createProgram(creditLineAddress, liquidityPoolAddress)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
    });
  });

  describe("Function 'updateProgram()'", async () => {
    it("Executes as expected and emits correct event", async () => {
      const { market, marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
      await proveTx(marketUnderLender.registerCreditLine(anotherCreditLineAddress));
      await proveTx(marketUnderLender.registerLiquidityPool(anotherLiquidityPoolAddress));

      // Change the credit line address only
      await expect(marketUnderLender.updateProgram(PROGRAM_ID, anotherCreditLineAddress, liquidityPoolAddress))
        .to.emit(marketUnderLender, EVENT_NAME_PROGRAM_UPDATED)
        .withArgs(PROGRAM_ID, anotherCreditLineAddress, liquidityPoolAddress);
      expect(await marketUnderLender.getProgramLender(PROGRAM_ID)).to.eq(lender.address);
      expect(await market.getProgramCreditLine(PROGRAM_ID)).to.eq(anotherCreditLineAddress);
      expect(await market.getProgramLiquidityPool(PROGRAM_ID)).to.eq(liquidityPool);

      // Change the Liquidity pool address only
      await expect(marketUnderLender.updateProgram(PROGRAM_ID, anotherCreditLineAddress, anotherLiquidityPoolAddress))
        .to.emit(marketUnderLender, EVENT_NAME_PROGRAM_UPDATED)
        .withArgs(PROGRAM_ID, anotherCreditLineAddress, anotherLiquidityPoolAddress);
      expect(await marketUnderLender.getProgramLender(PROGRAM_ID)).to.eq(lender.address);
      expect(await market.getProgramCreditLine(PROGRAM_ID)).to.eq(anotherCreditLineAddress);
      expect(await market.getProgramLiquidityPool(PROGRAM_ID)).to.eq(anotherLiquidityPoolAddress);

      // Change the credit line and liquidity pool addresses together
      await expect(marketUnderLender.updateProgram(PROGRAM_ID, creditLineAddress, liquidityPoolAddress))
        .to.emit(marketUnderLender, EVENT_NAME_PROGRAM_UPDATED)
        .withArgs(PROGRAM_ID, creditLineAddress, liquidityPoolAddress);
      expect(await marketUnderLender.getProgramLender(PROGRAM_ID)).to.eq(lender.address);
      expect(await market.getProgramCreditLine(PROGRAM_ID)).to.eq(creditLineAddress);
      expect(await market.getProgramLiquidityPool(PROGRAM_ID)).to.eq(liquidityPoolAddress);
    });

    it("Is reverted if contract is paused", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
      await proveTx(market.pause());

      await expect(
        market.updateProgram(PROGRAM_ID, creditLineAddress, liquidityPoolAddress)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the provided program ID is zero", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
      const wrongProgramId = 0;

      await expect(market.updateProgram(wrongProgramId, creditLineAddress, liquidityPoolAddress))
        .to.be.revertedWithCustomError(market, ERROR_NAME_PROGRAM_NOT_EXIST);
    });

    it("Is reverted if caller is not the lender of the program", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);

      await expect(
        connect(market, attacker).updateProgram(PROGRAM_ID, creditLineAddress, liquidityPoolAddress)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
    });

    it("Is reverted if caller is not the lender of the creditLine", async () => {
      const { market, marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
      await proveTx(connect(market, attacker).registerCreditLine(anotherCreditLineAddress));

      await expect(
        marketUnderLender.updateProgram(PROGRAM_ID, anotherCreditLineAddress, liquidityPoolAddress)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
    });

    it("Is reverted if caller is not the lender of the liquidity pool", async () => {
      const { market, marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
      await proveTx(connect(market, attacker).registerLiquidityPool(anotherLiquidityPoolAddress));

      await expect(
        marketUnderLender.updateProgram(PROGRAM_ID, creditLineAddress, anotherLiquidityPoolAddress)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
    });
  });

  describe("Function 'takeLoan()'", async () => {
    async function executeAndCheck(props: { isAddonTreasuryConfigured: boolean }) {
      const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);

      const principalAmount = BORROW_AMOUNT + ADDON_AMOUNT;

      if (props.isAddonTreasuryConfigured) {
        await proveTx(liquidityPool.mockAddonTreasury(addonTreasury.address));
      }

      // Check the returned value of the function for the first loan
      const expectedLoanId = 0;
      const actualLoanId = await connect(market, borrower).takeLoan.staticCall(
        PROGRAM_ID,
        BORROW_AMOUNT,
        DURATION_IN_PERIODS
      );
      expect(actualLoanId).to.eq(expectedLoanId);

      const tx: Promise<TransactionResponse> = connect(market, borrower).takeLoan(
        PROGRAM_ID,
        BORROW_AMOUNT,
        DURATION_IN_PERIODS
      );
      const txReceipt = await proveTx(tx);
      const actualLoanState: LoanState = await market.getLoanState(expectedLoanId);
      const expectedLoan: Loan = createLoan({
        id: expectedLoanId,
        borrowAmount: BORROW_AMOUNT,
        addonAmount: ADDON_AMOUNT,
        lateFeeRate: 0,
        timestamp: await getBlockTimestamp(txReceipt.blockNumber)
      });

      checkEquality(actualLoanState, expectedLoan.state);
      expect(await market.loanCounter()).to.eq(expectedLoanId + 1);

      if (props.isAddonTreasuryConfigured) {
        await expect(tx).to.changeTokenBalances(
          token,
          [liquidityPool, borrower, addonTreasury, market],
          [-principalAmount, +BORROW_AMOUNT, +ADDON_AMOUNT, 0]
        );
      } else {
        await expect(tx).to.changeTokenBalances(
          token,
          [liquidityPool, borrower, addonTreasury, market],
          [-BORROW_AMOUNT, +BORROW_AMOUNT, 0, 0]
        );
      }

      await expect(tx)
        .to.emit(market, EVENT_NAME_LOAN_TAKEN)
        .withArgs(expectedLoanId, borrower.address, principalAmount, DURATION_IN_PERIODS);

      // Check that the appropriate market hook functions are called
      await expect(tx).to.emit(liquidityPool, EVENT_NAME_ON_BEFORE_LOAN_TAKEN).withArgs(expectedLoanId);
      await expect(tx).to.emit(creditLine, EVENT_NAME_ON_BEFORE_LOAN_TAKEN).withArgs(expectedLoanId);

      // Check the returned value of the function for the second loan
      const nextActualLoanId: bigint = await connect(market, borrower).takeLoan.staticCall(
        PROGRAM_ID,
        BORROW_AMOUNT,
        DURATION_IN_PERIODS
      );
      expect(nextActualLoanId).to.eq(expectedLoanId + 1);
    }

    describe("Executes as expected and emits the correct events if", async () => {
      it("The addon treasury is NOT configured on the liquidity pool", async () => {
        await executeAndCheck({ isAddonTreasuryConfigured: false });
      });

      it("The addon treasury is configured on the liquidity pool", async () => {
        await executeAndCheck({ isAddonTreasuryConfigured: true });
      });
    });

    describe("Is reverted if", async () => {
      it("The contract is paused", async () => {
        const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        await proveTx(market.pause());

        await expect(
          connect(market, borrower).takeLoan(PROGRAM_ID, BORROW_AMOUNT, DURATION_IN_PERIODS)
        ).to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
      });

      it("The passed program ID is zero", async () => {
        const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        const wrongProgramId = 0;

        await expect(market.takeLoan(wrongProgramId, BORROW_AMOUNT, DURATION_IN_PERIODS))
          .to.be.revertedWithCustomError(market, ERROR_NAME_PROGRAM_NOT_EXIST);
      });

      it("The borrow amount is zero", async () => {
        const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        const wrongBorrowAmount = 0;

        await expect(market.takeLoan(PROGRAM_ID, wrongBorrowAmount, DURATION_IN_PERIODS))
          .to.be.revertedWithCustomError(market, ERROR_NAME_INVALID_AMOUNT);
      });

      it("The borrow amount is not rounded according to the accuracy factor", async () => {
        const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        const wrongBorrowAmount = BORROW_AMOUNT - 1;

        await expect(
          market.takeLoan(PROGRAM_ID, wrongBorrowAmount, DURATION_IN_PERIODS)
        ).to.be.revertedWithCustomError(market, ERROR_NAME_INVALID_AMOUNT);
      });

      it("The credit line is not registered", async () => {
        const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        await proveTx(market.setCreditLineForProgram(PROGRAM_ID, ZERO_ADDRESS)); // Call via the testable version

        await expect(
          market.takeLoan(PROGRAM_ID, BORROW_AMOUNT, DURATION_IN_PERIODS)
        ).to.be.revertedWithCustomError(market, ERROR_NAME_CREDIT_LINE_LENDER_NOT_CONFIGURED);
      });

      it("The liquidity pool is not registered", async () => {
        const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        await proveTx(market.setLiquidityPoolForProgram(PROGRAM_ID, ZERO_ADDRESS)); // Call via the testable version

        await expect(
          market.takeLoan(PROGRAM_ID, BORROW_AMOUNT, DURATION_IN_PERIODS)
        ).to.be.revertedWithCustomError(market, ERROR_NAME_LIQUIDITY_POOL_LENDER_NOT_CONFIGURED);
      });
    });
  });

  describe("Function 'takeLoanFor()'", async () => {
    async function executeAndCheck(props: { isAddonTreasuryConfigured: boolean }) {
      const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);

      const addonAmount = BORROW_AMOUNT / 100;
      const principalAmount = BORROW_AMOUNT + addonAmount;
      const expectedLoanId = 0;

      if (props.isAddonTreasuryConfigured) {
        await proveTx(liquidityPool.mockAddonTreasury(addonTreasury.address));
      }

      // Check the returned value of the function for the first loan initiated by the lender
      let actualLoanId: bigint = await connect(market, lender).takeLoanFor.staticCall(
        borrower.address,
        PROGRAM_ID,
        BORROW_AMOUNT,
        addonAmount,
        DURATION_IN_PERIODS
      );
      expect(actualLoanId).to.eq(expectedLoanId);

      // Check the returned value of the function for the first loan initiated by the alias
      actualLoanId = await connect(market, alias).takeLoanFor.staticCall(
        borrower.address,
        PROGRAM_ID,
        BORROW_AMOUNT,
        addonAmount,
        DURATION_IN_PERIODS
      );
      expect(actualLoanId).to.eq(expectedLoanId);

      const tx: Promise<TransactionResponse> = connect(market, lender).takeLoanFor(
        borrower.address,
        PROGRAM_ID,
        BORROW_AMOUNT,
        addonAmount,
        DURATION_IN_PERIODS
      );
      const timestamp = await getTxTimestamp(tx);
      const actualLoanState: LoanState = await market.getLoanState(expectedLoanId);
      const expectedLoan: Loan = createLoan({
        id: expectedLoanId,
        borrowAmount: BORROW_AMOUNT,
        addonAmount,
        lateFeeRate: 0,
        timestamp
      });

      checkEquality(actualLoanState, expectedLoan.state);
      expect(await market.loanCounter()).to.eq(expectedLoanId + 1);

      if (props.isAddonTreasuryConfigured) {
        await expect(tx).to.changeTokenBalances(
          token,
          [liquidityPool, borrower, addonTreasury, market],
          [-principalAmount, +BORROW_AMOUNT, +addonAmount, 0]
        );
      } else {
        await expect(tx).to.changeTokenBalances(
          token,
          [liquidityPool, borrower, addonTreasury, market],
          [-BORROW_AMOUNT, +BORROW_AMOUNT, 0, 0]
        );
      }

      await expect(tx)
        .to.emit(market, EVENT_NAME_LOAN_TAKEN)
        .withArgs(expectedLoanId, borrower.address, principalAmount, DURATION_IN_PERIODS);

      // Check that the appropriate market hook functions are called
      await expect(tx).to.emit(liquidityPool, EVENT_NAME_ON_BEFORE_LOAN_TAKEN).withArgs(expectedLoanId);
      await expect(tx).to.emit(creditLine, EVENT_NAME_ON_BEFORE_LOAN_TAKEN).withArgs(expectedLoanId);

      // Check the returned value of the function for the second loan
      const nextActualLoanId: bigint = await connect(market, lender).takeLoanFor.staticCall(
        borrower.address,
        PROGRAM_ID,
        BORROW_AMOUNT,
        addonAmount,
        DURATION_IN_PERIODS
      );
      expect(nextActualLoanId).to.eq(expectedLoanId + 1);
    }

    describe("Executes as expected and emits the correct events if", async () => {
      it("The addon treasury is NOT configured on the liquidity pool", async () => {
        await executeAndCheck({ isAddonTreasuryConfigured: false });
      });

      it("The addon treasury is configured on the liquidity pool", async () => {
        await executeAndCheck({ isAddonTreasuryConfigured: true });
      });
    });

    describe("Is reverted if", async () => {
      it("The contract is paused", async () => {
        const { market, marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        await proveTx(market.pause());

        await expect(
          marketUnderLender.takeLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROW_AMOUNT,
            ADDON_AMOUNT,
            DURATION_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
      });

      it("The caller is not the lender or its alias", async () => {
        const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);

        await expect(
          connect(market, borrower).takeLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROW_AMOUNT,
            ADDON_AMOUNT,
            DURATION_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
      });

      it("Te borrower address is zero", async () => {
        const { marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        const wrongBorrowerAddress = (ZERO_ADDRESS);

        await expect(
          marketUnderLender.takeLoanFor(
            wrongBorrowerAddress,
            PROGRAM_ID,
            BORROW_AMOUNT,
            ADDON_AMOUNT,
            DURATION_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_ZERO_ADDRESS);
      });

      it("The program with the passed ID is not registered", async () => {
        const { marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        let wrongProgramId = 0;

        await expect(
          marketUnderLender.takeLoanFor(
            borrower.address,
            wrongProgramId,
            BORROW_AMOUNT,
            ADDON_AMOUNT,
            DURATION_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_UNAUTHORIZED);

        wrongProgramId = PROGRAM_ID + 1;
        await expect(
          marketUnderLender.takeLoanFor(
            borrower.address,
            wrongProgramId,
            BORROW_AMOUNT,
            ADDON_AMOUNT,
            DURATION_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_UNAUTHORIZED);
      });

      it("The borrow amount is zero", async () => {
        const { marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        const wrongBorrowAmount = 0;

        await expect(
          marketUnderLender.takeLoanFor(
            borrower.address,
            PROGRAM_ID,
            wrongBorrowAmount,
            ADDON_AMOUNT,
            DURATION_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_INVALID_AMOUNT);
      });

      it("The borrow amount is not rounded according to the accuracy factor", async () => {
        const { marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        const wrongBorrowAmount = BORROW_AMOUNT - 1;
        expect(wrongBorrowAmount % ACCURACY_FACTOR).not.to.eq(0);

        await expect(
          marketUnderLender.takeLoanFor(
            borrower.address,
            PROGRAM_ID,
            wrongBorrowAmount,
            ADDON_AMOUNT,
            DURATION_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_INVALID_AMOUNT);
      });

      it("The addon amount is not rounded according to the accuracy factor", async () => {
        const { marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        const wrongAddonAmount = ADDON_AMOUNT - 1;
        expect(wrongAddonAmount % ACCURACY_FACTOR).not.to.eq(0);

        await expect(
          marketUnderLender.takeLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROW_AMOUNT,
            wrongAddonAmount,
            DURATION_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_INVALID_AMOUNT);
      });

      it("The credit line is not registered", async () => {
        const { marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        await proveTx(
          marketUnderLender.setCreditLineForProgram(PROGRAM_ID, ZERO_ADDRESS) // Call via the testable version
        );

        await expect(
          marketUnderLender.takeLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROW_AMOUNT,
            ADDON_AMOUNT,
            DURATION_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_CREDIT_LINE_LENDER_NOT_CONFIGURED);
      });

      it("The liquidity pool is not registered", async () => {
        const { marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        await proveTx(
          marketUnderLender.setLiquidityPoolForProgram(PROGRAM_ID, ZERO_ADDRESS) // Call via the testable version
        );

        await expect(
          marketUnderLender.takeLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROW_AMOUNT,
            ADDON_AMOUNT,
            DURATION_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_LIQUIDITY_POOL_LENDER_NOT_CONFIGURED);
      });

      it("The loan ID counter is greater than the max allowed value", async () => {
        const { marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        await proveTx(marketUnderLender.setLoanIdCounter(maxUintForBits(40) + 1n));

        await expect(
          marketUnderLender.takeLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROW_AMOUNT,
            ADDON_AMOUNT,
            DURATION_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_LOAN_ID_EXCESS);
      });
    });
  });

  describe("Function 'takeInstallmentLoanFor()'", async () => {
    before(async () => {
      const totalBorrowAmount = BORROW_AMOUNTS.reduce((sum, amount) => sum + amount);
      const totalAddonAmount = ADDON_AMOUNTS.reduce((sum, amount) => sum + amount);

      // Check rounding of amounts
      expect(totalBorrowAmount % ACCURACY_FACTOR).to.eq(0, `totalBorrowAmount is unrounded, but must be`);
      expect(totalAddonAmount % ACCURACY_FACTOR).to.eq(0, `totalAddonAmount is unrounded, but must be`);
      for (let i = 0; i < INSTALLMENT_COUNT; ++i) {
        expect(BORROW_AMOUNTS[i] % ACCURACY_FACTOR).not.to.eq(0, `borrowAmounts[${i}] is rounded, but must not be`);
        expect(ADDON_AMOUNTS[i] % ACCURACY_FACTOR).not.to.eq(0, `addonAmounts[${i}] is rounded, but must not be`);
      }
    });

    async function executeAndCheck(props: {
      isAddonTreasuryConfigured: boolean;
      installmentCount: number;
    }) {
      const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
      const { installmentCount, isAddonTreasuryConfigured } = props;

      expect(installmentCount).not.greaterThan(INSTALLMENT_COUNT);

      if (isAddonTreasuryConfigured) {
        await proveTx(liquidityPool.mockAddonTreasury(addonTreasury.address));
      }

      const expectedLoanIds = Array.from({ length: installmentCount }, (_, i) => i);
      const borrowAmounts = BORROW_AMOUNTS.slice(0, installmentCount);
      const addonAmounts = ADDON_AMOUNTS.slice(0, installmentCount);
      const durationsInPeriods = DURATIONS_IN_PERIODS.slice(0, installmentCount);

      if (installmentCount > 2) {
        addonAmounts[1] = 0; // An addon amount can be zero
        addonAmounts[2] += 1; // Fix total addon amount rounding
      }
      if (installmentCount == 1) {
        borrowAmounts[0] = BORROW_AMOUNT;
        addonAmounts[0] = ADDON_AMOUNT;
      }
      const expectedLoanIdRange = [BigInt(expectedLoanIds[0]), BigInt(expectedLoanIds.length)];
      const totalBorrowAmount = borrowAmounts.reduce((sum, amount) => sum + amount);
      const totalAddonAmount = addonAmounts.reduce((sum, amount) => sum + amount);
      const principalAmounts: number[] = borrowAmounts.map((amount, i) => amount + addonAmounts[i]);
      const totalPrincipal = principalAmounts.reduce((sum, amount) => sum + amount);

      // Check rounding of amounts
      expect(totalBorrowAmount % ACCURACY_FACTOR).to.eq(0, `totalBorrowAmount is unrounded, but must be`);
      expect(totalAddonAmount % ACCURACY_FACTOR).to.eq(0, `totalAddonAmount is unrounded, but must be`);

      // Check the returned value of the function for the first loan initiated by the lender
      let actualLoanIdRange: bigint[] = await connect(market, lender).takeInstallmentLoanFor.staticCall(
        borrower.address,
        PROGRAM_ID,
        borrowAmounts,
        addonAmounts,
        durationsInPeriods
      );
      expect(actualLoanIdRange).to.deep.eq(expectedLoanIdRange);

      // Check the returned value of the function for the first loan initiated by the alias
      actualLoanIdRange = await connect(market, alias).takeInstallmentLoanFor.staticCall(
        borrower.address,
        PROGRAM_ID,
        borrowAmounts,
        addonAmounts,
        durationsInPeriods
      );
      expect(actualLoanIdRange).to.deep.eq(expectedLoanIdRange);

      const tx: Promise<TransactionResponse> = connect(market, lender).takeInstallmentLoanFor(
        borrower.address,
        PROGRAM_ID,
        borrowAmounts,
        addonAmounts,
        durationsInPeriods
      );
      const timestamp = await getTxTimestamp(tx);
      const actualLoanStates: LoanState[] = await getLoanStates(market, expectedLoanIds);
      const expectedLoans: Loan[] = createInstallmentLoanParts({
        firstInstallmentId: expectedLoanIds[0],
        borrowAmounts,
        addonAmounts,
        durations: durationsInPeriods,
        lateFeeRate: 0,
        timestamp
      });

      for (let i = 0; i < installmentCount; ++i) {
        checkEquality(actualLoanStates[i], expectedLoans[i].state, i);
        await expect(tx)
          .to.emit(market, EVENT_NAME_LOAN_TAKEN)
          .withArgs(expectedLoanIds[i], borrower.address, principalAmounts[i], durationsInPeriods[i]);

        // Check that the appropriate market hook functions are called
        await expect(tx).to.emit(liquidityPool, EVENT_NAME_ON_BEFORE_LOAN_TAKEN).withArgs(expectedLoanIds[i]);
        await expect(tx).to.emit(creditLine, EVENT_NAME_ON_BEFORE_LOAN_TAKEN).withArgs(expectedLoanIds[i]);
      }
      await expect(tx)
        .to.emit(market, EVENT_NAME_INSTALLMENT_LOAN_TAKEN)
        .withArgs(
          expectedLoanIds[0],
          borrower.address,
          PROGRAM_ID,
          installmentCount,
          totalBorrowAmount,
          totalAddonAmount
        );
      expect(await market.loanCounter()).to.eq(expectedLoanIds[installmentCount - 1] + 1);

      if (isAddonTreasuryConfigured) {
        await expect(tx).to.changeTokenBalances(
          token,
          [liquidityPool, borrower, addonTreasury, market],
          [-totalPrincipal, +totalBorrowAmount, +totalAddonAmount, 0]
        );
        expect(await getNumberOfEvents(tx, token, EVENT_NAME_TRANSFER)).to.eq(2);
      } else {
        await expect(tx).to.changeTokenBalances(
          token,
          [liquidityPool, borrower, addonTreasury, market],
          [-totalBorrowAmount, +totalBorrowAmount, 0, 0]
        );
        expect(await getNumberOfEvents(tx, token, EVENT_NAME_TRANSFER)).to.eq(1);
      }

      // Check the returned value of the function for the second loan
      const nextActualLoanId: bigint = await connect(market, lender).takeLoanFor.staticCall(
        borrower.address,
        PROGRAM_ID,
        BORROW_AMOUNT,
        ADDON_AMOUNT,
        DURATION_IN_PERIODS
      );
      expect(nextActualLoanId).to.eq(expectedLoanIds[installmentCount - 1] + 1);
    }

    describe("Executes as expected and emits the correct events if", async () => {
      describe("The addon treasury is NOT configured on the liquidity pool and", async () => {
        it("The loan has multiple installments", async () => {
          await executeAndCheck({ isAddonTreasuryConfigured: false, installmentCount: INSTALLMENT_COUNT });
        });

        it("The loan has only one installment", async () => {
          await executeAndCheck({ isAddonTreasuryConfigured: false, installmentCount: 1 });
        });
      });
      describe("The addon treasury is configured on the liquidity pool and", async () => {
        it("The loan has multiple installments", async () => {
          await executeAndCheck({ isAddonTreasuryConfigured: true, installmentCount: INSTALLMENT_COUNT });
        });

        it("The loan has only one installment", async () => {
          await executeAndCheck({ isAddonTreasuryConfigured: true, installmentCount: 1 });
        });
      });
    });

    describe("Is reverted if", async () => {
      it("The contract is paused", async () => {
        const { market, marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        await proveTx(market.pause());

        await expect(
          marketUnderLender.takeInstallmentLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROW_AMOUNTS,
            ADDON_AMOUNTS,
            DURATIONS_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
      });

      it("The caller is not the lender or its alias", async () => {
        const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);

        await expect(
          connect(market, borrower).takeInstallmentLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROW_AMOUNTS,
            ADDON_AMOUNTS,
            DURATIONS_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
      });

      it("The borrower address is zero", async () => {
        const { marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        const wrongBorrowerAddress = (ZERO_ADDRESS);

        await expect(
          marketUnderLender.takeInstallmentLoanFor(
            wrongBorrowerAddress,
            PROGRAM_ID,
            BORROW_AMOUNTS,
            ADDON_AMOUNTS,
            DURATIONS_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_ZERO_ADDRESS);
      });

      it("Th program with the passed ID is not registered", async () => {
        const { marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        let wrongProgramId = 0;

        await expect(
          marketUnderLender.takeInstallmentLoanFor(
            borrower.address,
            wrongProgramId,
            BORROW_AMOUNTS,
            ADDON_AMOUNTS,
            DURATIONS_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_UNAUTHORIZED);

        wrongProgramId = PROGRAM_ID + 1;
        await expect(
          marketUnderLender.takeInstallmentLoanFor(
            borrower.address,
            wrongProgramId,
            BORROW_AMOUNTS,
            ADDON_AMOUNTS,
            DURATIONS_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_UNAUTHORIZED);
      });

      it("The input borrow amount array is empty", async () => {
        const { marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        const wrongBorrowAmounts: number[] = [];

        await expect(
          marketUnderLender.takeInstallmentLoanFor(
            borrower.address,
            PROGRAM_ID,
            wrongBorrowAmounts,
            ADDON_AMOUNTS,
            DURATIONS_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_INVALID_AMOUNT);
      });

      it("Is reverted if one of the borrow amount values is zero", async () => {
        const { marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        const wrongBorrowAmounts = [...BORROW_AMOUNTS];
        wrongBorrowAmounts[INSTALLMENT_COUNT - 1] = 0;

        await expect(
          marketUnderLender.takeInstallmentLoanFor(
            borrower.address,
            PROGRAM_ID,
            wrongBorrowAmounts,
            ADDON_AMOUNTS,
            DURATIONS_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_INVALID_AMOUNT);
      });

      it("The total borrow amount is not rounded according to the accuracy factor", async () => {
        const { marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        const wrongBorrowAmounts = [...BORROW_AMOUNTS];
        wrongBorrowAmounts[INSTALLMENT_COUNT - 1] += 1;

        await expect(
          marketUnderLender.takeInstallmentLoanFor(
            borrower.address,
            PROGRAM_ID,
            wrongBorrowAmounts,
            ADDON_AMOUNTS,
            DURATIONS_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_INVALID_AMOUNT);
      });

      it("The total addon amount is not rounded according to the accuracy factor", async () => {
        const { marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        const wrongAddonAmounts = [...ADDON_AMOUNTS];
        wrongAddonAmounts[INSTALLMENT_COUNT - 1] += 1;

        await expect(
          marketUnderLender.takeInstallmentLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROW_AMOUNTS,
            wrongAddonAmounts,
            DURATIONS_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_INVALID_AMOUNT);
      });

      it("The durations in the input array do not correspond to a non-decreasing sequence", async () => {
        const { market, marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        const wrongDurations = [...DURATIONS_IN_PERIODS];
        wrongDurations[INSTALLMENT_COUNT - 1] = wrongDurations[INSTALLMENT_COUNT - 2] - 1;

        await expect(
          marketUnderLender.takeInstallmentLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROW_AMOUNTS,
            ADDON_AMOUNTS,
            wrongDurations
          )
        ).to.be.revertedWithCustomError(market, ERROR_NAME_DURATION_ARRAY_INVALID);
      });

      it("The number of installments is greater than the max allowed value", async () => {
        const { market, marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        await proveTx(marketUnderLender.setInstallmentCountMax(INSTALLMENT_COUNT - 1));

        await expect(
          marketUnderLender.takeInstallmentLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROW_AMOUNTS,
            ADDON_AMOUNTS,
            DURATIONS_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(market, ERROR_NAME_INSTALLMENT_COUNT_EXCESS);
      });

      it("The length of input arrays mismatches", async () => {
        const { market, marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        const wrongAddonAmounts = [...ADDON_AMOUNTS, 0];
        const wrongDurations = [...DURATIONS_IN_PERIODS, DURATIONS_IN_PERIODS[INSTALLMENT_COUNT - 1] + 1];

        await expect(
          marketUnderLender.takeInstallmentLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROW_AMOUNTS,
            wrongAddonAmounts,
            DURATIONS_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(market, ERROR_NAME_ARRAY_LENGTH_MISMATCH);

        await expect(
          marketUnderLender.takeInstallmentLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROW_AMOUNTS,
            ADDON_AMOUNTS,
            wrongDurations
          )
        ).to.be.revertedWithCustomError(market, ERROR_NAME_ARRAY_LENGTH_MISMATCH);
      });

      it("The credit line is not registered", async () => {
        const { marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        await proveTx(
          marketUnderLender.setCreditLineForProgram(PROGRAM_ID, ZERO_ADDRESS) // Call via the testable version
        );

        await expect(
          marketUnderLender.takeInstallmentLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROW_AMOUNTS,
            ADDON_AMOUNTS,
            DURATIONS_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_CREDIT_LINE_LENDER_NOT_CONFIGURED);
      });

      it("The liquidity pool is not registered", async () => {
        const { marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        await proveTx(
          marketUnderLender.setLiquidityPoolForProgram(PROGRAM_ID, ZERO_ADDRESS) // Call via the testable version
        );

        await expect(
          marketUnderLender.takeInstallmentLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROW_AMOUNTS,
            ADDON_AMOUNTS,
            DURATIONS_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_LIQUIDITY_POOL_LENDER_NOT_CONFIGURED);
      });

      it("The loan ID counter is greater than the max allowed value", async () => {
        const { marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        await proveTx(marketUnderLender.setLoanIdCounter(maxUintForBits(40) + 2n - BigInt(INSTALLMENT_COUNT)));

        await expect(
          marketUnderLender.takeInstallmentLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROW_AMOUNTS,
            ADDON_AMOUNTS,
            DURATIONS_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_LOAN_ID_EXCESS);
      });
    });
  });

  describe("Function 'repayLoan()'", async () => {
    async function repayLoanAndCheck(
      fixture: Fixture,
      currentLoan: Loan,
      repaymentAmount: number | bigint,
      payerKind: PayerKind
    ): Promise<Loan> {
      const expectedLoan: Loan = clone(currentLoan);
      const { market, marketAddress, ordinaryLoan: loan } = fixture;
      let tx: Promise<TransactionResponse>;
      let payer: HardhatEthersSigner;
      switch (payerKind) {
        case PayerKind.Borrower:
          tx = connect(market, borrower).repayLoan(loan.id, repaymentAmount);
          payer = borrower;
          break;
        case PayerKind.LiquidityPool:
          tx = liquidityPool.repayLoan(marketAddress, loan.id, repaymentAmount);
          payer = borrower;
          break;
        default:
          tx = connect(market, stranger).repayLoan(loan.id, repaymentAmount);
          payer = stranger;
      }
      const repaidAmountBefore = expectedLoan.state.repaidAmount;
      processRepayment(expectedLoan, { repaymentAmount, repaymentTimestamp: await getTxTimestamp(tx) });
      repaymentAmount = expectedLoan.state.repaidAmount - repaidAmountBefore;

      const actualLoanStateAfterRepayment = await market.getLoanState(loan.id);
      checkEquality(actualLoanStateAfterRepayment, expectedLoan.state);

      await expect(tx).to.changeTokenBalances(
        token,
        [liquidityPool, payer, market],
        [+repaymentAmount, -repaymentAmount, 0]
      );

      await expect(tx).to.emit(market, EVENT_NAME_LOAN_REPAYMENT).withArgs(
        loan.id,
        payer.address,
        borrower.address,
        repaymentAmount,
        expectedLoan.state.trackedBalance // outstanding balance
      );

      // Check that the appropriate market hook functions are called
      await expect(tx).to.emit(liquidityPool, EVENT_NAME_ON_AFTER_LOAN_PAYMENT).withArgs(loan.id, repaymentAmount);
      await expect(tx).to.emit(creditLine, EVENT_NAME_ON_AFTER_LOAN_PAYMENT).withArgs(loan.id, repaymentAmount);

      return expectedLoan;
    }

    describe("Executes as expected if", async () => {
      it("There is a partial repayment from the borrower on the same period the loan is taken", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        await repayLoanAndCheck(fixture, fixture.ordinaryLoan, REPAYMENT_AMOUNT, PayerKind.Borrower);
      });

      it("There is a partial repayment from a stranger before the loan is defaulted", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const periodIndex = fixture.ordinaryLoanStartPeriod + fixture.ordinaryLoan.state.durationInPeriods / 2;
        await increaseBlockTimestampToPeriodIndex(periodIndex);
        await repayLoanAndCheck(fixture, fixture.ordinaryLoan, REPAYMENT_AMOUNT, PayerKind.Stranger);
      });

      it("There is a partial repayment from a liquidity pool after the loan is defaulted", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const periodIndex = fixture.ordinaryLoanStartPeriod + fixture.ordinaryLoan.state.durationInPeriods + 1;
        await increaseBlockTimestampToPeriodIndex(periodIndex);
        await repayLoanAndCheck(fixture, fixture.ordinaryLoan, REPAYMENT_AMOUNT, PayerKind.LiquidityPool);
      });

      it("There is a partial repayment from the borrower at the due date and another one a day after", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const periodIndex = fixture.ordinaryLoanStartPeriod + fixture.ordinaryLoan.state.durationInPeriods;
        await increaseBlockTimestampToPeriodIndex(periodIndex);
        let currentLoan = fixture.ordinaryLoan;
        currentLoan = await repayLoanAndCheck(fixture, currentLoan, REPAYMENT_AMOUNT, PayerKind.Borrower);
        await increaseBlockTimestampToPeriodIndex(periodIndex + 1);
        await repayLoanAndCheck(fixture, currentLoan, REPAYMENT_AMOUNT, PayerKind.Borrower);
      });

      it("There is a full repayment through the amount matches the outstanding balance", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const futureTimestamp = await increaseBlockTimestampToPeriodIndex(fixture.ordinaryLoanStartPeriod + 1);
        const loanPreview: LoanPreview = determineLoanPreview(fixture.ordinaryLoan, futureTimestamp);
        const repaymentAmount = loanPreview.outstandingBalance;
        await repayLoanAndCheck(fixture, fixture.ordinaryLoan, repaymentAmount, PayerKind.Borrower);
      });

      it("There is a full repayment through the amount equals max uint256 value", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        await increaseBlockTimestampToPeriodIndex(fixture.ordinaryLoanStartPeriod + 1);
        await repayLoanAndCheck(fixture, fixture.ordinaryLoan, FULL_REPAYMENT_AMOUNT, PayerKind.Borrower);
      });
    });

    describe("Is reverted if", async () => {
      it("The contract is paused", async () => {
        const { market, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
        await proveTx(market.pause());

        await expect(market.repayLoan(loan.id, REPAYMENT_AMOUNT))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
      });

      it("The loan does not exist", async () => {
        const { market, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
        const wrongLoanId = loan.id + 123;

        await expect(market.repayLoan(wrongLoanId, REPAYMENT_AMOUNT))
          .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_NOT_EXIST);
      });

      it("The loan is already repaid", async () => {
        const { market, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
        await proveTx(connect(market, borrower).repayLoan(loan.id, FULL_REPAYMENT_AMOUNT));

        await expect(market.repayLoan(loan.id, REPAYMENT_AMOUNT))
          .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_ALREADY_REPAID);
      });

      it("The repayment amount is zero", async () => {
        const { market, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
        const wrongRepaymentAmount = 0;

        await expect(market.repayLoan(loan.id, wrongRepaymentAmount))
          .to.be.revertedWithCustomError(market, ERROR_NAME_INVALID_AMOUNT);
      });

      it("The repayment amount is not rounded according to the accuracy factor", async () => {
        const { market, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
        const wrongRepaymentAmount = REPAYMENT_AMOUNT - 1;

        await expect(market.repayLoan(loan.id, wrongRepaymentAmount))
          .to.be.revertedWithCustomError(market, ERROR_NAME_INVALID_AMOUNT);
      });

      it("The repayment amount is bigger than outstanding balance", async () => {
        const { market, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
        const wrongRepaymentAmount = BORROW_AMOUNT + ADDON_AMOUNT + ACCURACY_FACTOR;

        await expect(market.repayLoan(loan.id, wrongRepaymentAmount))
          .to.be.revertedWithCustomError(market, ERROR_NAME_INVALID_AMOUNT);
      });
    });
  });

  describe("Function 'repayLoanForBatch()'", async () => {
    async function executeAndCheck(
      fixture: Fixture,
      currentLoans: Loan[],
      repaymentAmounts: (number | bigint)[],
      payerKind: PayerKind
    ): Promise<Loan[]> {
      const expectedLoans: Loan[] = currentLoans.map(loan => clone(loan));
      const loanIds: number[] = expectedLoans.map(loan => loan.id);
      const { marketUnderLender } = fixture;
      let tx: Promise<TransactionResponse>;
      let payer: HardhatEthersSigner;

      switch (payerKind) {
        case PayerKind.Borrower:
          payer = borrower;
          // Be sure the function can be called by an alias
          connect(marketUnderLender, alias).repayLoanForBatch.staticCall(loanIds, repaymentAmounts, payer.address);
          tx = marketUnderLender.repayLoanForBatch(loanIds, repaymentAmounts, payer.address);
          break;
        case PayerKind.LiquidityPool:
          throw new Error("The liquidity pool is unable to call the function");
        default:
          payer = stranger;
          // Be sure the function can be called by an alias
          connect(marketUnderLender, alias).repayLoanForBatch.staticCall(loanIds, repaymentAmounts, payer.address);
          tx = marketUnderLender.repayLoanForBatch(loanIds, repaymentAmounts, payer.address);
      }

      const repaidAmountsBefore = expectedLoans.map(loan => loan.state.repaidAmount);
      const repaymentTimestamp = await getTxTimestamp(tx);
      const expectedRepaymentAmounts: number[] = [];
      for (let i = 0; i < expectedLoans.length; ++i) {
        const expectedLoan = expectedLoans[i];
        processRepayment(expectedLoan, { repaymentAmount: repaymentAmounts[i], repaymentTimestamp });
        const expectedRepaymentAmount = expectedLoan.state.repaidAmount - repaidAmountsBefore[i];
        const actualLoanStateAfterRepayment = await marketUnderLender.getLoanState(expectedLoan.id);
        checkEquality(actualLoanStateAfterRepayment, expectedLoan.state);

        await expect(tx).to.emit(marketUnderLender, EVENT_NAME_LOAN_REPAYMENT).withArgs(
          expectedLoan.id,
          payer.address,
          borrower.address,
          expectedRepaymentAmount,
          expectedLoan.state.trackedBalance // outstanding balance
        );

        // Check that the appropriate market hook functions are called
        await expect(tx)
          .to.emit(liquidityPool, EVENT_NAME_ON_AFTER_LOAN_PAYMENT)
          .withArgs(expectedLoan.id, expectedRepaymentAmount);
        await expect(tx)
          .to.emit(creditLine, EVENT_NAME_ON_AFTER_LOAN_PAYMENT)
          .withArgs(expectedLoan.id, expectedRepaymentAmount);

        expectedRepaymentAmounts.push(expectedRepaymentAmount);
      }

      const totalRepaymentAmount = expectedRepaymentAmounts.length > 0
        ? expectedRepaymentAmounts.reduce((sum, amount) => sum + amount)
        : 0;
      await expect(tx).to.changeTokenBalances(
        token,
        [liquidityPool, payer, marketUnderLender],
        [totalRepaymentAmount, -totalRepaymentAmount, 0]
      );

      return expectedLoans;
    }

    describe("Executes as expected if", async () => {
      it("There are partial repayments from the borrower on the same period the loan is taken", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const currentLoans: Loan[] = [
          fixture.ordinaryLoan,
          fixture.installmentLoanParts[fixture.installmentLoanParts.length - 1]
        ];
        const repaymentAmounts = [REPAYMENT_AMOUNT, REPAYMENT_AMOUNT / 2];
        await executeAndCheck(fixture, currentLoans, repaymentAmounts, PayerKind.Borrower);
      });

      it("There are partial repayments from a stranger before the loan is defaulted", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const currentLoans: Loan[] = [
          fixture.ordinaryLoan,
          fixture.installmentLoanParts[fixture.installmentLoanParts.length - 1]
        ];
        const repaymentAmounts = [REPAYMENT_AMOUNT, REPAYMENT_AMOUNT / 2];
        const periodIndex = fixture.ordinaryLoanStartPeriod + fixture.ordinaryLoan.state.durationInPeriods / 2;
        await increaseBlockTimestampToPeriodIndex(periodIndex);
        await executeAndCheck(fixture, currentLoans, repaymentAmounts, PayerKind.Stranger);
      });

      it("There are partial repayment from the borrower at the due date and another one a day after", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const periodIndex = fixture.ordinaryLoanStartPeriod + fixture.ordinaryLoan.state.durationInPeriods;
        await increaseBlockTimestampToPeriodIndex(periodIndex);
        let currentLoans: Loan[] = [
          fixture.ordinaryLoan,
          fixture.installmentLoanParts[fixture.installmentLoanParts.length - 1]
        ];
        const repaymentAmounts = [REPAYMENT_AMOUNT, REPAYMENT_AMOUNT / 2];
        currentLoans = await executeAndCheck(fixture, currentLoans, repaymentAmounts, PayerKind.Borrower);
        await increaseBlockTimestampToPeriodIndex(periodIndex + 1);
        await executeAndCheck(fixture, currentLoans, repaymentAmounts, PayerKind.Borrower);
      });

      it("There is a full repayment through the amount matches the outstanding balance", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const futureTimestamp = await increaseBlockTimestampToPeriodIndex(fixture.ordinaryLoanStartPeriod + 1);
        const loanPreview: LoanPreview = determineLoanPreview(fixture.ordinaryLoan, futureTimestamp);
        const currentLoans: Loan[] = [
          fixture.ordinaryLoan,
          fixture.installmentLoanParts[fixture.installmentLoanParts.length - 1]
        ];
        const repaymentAmounts = [loanPreview.outstandingBalance, REPAYMENT_AMOUNT];
        await executeAndCheck(fixture, currentLoans, repaymentAmounts, PayerKind.Borrower);
      });

      it("There is a full repayment through the amount equals max uint256 value", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const currentLoans: Loan[] = [
          fixture.ordinaryLoan,
          fixture.installmentLoanParts[fixture.installmentLoanParts.length - 1]
        ];
        const repaymentAmounts = [REPAYMENT_AMOUNT, FULL_REPAYMENT_AMOUNT];
        await increaseBlockTimestampToPeriodIndex(fixture.installmentLoanStartPeriodIndex + 3);
        await executeAndCheck(fixture, currentLoans, repaymentAmounts, PayerKind.Borrower);
      });

      it("There are empty input arrays", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const currentLoans: Loan[] = [];
        const repaymentAmounts: number[] = [];
        await increaseBlockTimestampToPeriodIndex(fixture.installmentLoanStartPeriodIndex + 3);
        await executeAndCheck(fixture, currentLoans, repaymentAmounts, PayerKind.Borrower);
      });
    });

    describe("Is reverted if", async () => {
      it("The contract is paused", async () => {
        const { market, marketUnderLender } = await setUpFixture(deployLendingMarketAndTakeLoans);
        await proveTx(market.pause());

        await expect(marketUnderLender.repayLoanForBatch([], [], borrower.address))
          .to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_ENFORCED_PAUSED);
      });

      it("The length of the input arrays does not match", async () => {
        const { marketUnderLender, installmentLoanParts: loans } = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loanIds = loans.map(loan => loan.id);
        const repaymentAmounts: number[] = Array(loans.length).fill(REPAYMENT_AMOUNT);

        await expect(marketUnderLender.repayLoanForBatch(
          [...loanIds, loanIds[0]],
          repaymentAmounts,
          borrower.address
        )).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_ARRAY_LENGTH_MISMATCH);

        await expect(marketUnderLender.repayLoanForBatch(
          loanIds,
          [...repaymentAmounts, REPAYMENT_AMOUNT],
          borrower.address
        )).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_ARRAY_LENGTH_MISMATCH);

        await expect(marketUnderLender.repayLoanForBatch(
          loanIds,
          [],
          borrower.address
        )).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_ARRAY_LENGTH_MISMATCH);

        await expect(marketUnderLender.repayLoanForBatch(
          [],
          repaymentAmounts,
          borrower.address
        )).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_ARRAY_LENGTH_MISMATCH);
      });

      it("The provided repayer address is zero", async () => {
        const { marketUnderLender, installmentLoanParts: loans } = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loanIds = loans.map(loan => loan.id);
        const repaymentAmounts: number[] = Array(loans.length).fill(REPAYMENT_AMOUNT);
        const repayerAddress = (ZERO_ADDRESS);

        await expect(
          marketUnderLender.repayLoanForBatch(loanIds, repaymentAmounts, repayerAddress)
        ).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_ZERO_ADDRESS);
      });

      it("One of the loans does not exist", async () => {
        const { marketUnderLender, installmentLoanParts: loans } = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loanIds = loans.map(loan => loan.id);
        const repaymentAmounts: number[] = Array(loans.length).fill(REPAYMENT_AMOUNT);
        loanIds[loanIds.length - 1] += 123;

        await expect(
          marketUnderLender.repayLoanForBatch(loanIds, repaymentAmounts, borrower.address)
        ).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_LOAN_NOT_EXIST);
      });

      it("One of the loans is already repaid", async () => {
        const { marketUnderLender, installmentLoanParts: loans } = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loanIds = loans.map(loan => loan.id);
        const repaymentAmounts: number[] = Array(loans.length).fill(REPAYMENT_AMOUNT);
        await proveTx(marketUnderLender.repayLoanForBatch(
          [loanIds[loanIds.length - 1]],
          [FULL_REPAYMENT_AMOUNT],
          borrower.address
        ));

        await expect(marketUnderLender.repayLoanForBatch(loanIds, repaymentAmounts, borrower.address))
          .to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_LOAN_ALREADY_REPAID);
      });

      it("The caller is not the lender or an alias", async () => {
        const { market, installmentLoanParts: loans } = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loanIds = loans.map(loan => loan.id);
        const repaymentAmounts: number[] = Array(loans.length).fill(REPAYMENT_AMOUNT);

        await expect(
          connect(market, owner).repayLoanForBatch(loanIds, repaymentAmounts, borrower.address)
        ).to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);

        await expect(
          connect(market, borrower).repayLoanForBatch(loanIds, repaymentAmounts, borrower.address)
        ).to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);

        await expect(
          connect(market, stranger).repayLoanForBatch(loanIds, repaymentAmounts, borrower.address)
        ).to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
      });

      it("One of the repayment amounts is zero", async () => {
        const { marketUnderLender, installmentLoanParts: loans } = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loanIds = loans.map(loan => loan.id);
        const repaymentAmounts: number[] = Array(loans.length).fill(REPAYMENT_AMOUNT);
        repaymentAmounts[loans.length - 1] = 0;

        await expect(marketUnderLender.repayLoanForBatch(loanIds, repaymentAmounts, borrower.address))
          .to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_INVALID_AMOUNT);
      });

      it("One of the repayment amounts is not rounded according to the accuracy factor", async () => {
        const { marketUnderLender, installmentLoanParts: loans } = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loanIds = loans.map(loan => loan.id);
        const repaymentAmounts: number[] = Array(loans.length).fill(REPAYMENT_AMOUNT);
        repaymentAmounts[loans.length - 1] = REPAYMENT_AMOUNT - 1;

        await expect(marketUnderLender.repayLoanForBatch(loanIds, repaymentAmounts, borrower.address))
          .to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_INVALID_AMOUNT);
      });

      it("One of the repayment amounts is bigger than outstanding balance", async () => {
        const { marketUnderLender, installmentLoanParts: loans } = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loanIds = loans.map(loan => loan.id);
        const repaymentAmounts: number[] = Array(loans.length).fill(REPAYMENT_AMOUNT);
        const lastLoan = loans[loans.length - 1];
        repaymentAmounts[loans.length - 1] = Number(roundMath(
          lastLoan.state.borrowAmount + lastLoan.state.addonAmount,
          ACCURACY_FACTOR
        )) + ACCURACY_FACTOR;

        await expect(marketUnderLender.repayLoanForBatch(loanIds, repaymentAmounts, borrower.address))
          .to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_INVALID_AMOUNT);
      });
    });
  });

  describe("Function 'freeze()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
      const { market, ordinaryLoan: loan } = fixture;
      const expectedLoan = clone(fixture.ordinaryLoan);

      // Can be called by an alias
      await connect(market, alias).freeze.staticCall(loan.id);

      const tx = connect(market, lender).freeze(loan.id);
      expectedLoan.state.freezeTimestamp = calculateTimestampWithOffset(await getTxTimestamp(tx));

      const actualLoanStateAfterFreezing: LoanState = await market.getLoanState(loan.id);
      await expect(tx).to.emit(market, EVENT_NAME_LOAN_FROZEN).withArgs(loan.id);
      checkEquality(actualLoanStateAfterFreezing, expectedLoan.state);
    });

    it("Is reverted if the contract is paused", async () => {
      const { market, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
      await proveTx(market.pause());

      await expect(market.freeze(loan.id)).to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the loan does not exist", async () => {
      const { market, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
      const wrongLoanId = loan.id + 123;

      await expect(market.freeze(wrongLoanId))
        .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_NOT_EXIST);
    });

    it("Is reverted if the loan is already repaid", async () => {
      const { market, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
      await proveTx(connect(market, borrower).repayLoan(loan.id, FULL_REPAYMENT_AMOUNT));

      await expect(market.freeze(loan.id))
        .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_ALREADY_REPAID);
    });

    it("Is reverted if the caller is not the lender or an alias", async () => {
      const { market, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);

      await expect(connect(market, attacker).freeze(loan.id))
        .to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
    });

    it("Is reverted if the loan is already frozen", async () => {
      const { marketUnderLender, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
      await proveTx(marketUnderLender.freeze(loan.id));

      await expect(marketUnderLender.freeze(loan.id))
        .to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_LOAN_ALREADY_FROZEN);
    });
  });

  describe("Function 'unfreeze()'", async () => {
    async function freezeUnfreezeAndCheck(fixture: Fixture, props: {
      freezingTimestamp: number;
      unfreezingTimestamp: number;
      repaymentAmountWhileFreezing: number;
    }) {
      const { marketUnderLender } = fixture;
      const expectedLoan = clone(fixture.ordinaryLoan);
      const { freezingTimestamp, unfreezingTimestamp, repaymentAmountWhileFreezing } = props;
      const frozenInterval = unfreezingTimestamp - freezingTimestamp;

      if (await getLatestBlockTimestamp() < freezingTimestamp) {
        await increaseBlockTimestampTo(freezingTimestamp);
      }
      let tx = marketUnderLender.freeze(expectedLoan.id);
      expectedLoan.state.freezeTimestamp = calculateTimestampWithOffset(await getTxTimestamp(tx));

      if (props.repaymentAmountWhileFreezing != 0) {
        await increaseBlockTimestampTo(freezingTimestamp + frozenInterval / 2);
        tx = connect(marketUnderLender, borrower).repayLoan(expectedLoan.id, repaymentAmountWhileFreezing);
        processRepayment(expectedLoan, {
          repaymentAmount: repaymentAmountWhileFreezing,
          repaymentTimestamp: await getTxTimestamp(tx)
        });
      }

      if (freezingTimestamp != unfreezingTimestamp) {
        await increaseBlockTimestampTo(props.unfreezingTimestamp);
      }

      // Can be executed by an alias
      await connect(marketUnderLender, alias).unfreeze.staticCall(expectedLoan.id);

      tx = marketUnderLender.unfreeze(expectedLoan.id);
      processRepayment(expectedLoan, { repaymentAmount: 0, repaymentTimestamp: await getTxTimestamp(tx) });
      expectedLoan.state.durationInPeriods +=
        calculatePeriodIndex(calculateTimestampWithOffset(unfreezingTimestamp)) -
        calculatePeriodIndex(calculateTimestampWithOffset(freezingTimestamp));
      expectedLoan.state.freezeTimestamp = 0;

      await expect(tx).to.emit(marketUnderLender, EVENT_NAME_LOAN_UNFROZEN).withArgs(expectedLoan.id);
      const actualLoanState: LoanState = await marketUnderLender.getLoanState(expectedLoan.id);
      checkEquality(actualLoanState, expectedLoan.state);
    }

    describe("Executes as expected if", async () => {
      it("Unfreezing is done at the same loan period as the freezing", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const startTimestamp = removeTimestampOffset(fixture.ordinaryLoan.state.startTimestamp);
        await freezeUnfreezeAndCheck(fixture, {
          freezingTimestamp: startTimestamp,
          unfreezingTimestamp: startTimestamp + PERIOD_IN_SECONDS / 2,
          repaymentAmountWhileFreezing: 0
        });
      });

      it("Unfreezing is done some periods after the freezing", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loan = fixture.ordinaryLoan;
        const startTimestamp = removeTimestampOffset(loan.state.startTimestamp);
        const freezingTimestamp = startTimestamp + (loan.state.durationInPeriods / 4) * PERIOD_IN_SECONDS;
        const unfreezingTimestamp = startTimestamp + (loan.state.durationInPeriods / 2) * PERIOD_IN_SECONDS;
        await freezeUnfreezeAndCheck(fixture, {
          freezingTimestamp,
          unfreezingTimestamp,
          repaymentAmountWhileFreezing: 0
        });
      });

      it("Unfreezing is done some periods after the freezing and after a repayment", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loan = fixture.ordinaryLoan;
        const startTimestamp = removeTimestampOffset(loan.state.startTimestamp);
        const freezingTimestamp = startTimestamp + (loan.state.durationInPeriods - 1) * PERIOD_IN_SECONDS;
        const unfreezingTimestamp = freezingTimestamp + 4 * PERIOD_IN_SECONDS;
        await freezeUnfreezeAndCheck(fixture, {
          freezingTimestamp,
          unfreezingTimestamp,
          repaymentAmountWhileFreezing: REPAYMENT_AMOUNT
        });
      });

      it("Unfreezing is done some periods after the freezing at a due date", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loan = fixture.ordinaryLoan;
        const startTimestamp = removeTimestampOffset(loan.state.startTimestamp);
        const freezingTimestamp = startTimestamp + loan.state.durationInPeriods * PERIOD_IN_SECONDS;
        const unfreezingTimestamp = freezingTimestamp + 4 * PERIOD_IN_SECONDS;
        await freezeUnfreezeAndCheck(fixture, {
          freezingTimestamp,
          unfreezingTimestamp,
          repaymentAmountWhileFreezing: REPAYMENT_AMOUNT
        });
      });

      it("Unfreezing and freezing both are after the due date", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loan = fixture.ordinaryLoan;
        const startTimestamp = removeTimestampOffset(loan.state.startTimestamp);
        const freezingTimestamp = startTimestamp + (loan.state.durationInPeriods + 2) * PERIOD_IN_SECONDS;
        const unfreezingTimestamp = freezingTimestamp + 4 * PERIOD_IN_SECONDS;
        await freezeUnfreezeAndCheck(fixture, {
          freezingTimestamp,
          unfreezingTimestamp,
          repaymentAmountWhileFreezing: 0
        });
      });
    });

    describe("Is reverted if", async () => {
      it("The contract is paused", async () => {
        const { market, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
        await proveTx(market.pause());

        await expect(market.unfreeze(loan.id)).to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
      });

      it("The loan does not exist", async () => {
        const { market, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
        const wrongLoanId = loan.id + 123;

        await expect(market.unfreeze(wrongLoanId))
          .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_NOT_EXIST);
      });

      it("The loan is already repaid", async () => {
        const { market, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
        await proveTx(connect(market, borrower).repayLoan(loan.id, FULL_REPAYMENT_AMOUNT));

        await expect(connect(market, lender).unfreeze(loan.id))
          .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_ALREADY_REPAID);
      });

      it("The caller is not the lender or an alias", async () => {
        const { market, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);

        await expect(connect(market, attacker).unfreeze(loan.id))
          .to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
      });

      it("The loan is not frozen", async () => {
        const { marketUnderLender, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);

        await expect(marketUnderLender.unfreeze(loan.id))
          .to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_LOAN_NOT_FROZEN);
      });
    });
  });

  describe("Function 'updateLoanDuration()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
      const { marketUnderLender } = fixture;
      const expectedLoan: Loan = clone(fixture.ordinaryLoan);
      const newDuration = expectedLoan.state.durationInPeriods + 1;
      expectedLoan.state.durationInPeriods = newDuration;

      // Can be called by an alias
      await connect(marketUnderLender, alias).updateLoanDuration.staticCall(expectedLoan.id, newDuration);

      await expect(marketUnderLender.updateLoanDuration(expectedLoan.id, newDuration))
        .to.emit(marketUnderLender, EVENT_NAME_LOAN_DURATION_UPDATED)
        .withArgs(expectedLoan.id, newDuration, DURATION_IN_PERIODS);
      const actualLoanState = await marketUnderLender.getLoanState(expectedLoan.id);
      checkEquality(actualLoanState, expectedLoan.state);
    });

    it("Is reverted if the contract is paused", async () => {
      const { market, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
      await proveTx(market.pause());

      await expect(market.updateLoanDuration(loan.id, DURATION_IN_PERIODS))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the loan does not exist", async () => {
      const { market, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
      const wrongLoanId = loan.id + 123;

      await expect(market.updateLoanDuration(wrongLoanId, DURATION_IN_PERIODS))
        .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_NOT_EXIST);
    });

    it("Is reverted if the loan is already repaid", async () => {
      const { market, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
      await proveTx(connect(market, borrower).repayLoan(loan.id, FULL_REPAYMENT_AMOUNT));

      await expect(market.updateLoanDuration(loan.id, DURATION_IN_PERIODS))
        .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_ALREADY_REPAID);
    });

    it("Is reverted if the caller is not the lender or an alias", async () => {
      const { market, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);

      await expect(connect(market, attacker).updateLoanDuration(loan.id, DURATION_IN_PERIODS))
        .to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
    });

    it("Is reverted if the new duration is the same as the previous one or less", async () => {
      const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
      const { marketUnderLender, ordinaryLoan: loan } = fixture;
      let newDuration = fixture.ordinaryLoan.state.durationInPeriods;

      await expect(
        marketUnderLender.updateLoanDuration(loan.id, newDuration)
      ).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_INAPPROPRIATE_DURATION_IN_PERIODS);

      newDuration -= 1;
      await expect(
        marketUnderLender.updateLoanDuration(loan.id, newDuration)
      ).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_INAPPROPRIATE_DURATION_IN_PERIODS);
    });

    it("Is reverted if the new duration is greater than 32-bit unsigned integer", async () => {
      const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
      const { marketUnderLender, ordinaryLoan: loan } = fixture;
      const newDuration = maxUintForBits(32) + 1n;

      await expect(marketUnderLender.updateLoanDuration(loan.id, newDuration))
        .to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST)
        .withArgs(32, newDuration);
    });
  });

  describe("Function 'updateLoanInterestRatePrimary()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
      const { marketUnderLender } = fixture;
      const expectedLoan = clone(fixture.ordinaryLoan);
      const oldInterestRate = expectedLoan.state.interestRatePrimary;
      const newInterestRate = oldInterestRate - 1;
      expectedLoan.state.interestRatePrimary = newInterestRate;

      // Can be executed by an alias
      await connect(marketUnderLender, alias).updateLoanInterestRatePrimary.staticCall(
        expectedLoan.id,
        newInterestRate
      );

      await expect(marketUnderLender.updateLoanInterestRatePrimary(expectedLoan.id, newInterestRate))
        .to.emit(marketUnderLender, EVENT_NAME_LOAN_INTEREST_RATE_PRIMARY_UPDATED)
        .withArgs(expectedLoan.id, newInterestRate, oldInterestRate);
      const actualLoanState = await marketUnderLender.getLoanState(expectedLoan.id);
      checkEquality(actualLoanState, expectedLoan.state);
    });

    it("Is reverted if the contract is paused", async () => {
      const { market, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
      await proveTx(market.pause());

      await expect(
        market.updateLoanInterestRatePrimary(loan.id, INTEREST_RATE_PRIMARY)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the loan does not exist", async () => {
      const { market, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
      const wrongLoanId = loan.id + 123;

      await expect(
        market.updateLoanInterestRatePrimary(wrongLoanId, INTEREST_RATE_PRIMARY)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_NOT_EXIST);
    });

    it("Is reverted if the loan is already repaid", async () => {
      const { marketUnderLender, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
      await proveTx(connect(marketUnderLender, borrower).repayLoan(loan.id, FULL_REPAYMENT_AMOUNT));

      await expect(
        marketUnderLender.updateLoanInterestRatePrimary(loan.id, INTEREST_RATE_PRIMARY)
      ).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_LOAN_ALREADY_REPAID);
    });

    it("Is reverted if the caller is not the lender or an alias", async () => {
      const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
      const { market, ordinaryLoan: loan } = fixture;

      await expect(
        connect(market, attacker).updateLoanInterestRatePrimary(loan.id, INTEREST_RATE_PRIMARY)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
    });

    it("Is is reverted if the new interest rate is the same as the previous one or greater", async () => {
      const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
      const { marketUnderLender, ordinaryLoan: loan } = fixture;
      let newInterestRate = loan.state.interestRatePrimary;

      await expect(
        marketUnderLender.updateLoanInterestRatePrimary(loan.id, newInterestRate)
      ).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_INAPPROPRIATE_INTEREST_RATE);

      newInterestRate += 1;
      await expect(
        marketUnderLender.updateLoanInterestRatePrimary(loan.id, newInterestRate + 1)
      ).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_INAPPROPRIATE_INTEREST_RATE);
    });
  });

  describe("Function 'updateLoanInterestRateSecondary()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
      const { marketUnderLender } = fixture;
      const expectedLoan = clone(fixture.ordinaryLoan);
      const oldInterestRate = expectedLoan.state.interestRateSecondary;
      const newInterestRate = oldInterestRate - 1;
      expectedLoan.state.interestRateSecondary = newInterestRate;

      // Can be executed by an alias
      await connect(marketUnderLender, alias).updateLoanInterestRateSecondary.staticCall(
        expectedLoan.id,
        newInterestRate
      );

      await expect(marketUnderLender.updateLoanInterestRateSecondary(expectedLoan.id, newInterestRate))
        .to.emit(marketUnderLender, EVENT_NAME_LOAN_INTEREST_RATE_SECONDARY_UPDATED)
        .withArgs(expectedLoan.id, newInterestRate, oldInterestRate);
      const actualLoanState = await marketUnderLender.getLoanState(expectedLoan.id);
      checkEquality(actualLoanState, expectedLoan.state);
    });

    it("Is reverted if the contract is paused", async () => {
      const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
      const { market, ordinaryLoan: loan } = fixture;
      await proveTx(market.pause());

      await expect(
        market.updateLoanInterestRateSecondary(loan.id, INTEREST_RATE_SECONDARY)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the loan does not exist", async () => {
      const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
      const { market, ordinaryLoan: loan } = fixture;
      const wrongLoanId = loan.id + 123;

      await expect(market.updateLoanInterestRateSecondary(wrongLoanId, INTEREST_RATE_SECONDARY))
        .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_NOT_EXIST);
    });

    it("Is reverted if the loan is already repaid", async () => {
      const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
      const { marketUnderLender, ordinaryLoan: loan } = fixture;
      await proveTx(connect(marketUnderLender, borrower).repayLoan(loan.id, FULL_REPAYMENT_AMOUNT));

      await expect(marketUnderLender.updateLoanInterestRateSecondary(loan.id, INTEREST_RATE_SECONDARY))
        .to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_LOAN_ALREADY_REPAID);
    });

    it("Is reverted if the caller is not the lender or an alias", async () => {
      const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
      const { market, ordinaryLoan: loan } = fixture;

      await expect(connect(market, attacker).updateLoanInterestRateSecondary(loan.id, INTEREST_RATE_SECONDARY))
        .to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
    });

    it("Is is reverted if the new interest rate is the same as the previous one or greater", async () => {
      const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
      const { marketUnderLender, ordinaryLoan: loan } = fixture;
      let newInterestRate = loan.state.interestRateSecondary;

      await expect(marketUnderLender.updateLoanInterestRateSecondary(loan.id, newInterestRate))
        .to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_INAPPROPRIATE_INTEREST_RATE);

      newInterestRate += 1;
      await expect(marketUnderLender.updateLoanInterestRateSecondary(loan.id, newInterestRate))
        .to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_INAPPROPRIATE_INTEREST_RATE);
    });
  });

  describe("Function 'revokeLoan()'", async () => {
    async function revokeAndCheck(fixture: Fixture, props: {
      isAddonTreasuryConfigured: boolean;
      currentLoan: Loan;
      revoker: HardhatEthersSigner;
    }) {
      const { market } = fixture;
      const expectedLoan = clone(props.currentLoan);
      const borrowerBalanceChange = expectedLoan.state.repaidAmount - expectedLoan.state.borrowAmount;

      if (props.isAddonTreasuryConfigured) {
        await proveTx(liquidityPool.mockAddonTreasury(addonTreasury.address));
      }

      if (props.revoker === lender) {
        // Check it can be called by an alias too
        await connect(market, alias).revokeLoan.staticCall(expectedLoan.id);
      }

      const tx: Promise<TransactionResponse> = connect(market, props.revoker).revokeLoan(expectedLoan.id);

      expectedLoan.state.trackedBalance = 0;
      expectedLoan.state.trackedTimestamp = calculateTimestampWithOffset(await getTxTimestamp(tx));

      await expect(tx).to.emit(market, EVENT_NAME_LOAN_REVOKED).withArgs(expectedLoan.id);
      if (props.isAddonTreasuryConfigured) {
        const addonAmount = expectedLoan.state.addonAmount;
        await expect(tx).to.changeTokenBalances(
          token,
          [borrower, liquidityPool, addonTreasury, market],
          [borrowerBalanceChange, -borrowerBalanceChange + addonAmount, -addonAmount, 0]
        );
      } else {
        await expect(tx).to.changeTokenBalances(
          token,
          [borrower, liquidityPool, addonTreasury, market],
          [borrowerBalanceChange, -borrowerBalanceChange, 0, 0]
        );
      }
      const actualLoanState = await market.getLoanState(expectedLoan.id);
      checkEquality(actualLoanState, expectedLoan.state);

      // Check hook calls
      await expect(tx).to.emit(creditLine, EVENT_NAME_ON_AFTER_LOAN_REVOCATION).withArgs(expectedLoan.id);
      await expect(tx).and.to.emit(liquidityPool, EVENT_NAME_ON_AFTER_LOAN_REVOCATION).withArgs(expectedLoan.id);
    }

    describe("Executes as expected and emits correct event if", async () => {
      describe("The addon treasury is NOT configured on the liquidity pool and", async () => {
        it("Is called by the borrower before the cooldown expiration and with no repayments", async () => {
          const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
          const timestamp = removeTimestampOffset(
            fixture.ordinaryLoan.state.startTimestamp + (COOLDOWN_IN_PERIODS - 1) * PERIOD_IN_SECONDS
          );
          await increaseBlockTimestampTo(timestamp);
          await revokeAndCheck(fixture, {
            isAddonTreasuryConfigured: true,
            currentLoan: fixture.ordinaryLoan,
            revoker: borrower
          });
        });
      });

      describe("The addon treasury is configured on the liquidity pool and", async () => {
        it("Is called by the borrower before the cooldown expiration and with no repayments", async () => {
          const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
          const timestamp = removeTimestampOffset(
            fixture.ordinaryLoan.state.startTimestamp + (COOLDOWN_IN_PERIODS - 1) * PERIOD_IN_SECONDS
          );
          await increaseBlockTimestampTo(timestamp);
          await revokeAndCheck(fixture, {
            isAddonTreasuryConfigured: true,
            currentLoan: fixture.ordinaryLoan,
            revoker: borrower
          });
        });

        it("Is called by the lender with a repayment that is less than the borrow amount", async () => {
          const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);

          const loan = clone(fixture.ordinaryLoan);
          const repaymentAmount = Number(roundMath(loan.state.borrowAmount / 2, ACCURACY_FACTOR));
          const tx = await proveTx(
            connect(fixture.market, borrower).repayLoan(loan.id, repaymentAmount)
          );
          processRepayment(loan, { repaymentAmount, repaymentTimestamp: await getBlockTimestamp(tx.blockNumber) });

          const timestamp = removeTimestampOffset(
            loan.state.startTimestamp + (COOLDOWN_IN_PERIODS) * PERIOD_IN_SECONDS + 1
          );
          await increaseBlockTimestampTo(timestamp);

          await revokeAndCheck(fixture, {
            isAddonTreasuryConfigured: true,
            currentLoan: loan,
            revoker: lender
          });
        });

        it("Is called by the lender with a repayment that equals the borrow amount", async () => {
          const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);

          const loan = clone(fixture.ordinaryLoan);
          const repaymentAmount = loan.state.borrowAmount;
          const tx = await proveTx(connect(fixture.market, borrower).repayLoan(loan.id, repaymentAmount));
          processRepayment(loan, { repaymentAmount, repaymentTimestamp: await getBlockTimestamp(tx.blockNumber) });

          const timestamp =
            removeTimestampOffset(loan.state.startTimestamp + PERIOD_IN_SECONDS / 2);
          await increaseBlockTimestampTo(timestamp);

          await revokeAndCheck(fixture, {
            isAddonTreasuryConfigured: true,
            currentLoan: loan,
            revoker: lender
          });
        });

        it("Is called by the lender with a repayment that is greater than the borrow amount", async () => {
          const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);

          const loan = clone(fixture.ordinaryLoan);
          const repaymentAmount = loan.state.borrowAmount + ACCURACY_FACTOR;
          const tx = await proveTx(connect(fixture.market, borrower).repayLoan(loan.id, repaymentAmount));
          processRepayment(loan, { repaymentAmount, repaymentTimestamp: await getBlockTimestamp(tx.blockNumber) });

          const timestamp = removeTimestampOffset(loan.state.startTimestamp + COOLDOWN_IN_PERIODS * PERIOD_IN_SECONDS);
          await increaseBlockTimestampTo(timestamp);

          await revokeAndCheck(fixture, {
            isAddonTreasuryConfigured: true,
            currentLoan: loan,
            revoker: lender
          });
        });
      });
    });

    describe("Is reverted if", async () => {
      it("The contract is paused", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const { market, marketUnderLender, ordinaryLoan: loan } = fixture;
        await proveTx(market.pause());

        await expect(marketUnderLender.revokeLoan(loan.id))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
      });

      it("The loan does not exist", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const { market, ordinaryLoan: loan } = fixture;

        await expect(market.revokeLoan(loan.id + 123))
          .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_NOT_EXIST);
      });

      it("The loan is already repaid", async () => {
        const { market, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
        await proveTx(connect(market, borrower).repayLoan(loan.id, FULL_REPAYMENT_AMOUNT));

        await expect(market.revokeLoan(loan.id))
          .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_ALREADY_REPAID);
      });

      it("The loan is a sub-loan of an installment loan", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const { market, installmentLoanParts: [loan] } = fixture;

        await expect(market.revokeLoan(loan.id))
          .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_TYPE_UNEXPECTED)
          .withArgs(
            LoanType.Installment, // actual
            LoanType.Ordinary // expected
          );
      });

      it("The cooldown period has passed when it is called by the borrower", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const { market, ordinaryLoan: loan } = fixture;
        const timestampAfterCooldown =
          removeTimestampOffset(loan.state.startTimestamp) + COOLDOWN_IN_PERIODS * PERIOD_IN_SECONDS;
        await increaseBlockTimestampTo(timestampAfterCooldown);

        await expect(connect(market, borrower).revokeLoan(loan.id))
          .to.be.revertedWithCustomError(market, ERROR_NAME_COOLDOWN_PERIOD_PASSED);
      });

      it("The caller is not the lender, the borrower, or an alias", async () => {
        const { market, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);

        await expect(connect(market, attacker).revokeLoan(loan.id))
          .to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
      });
    });
  });

  describe("Function 'revokeInstallmentLoan()'", async () => {
    async function revokeAndCheck(fixture: Fixture, props: {
      isAddonTreasuryConfigured: boolean;
      currentLoans: Loan[];
      revoker: HardhatEthersSigner;
    }) {
      const { market, installmentLoanParts: loans } = fixture;
      const loanIds = loans.map(loan => loan.id);
      const expectedLoans = props.currentLoans.map(loan => clone(loan));
      const borrowerBalanceChange = expectedLoans
        .map(loan => loan.state.repaidAmount - loan.state.borrowAmount)
        .reduce((sum, amount) => sum + amount);

      if (props.isAddonTreasuryConfigured) {
        await proveTx(liquidityPool.mockAddonTreasury(addonTreasury.address));
      }

      if (props.revoker === lender) {
        // Check it can be called by an alias too
        await connect(market, alias).revokeInstallmentLoan.staticCall(loanIds[loanIds.length - 1]);
      }
      const middleLoanId = loanIds.length > 1 ? 1 : 0;

      const tx: Promise<TransactionResponse> = connect(market, props.revoker).revokeInstallmentLoan(middleLoanId);

      const revocationTimestamp = calculateTimestampWithOffset(await getTxTimestamp(tx));
      const actualLoanStates = await getLoanStates(market, loanIds);
      expectedLoans.forEach(loan => {
        loan.state.trackedBalance = 0;
        loan.state.trackedTimestamp = revocationTimestamp;
      });

      for (let i = 0; i < loanIds.length; ++i) {
        const loanId = loanIds[i];
        await expect(tx).to.emit(market, EVENT_NAME_LOAN_REVOKED).withArgs(loanId);
        checkEquality(actualLoanStates[i], expectedLoans[i].state, i);
        // Check hook calls
        await expect(tx).to.emit(creditLine, EVENT_NAME_ON_AFTER_LOAN_REVOCATION).withArgs(loanId);
        await expect(tx).and.to.emit(liquidityPool, EVENT_NAME_ON_AFTER_LOAN_REVOCATION).withArgs(loanId);
      }
      await expect(tx).to.emit(market, EVENT_NAME_INSTALLMENT_LOAN_REVOKED).withArgs(loanIds[0], loanIds.length);

      if (props.isAddonTreasuryConfigured) {
        const totalAddonAmount = expectedLoans
          .map(loan => loan.state.addonAmount)
          .reduce((sum, amount) => sum + amount);
        await expect(tx).to.changeTokenBalances(
          token,
          [borrower, liquidityPool, addonTreasury, market],
          [borrowerBalanceChange, -borrowerBalanceChange + totalAddonAmount, -totalAddonAmount, 0]
        );
        expect(await getNumberOfEvents(tx, token, EVENT_NAME_TRANSFER)).to.eq(2);
      } else { // props.isAddonTreasuryConfigured == false
        await expect(tx).to.changeTokenBalances(
          token,
          [borrower, liquidityPool, addonTreasury, market],
          [borrowerBalanceChange, -borrowerBalanceChange, 0, 0]
        );
        expect(await getNumberOfEvents(tx, token, EVENT_NAME_TRANSFER)).to.eq(1);
      }
    }

    describe("Executes as expected and emits correct event if", async () => {
      describe("The addon treasury is NOT configured on the liquidity pool", async () => {
        it("Is called by the borrower before the cooldown expiration and with no repayments", async () => {
          const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
          const loans = fixture.installmentLoanParts;
          const timestamp = removeTimestampOffset(
            loans[0].state.startTimestamp + (COOLDOWN_IN_PERIODS - 1) * PERIOD_IN_SECONDS
          );
          await increaseBlockTimestampTo(timestamp);
          await revokeAndCheck(fixture, {
            isAddonTreasuryConfigured: false,
            currentLoans: loans,
            revoker: borrower
          });
        });
      });
      describe("The addon treasury is configured on the liquidity pool", async () => {
        it("Is called by the borrower before the cooldown expiration and with no repayments", async () => {
          const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
          const loans = fixture.installmentLoanParts;
          const timestamp = removeTimestampOffset(
            loans[0].state.startTimestamp + (COOLDOWN_IN_PERIODS - 1) * PERIOD_IN_SECONDS
          );
          await increaseBlockTimestampTo(timestamp);
          await revokeAndCheck(fixture, {
            isAddonTreasuryConfigured: true,
            currentLoans: loans,
            revoker: borrower
          });
        });

        it("Is called by the lender and all installments are repaid except the last one", async () => {
          const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);

          const loans = fixture.installmentLoanParts.map(loan => clone(loan));
          for (let i = 0; i < loans.length - 1; ++i) {
            const loan = loans[i];
            const tx = await proveTx(connect(fixture.market, borrower).repayLoan(loan.id, FULL_REPAYMENT_AMOUNT));
            const repaymentTimestamp = await getBlockTimestamp(tx.blockNumber);
            processRepayment(loan, { repaymentAmount: FULL_REPAYMENT_AMOUNT, repaymentTimestamp });
          }

          const timestamp = removeTimestampOffset(
            loans[0].state.startTimestamp + (COOLDOWN_IN_PERIODS) * PERIOD_IN_SECONDS + 1
          );
          await increaseBlockTimestampTo(timestamp);

          await revokeAndCheck(fixture, {
            isAddonTreasuryConfigured: true,
            currentLoans: loans,
            revoker: lender
          });
        });

        // Other cases are checked in tests for the `revokeLoan()` function
      });
    });

    describe("Is reverted if", async () => {
      it("The contract is paused", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const { market, marketUnderLender, installmentLoanParts: [loan] } = fixture;
        await proveTx(market.pause());

        await expect(marketUnderLender.revokeInstallmentLoan(loan.id))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
      });

      it("The loan does not exist", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const { market, installmentLoanParts: [loan] } = fixture;

        await expect(market.revokeInstallmentLoan(loan.id + 123))
          .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_NOT_EXIST);
      });

      it("All the sub-loans of the installment loan are already repaid", async () => {
        const {
          marketUnderLender,
          installmentLoanParts: loans
        } = await setUpFixture(deployLendingMarketAndTakeLoans);
        for (const loan of loans) {
          await proveTx(connect(marketUnderLender, borrower).repayLoan(loan.id, FULL_REPAYMENT_AMOUNT));
        }

        await expect(marketUnderLender.revokeInstallmentLoan(loans[0].id))
          .to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_LOAN_ALREADY_REPAID);
      });

      it("The loan is an ordinary loan", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const { market, ordinaryLoan: loan } = fixture;

        await expect(market.revokeInstallmentLoan(loan.id))
          .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_TYPE_UNEXPECTED)
          .withArgs(
            LoanType.Ordinary, // actual
            LoanType.Installment // expected
          );
      });

      it("The cooldown period has passed when it is called by the borrower", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const { market, installmentLoanParts: loans } = fixture;
        const lastLoanId = loans[loans.length - 1].id;
        const timestampAfterCooldown =
          removeTimestampOffset(loans[0].state.startTimestamp) +
          COOLDOWN_IN_PERIODS * PERIOD_IN_SECONDS;
        await increaseBlockTimestampTo(timestampAfterCooldown);

        await expect(connect(market, borrower).revokeInstallmentLoan(lastLoanId))
          .to.be.revertedWithCustomError(market, ERROR_NAME_COOLDOWN_PERIOD_PASSED);
      });

      it("The caller is not the lender, the borrower, or an alias", async () => {
        const { market, installmentLoanParts: [loan] } = await setUpFixture(deployLendingMarketAndTakeLoans);

        await expect(connect(market, attacker).revokeInstallmentLoan(loan.id))
          .to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
      });
    });
  });

  describe("View functions", async () => {
    // This section tests only those functions that have not been previously used in other sections.
    it("Function 'getLoanPreview()' executes as expected", async () => {
      const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
      const { market } = fixture;

      const loans = [
        fixture.ordinaryLoan,
        fixture.installmentLoanParts[fixture.installmentLoanParts.length - 1]
      ];
      const minDuration = Math.min(...loans.map(loan => loan.state.durationInPeriods));
      const maxDuration = Math.max(...loans.map(loan => loan.state.durationInPeriods));
      expect(minDuration).to.be.greaterThan(0);

      // The loan at the latest block timestamp
      let timestamp = await getLatestBlockTimestamp();
      let expectedLoanPreviews: LoanPreview[] = loans.map(loan => determineLoanPreview(loan, timestamp));
      let actualLoanPreviews: LoanPreview[] = [];
      for (const loan of loans) {
        actualLoanPreviews.push(await market.getLoanPreview(loan.id, 0));
      }
      for (let i = 0; i < loans.length; ++i) {
        checkEquality(actualLoanPreviews[i], expectedLoanPreviews[i], i);
      }

      // The loan at the middle of its duration
      timestamp += Math.floor(minDuration / 2) * PERIOD_IN_SECONDS;
      expectedLoanPreviews = loans.map(loan => determineLoanPreview(loan, timestamp));
      actualLoanPreviews = [];
      for (const loan of loans) {
        actualLoanPreviews.push(await market.getLoanPreview(loan.id, timestamp));
      }
      for (let i = 0; i < loans.length; ++i) {
        checkEquality(actualLoanPreviews[i], expectedLoanPreviews[i], i);
      }

      // The loan after defaulting
      timestamp += maxDuration * PERIOD_IN_SECONDS;
      expectedLoanPreviews = loans.map(loan => determineLoanPreview(loan, timestamp));
      actualLoanPreviews = [];
      for (const loan of loans) {
        actualLoanPreviews.push(await market.getLoanPreview(loan.id, timestamp));
      }
      for (let i = 0; i < loans.length; ++i) {
        checkEquality(actualLoanPreviews[i], expectedLoanPreviews[i], i);
      }
    });

    it("Function 'getLoanPreviewExtendedBatch()' executes as expected", async () => {
      const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
      const { market } = fixture;

      const loans = [
        clone(fixture.ordinaryLoan),
        clone(fixture.installmentLoanParts[fixture.installmentLoanParts.length - 1])
      ];
      const loanIds = loans.map(loan => loan.id);
      const minDuration = Math.min(...loans.map(loan => loan.state.durationInPeriods));
      const maxDuration = Math.max(...loans.map(loan => loan.state.durationInPeriods));
      expect(minDuration).to.be.greaterThan(0);

      // The loans at the latest block timestamp
      let timestamp = await getLatestBlockTimestamp();
      let expectedLoanPreviews: LoanPreviewExtended[] =
        loans.map(loan => determineLoanPreviewExtended(loan, timestamp));
      let actualLoanPreviews = await market.getLoanPreviewExtendedBatch(loanIds, 0);
      expect(actualLoanPreviews.length).to.eq(expectedLoanPreviews.length);
      for (let i = 0; i < expectedLoanPreviews.length; ++i) {
        checkEquality(actualLoanPreviews[i], expectedLoanPreviews[i], i);
      }

      // The loans at the middle of its duration
      timestamp += Math.floor(minDuration / 2) * PERIOD_IN_SECONDS;
      expectedLoanPreviews = loans.map(loan => determineLoanPreviewExtended(loan, timestamp));
      actualLoanPreviews = await market.getLoanPreviewExtendedBatch(loanIds, calculateTimestampWithOffset(timestamp));
      expect(actualLoanPreviews.length).to.eq(expectedLoanPreviews.length);
      for (let i = 0; i < expectedLoanPreviews.length; ++i) {
        checkEquality(actualLoanPreviews[i], expectedLoanPreviews[i], i);
      }

      // The loans after defaulting
      timestamp += maxDuration * PERIOD_IN_SECONDS;
      expectedLoanPreviews = loans.map(loan => determineLoanPreviewExtended(loan, timestamp));
      actualLoanPreviews = await market.getLoanPreviewExtendedBatch(loanIds, calculateTimestampWithOffset(timestamp));
      expect(actualLoanPreviews.length).to.eq(expectedLoanPreviews.length);
      for (let i = 0; i < expectedLoanPreviews.length; ++i) {
        checkEquality(actualLoanPreviews[i], expectedLoanPreviews[i], i);
      }

      // The loans are partially repaid after defaulting (checking the late fee preview logic)
      const periodIndex = calculatePeriodIndex(loans[0].state.startTimestamp) + maxDuration + 1;
      await increaseBlockTimestampToPeriodIndex(periodIndex);
      for (const loan of loans) {
        const tx = connect(market, borrower).repayLoan(loan.id, REPAYMENT_AMOUNT);
        const repaymentTimestamp = await getTxTimestamp(tx);
        processRepayment(loan, { repaymentTimestamp, repaymentAmount: REPAYMENT_AMOUNT });
      }
      timestamp = await getLatestBlockTimestamp() + 2 * PERIOD_IN_SECONDS + 1000;
      expectedLoanPreviews = loans.map(loan => determineLoanPreviewExtended(loan, timestamp));
      actualLoanPreviews = await market.getLoanPreviewExtendedBatch(loanIds, calculateTimestampWithOffset(timestamp));
      expect(actualLoanPreviews.length).to.eq(expectedLoanPreviews.length);
      for (let i = 0; i < expectedLoanPreviews.length; ++i) {
        checkEquality(actualLoanPreviews[i], expectedLoanPreviews[i], i);
      }
    });

    it("Function 'getInstallmentLoanPreview()' executes as expected for an ordinary loan", async () => {
      const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
      const { market, ordinaryLoan: loan } = fixture;

      // The loan at the latest block timestamp
      let timestamp = await getLatestBlockTimestamp();
      let expectedLoanPreview: InstallmentLoanPreview = defineInstallmentLoanPreview([loan], timestamp);
      let actualLoanPreview = await market.getInstallmentLoanPreview(loan.id, 0);
      checkInstallmentLoanPreviewEquality(actualLoanPreview, expectedLoanPreview);

      // The loan at the middle of its duration
      timestamp += Math.floor(loan.state.durationInPeriods / 2) * PERIOD_IN_SECONDS;
      expectedLoanPreview = defineInstallmentLoanPreview([loan], timestamp);
      actualLoanPreview = await market.getInstallmentLoanPreview(loan.id, calculateTimestampWithOffset(timestamp));
      checkInstallmentLoanPreviewEquality(actualLoanPreview, expectedLoanPreview);

      // The loan after defaulting
      timestamp += loan.state.durationInPeriods * PERIOD_IN_SECONDS;
      expectedLoanPreview = defineInstallmentLoanPreview([loan], timestamp);
      actualLoanPreview = await market.getInstallmentLoanPreview(loan.id, calculateTimestampWithOffset(timestamp));
      checkInstallmentLoanPreviewEquality(actualLoanPreview, expectedLoanPreview);
    });

    it("Function 'getInstallmentLoanPreview()' executes as expected for an installment loan", async () => {
      const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
      const { market, installmentLoanParts: loans } = fixture;
      const loan = fixture.installmentLoanParts.length > 1
        ? fixture.installmentLoanParts[1]
        : fixture.installmentLoanParts[0];
      const maxDuration = Math.max(...loans.map(loan => loan.state.durationInPeriods));

      // The loan at the latest block timestamp
      let timestamp = await getLatestBlockTimestamp();
      let expectedLoanPreview: InstallmentLoanPreview = defineInstallmentLoanPreview(loans, timestamp);
      let actualLoanPreview = await market.getInstallmentLoanPreview(loan.id, 0);
      checkInstallmentLoanPreviewEquality(actualLoanPreview, expectedLoanPreview);

      // The loan at the middle of its duration
      timestamp += Math.floor(maxDuration / 2) * PERIOD_IN_SECONDS;
      expectedLoanPreview = defineInstallmentLoanPreview(loans, timestamp);
      actualLoanPreview = await market.getInstallmentLoanPreview(loan.id, calculateTimestampWithOffset(timestamp));
      checkInstallmentLoanPreviewEquality(actualLoanPreview, expectedLoanPreview);

      // The loan after defaulting
      timestamp += maxDuration * PERIOD_IN_SECONDS;
      expectedLoanPreview = defineInstallmentLoanPreview(loans, timestamp);
      actualLoanPreview = await market.getInstallmentLoanPreview(loan.id, calculateTimestampWithOffset(timestamp));
      checkInstallmentLoanPreviewEquality(actualLoanPreview, expectedLoanPreview);
    });
  });

  describe("Pure functions", async () => {
    it("Function 'calculateOutstandingBalance()' executes as expected", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoans);
      const actualBalance = await market.calculateOutstandingBalance(
        BORROW_AMOUNT,
        DURATION_IN_PERIODS,
        INTEREST_RATE_PRIMARY,
        INTEREST_RATE_FACTOR
      );

      const expectedBalance = calculateOutstandingBalance(
        BORROW_AMOUNT,
        DURATION_IN_PERIODS,
        INTEREST_RATE_PRIMARY
      );
      expect(actualBalance).to.eq(expectedBalance);
    });

    it("Function 'calculatePeriodIndex()' executes as expected", async () => {
      const { market, ordinaryLoan } = await setUpFixture(deployLendingMarketAndTakeLoans);
      const timestamp = ordinaryLoan.state.startTimestamp;

      const actualPeriodIndex = await market.calculatePeriodIndex(timestamp, PERIOD_IN_SECONDS);
      const expectedPeriodIndex = calculatePeriodIndex(timestamp);

      expect(actualPeriodIndex).to.eq(expectedPeriodIndex);
    });
  });
});
