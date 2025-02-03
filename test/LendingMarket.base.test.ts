import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory, TransactionResponse } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  checkContractUupsUpgrading,
  connect,
  deployAndConnectContract,
  getAddress,
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
  lateFeeAmount: number;
}

interface LoanState {
  programId: number;
  borrowedAmount: number;
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
  discountAmount: number;

  [key: string]: string | number; // Index signature
}

interface Loan {
  id: number;
  startPeriod: number;
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
  borrowedAmount: number;
  addonAmount: number;
  repaidAmount: number;
  lateFeeAmount: number;
  discountAmount: number;
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
  totalBorrowedAmount: number;
  totalAddonAmount: number;
  totalRepaidAmount: number;
  totalLateFeeAmount: number;
  totalDiscountAmount: number;
  installmentPreviews: LoanPreviewExtended[];

  [key: string]: number | LoanPreviewExtended[]; // Index signature
}

interface Fixture {
  market: Contract;
  marketUnderAdmin: Contract;
  marketAddress: string;
  ordinaryLoan: Loan;
  installmentLoanParts: Loan[];
}

interface Version {
  major: number;
  minor: number;
  patch: number;

  [key: string]: number; // Indexing signature to ensure that fields are iterated over in a key-value style
}

enum PayerKind {
  Borrower = 0,
  Stranger = 1
}

const ERROR_NAME_ADDON_TREASURY_ADDRESS_ZERO = "AddonTreasuryAddressZero";
const ERROR_NAME_ALREADY_CONFIGURED = "AlreadyConfigured";
const ERROR_NAME_ALREADY_INITIALIZED = "InvalidInitialization";
const ERROR_NAME_CONTRACT_ADDRESS_INVALID = "ContractAddressInvalid";
const ERROR_NAME_CONTRACT_IS_NOT_INITIALIZING = "NotInitializing";
const ERROR_NAME_ENFORCED_PAUSED = "EnforcedPause";
const ERROR_NAME_LOAN_ALREADY_FROZEN = "LoanAlreadyFrozen";
const ERROR_NAME_LOAN_ALREADY_REPAID = "LoanAlreadyRepaid";
const ERROR_NAME_LOAN_NOT_EXIST = "LoanNotExist";
const ERROR_NAME_LOAN_NOT_FROZEN = "LoanNotFrozen";
const ERROR_NAME_INAPPROPRIATE_DURATION_IN_PERIODS = "InappropriateLoanDuration";
const ERROR_NAME_INAPPROPRIATE_INTEREST_RATE = "InappropriateInterestRate";
const ERROR_NAME_INVALID_AMOUNT = "InvalidAmount";
const ERROR_NAME_IMPLEMENTATION_ADDRESS_INVALID = "ImplementationAddressInvalid";
const ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED = "AccessControlUnauthorizedAccount";
const ERROR_NAME_ZERO_ADDRESS = "ZeroAddress";
const ERROR_NAME_PROGRAM_CREDIT_LINE_NOT_CONFIGURED = "ProgramCreditLineNotConfigured";
const ERROR_NAME_PROGRAM_LIQUIDITY_POOL_NOT_CONFIGURED = "ProgramLiquidityPoolNotConfigured";
const ERROR_NAME_PROGRAM_NOT_EXIST = "ProgramNotExist";
const ERROR_NAME_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST = "SafeCastOverflowedUintDowncast";
const ERROR_NAME_DURATION_ARRAY_INVALID = "DurationArrayInvalid";
const ERROR_NAME_INSTALLMENT_COUNT_EXCESS = "InstallmentCountExcess";
const ERROR_NAME_ARRAY_LENGTH_MISMATCH = "ArrayLengthMismatch";
const ERROR_NAME_LOAN_TYPE_UNEXPECTED = "LoanTypeUnexpected";
const ERROR_NAME_LOAN_ID_EXCESS = "LoanIdExcess";
const ERROR_NAME_PROGRAM_ID_EXCESS = "ProgramIdExcess";

const EVENT_NAME_LENDER_ALIAS_CONFIGURED = "LenderAliasConfigured";
const EVENT_NAME_PROGRAM_CREATED = "ProgramCreated";
const EVENT_NAME_PROGRAM_UPDATED = "ProgramUpdated";
const EVENT_NAME_LOAN_INTEREST_RATE_PRIMARY_UPDATED = "LoanInterestRatePrimaryUpdated";
const EVENT_NAME_LOAN_INTEREST_RATE_SECONDARY_UPDATED = "LoanInterestRateSecondaryUpdated";
const EVENT_NAME_LOAN_DURATION_UPDATED = "LoanDurationUpdated";
const EVENT_NAME_LOAN_FROZEN = "LoanFrozen";
const EVENT_NAME_LOAN_REPAYMENT = "LoanRepayment";
const EVENT_NAME_LOAN_DISCOUNTED = "LoanDiscounted";
const EVENT_NAME_LOAN_TAKEN = "LoanTaken";
const EVENT_NAME_INSTALLMENT_LOAN_TAKEN = "InstallmentLoanTaken";
const EVENT_NAME_LOAN_UNFROZEN = "LoanUnfrozen";
const EVENT_NAME_ON_BEFORE_LOAN_TAKEN = "OnBeforeLoanTakenCalled";
const EVENT_NAME_ON_AFTER_LOAN_PAYMENT = "OnAfterLoanPaymentCalled";
const EVENT_NAME_LOAN_REVOKED = "LoanRevoked";
const EVENT_NAME_INSTALLMENT_LOAN_REVOKED = "InstallmentLoanRevoked";
const EVENT_NAME_ON_AFTER_LOAN_REVOCATION = "OnAfterLoanRevocationCalled";
const EVENT_NAME_TRANSFER = "Transfer";

const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
const OWNER_ROLE = ethers.id("OWNER_ROLE");
const ADMIN_ROLE = ethers.id("ADMIN_ROLE");
const PAUSER_ROLE = ethers.id("PAUSER_ROLE");

const ZERO_ADDRESS = ethers.ZeroAddress;
const ACCURACY_FACTOR = 10_000;
const INITIAL_BALANCE = 1000_000_000_000;
const BORROWED_AMOUNT = 100_000_000_000;
const ADDON_AMOUNT = 100_000;
const REPAYMENT_AMOUNT = 50_000_000_000;
const DISCOUNT_AMOUNT = 10_000_000_000;
const FULL_REPAYMENT_AMOUNT = ethers.MaxUint256;
const INTEREST_RATE_FACTOR = 10 ** 9;
const INTEREST_RATE_PRIMARY = INTEREST_RATE_FACTOR / 10;
const INTEREST_RATE_SECONDARY = INTEREST_RATE_FACTOR / 5;
const LATE_FEE_AMOUNT = ACCURACY_FACTOR / 2 - 1;
const PERIOD_IN_SECONDS = 86400;
const DURATION_IN_PERIODS = 10;
const PROGRAM_ID = 1;
const NEGATIVE_TIME_OFFSET = 3 * 60 * 60; // 3 hours

const INSTALLMENT_COUNT = 3;
const BORROWED_AMOUNTS: number[] = [BORROWED_AMOUNT * 3 - 2, BORROWED_AMOUNT * 2 + 1, BORROWED_AMOUNT + 1];
const ADDON_AMOUNTS: number[] = [ADDON_AMOUNT * 3 - 2, ADDON_AMOUNT * 2 + 1, ADDON_AMOUNT + 1];
const DURATIONS_IN_PERIODS: number[] = [0, DURATION_IN_PERIODS / 2, DURATION_IN_PERIODS];

const EXPECTED_VERSION: Version = {
  major: 1,
  minor: 9,
  patch: 0
};

const defaultLoanState: LoanState = {
  programId: 0,
  borrowedAmount: 0,
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
  lateFeeAmount: 0,
  discountAmount: 0
};

const defaultLoanConfig: LoanConfig = {
  lateFeeAmount: 0
};

const defaultLoan: Loan = {
  id: 0,
  startPeriod: 0,
  state: defaultLoanState,
  config: defaultLoanConfig
};

function clone(originLoan: Loan): Loan {
  return {
    id: originLoan.id,
    startPeriod: originLoan.startPeriod,
    state: { ...originLoan.state },
    config: { ...originLoan.config }
  };
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

function roundSpecific(value: bigint | number): number {
  return Number(roundMath(value, ACCURACY_FACTOR));
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

  let deployer: HardhatEthersSigner;
  let owner: HardhatEthersSigner;
  let borrower: HardhatEthersSigner;
  let admin: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;
  let addonTreasury: HardhatEthersSigner;

  let creditLineAddress: string;
  let anotherCreditLineAddress: string;
  let liquidityPoolAddress: string;
  let anotherLiquidityPoolAddress: string;
  let tokenAddress: string;

  before(async () => {
    [deployer, owner, borrower, admin, stranger, addonTreasury] = await ethers.getSigners();

    // Factories with an explicitly specified deployer account
    lendingMarketFactory = await ethers.getContractFactory("LendingMarketTestable");
    lendingMarketFactory = lendingMarketFactory.connect(deployer);
    creditLineFactory = await ethers.getContractFactory("CreditLineMock");
    creditLineFactory = creditLineFactory.connect(deployer);
    liquidityPoolFactory = await ethers.getContractFactory("LiquidityPoolMock");
    liquidityPoolFactory = liquidityPoolFactory.connect(deployer);
    tokenFactory = await ethers.getContractFactory("ERC20Mock");
    tokenFactory = tokenFactory.connect(deployer);

    creditLine = await deployAndConnectContract(creditLineFactory, deployer);
    anotherCreditLine = await deployAndConnectContract(creditLineFactory, deployer);
    liquidityPool = await deployAndConnectContract(liquidityPoolFactory, deployer);
    anotherLiquidityPool = await deployAndConnectContract(liquidityPoolFactory, deployer);
    token = await deployAndConnectContract(tokenFactory, deployer);

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
    borrowedAmount: number;
    addonAmount: number;
    lateFeeAmount: number;
    timestamp: number;
  }): Loan {
    const timestampWithOffset = calculateTimestampWithOffset(props.timestamp);
    const loanState: LoanState = {
      ...defaultLoanState,
      programId: PROGRAM_ID,
      borrowedAmount: props.borrowedAmount,
      addonAmount: props.addonAmount,
      startTimestamp: timestampWithOffset,
      durationInPeriods: DURATION_IN_PERIODS,
      token: tokenAddress,
      borrower: borrower.address,
      interestRatePrimary: INTEREST_RATE_PRIMARY,
      interestRateSecondary: INTEREST_RATE_SECONDARY,
      trackedBalance: props.borrowedAmount + props.addonAmount,
      trackedTimestamp: timestampWithOffset
    };
    const loanConfig: LoanConfig = {
      ...defaultLoanConfig,
      lateFeeAmount: props.lateFeeAmount
    };
    return {
      id: props.id,
      startPeriod: calculatePeriodIndex(timestampWithOffset),
      state: loanState,
      config: loanConfig
    };
  }

  function createInstallmentLoanParts(props: {
    firstInstallmentId: number;
    borrowedAmounts: number[];
    addonAmounts: number[];
    durations: number[];
    lateFeeAmount: number;
    timestamp: number;
  }): Loan[] {
    const timestampWithOffset = calculateTimestampWithOffset(props.timestamp);
    const startPeriod = calculatePeriodIndex(timestampWithOffset);
    const loans: Loan[] = [];
    for (let i = 0; i < props.borrowedAmounts.length; ++i) {
      const loanState = {
        ...defaultLoanState,
        programId: PROGRAM_ID,
        borrowedAmount: props.borrowedAmounts[i],
        addonAmount: props.addonAmounts[i],
        startTimestamp: timestampWithOffset,
        durationInPeriods: DURATIONS_IN_PERIODS[i],
        token: tokenAddress,
        borrower: borrower.address,
        interestRatePrimary: INTEREST_RATE_PRIMARY,
        interestRateSecondary: INTEREST_RATE_SECONDARY,
        trackedBalance: props.borrowedAmounts[i] + props.addonAmounts[i],
        trackedTimestamp: timestampWithOffset,
        firstInstallmentId: props.firstInstallmentId,
        installmentCount: props.borrowedAmounts.length
      };
      const loanConfig: LoanConfig = {
        ...defaultLoanConfig,
        lateFeeAmount: props.lateFeeAmount
      };
      loans.push({ id: props.firstInstallmentId + i, startPeriod, state: loanState, config: loanConfig });
    }
    return loans;
  }

  function calculateTrackedBalance(originalBalance: number, numberOfPeriods: number, interestRate: number): number {
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

    if (loan.state.trackedBalance != 0 && periodIndex > duePeriodIndex && trackedPeriodIndex <= duePeriodIndex) {
      return loan.config.lateFeeAmount;
    } else {
      return 0;
    }
  }

  function determineLoanPreview(loan: Loan, timestamp: number): LoanPreview {
    let trackedBalance = loan.state.trackedBalance;
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
      trackedBalance = calculateTrackedBalance(
        trackedBalance,
        numberOfPeriodsWithPrimaryRate,
        loan.state.interestRatePrimary
      );
    }

    if (numberOfPeriodsWithSecondaryRate > 0) {
      trackedBalance += determineLateFeeAmount(loan, timestamp);
      trackedBalance = calculateTrackedBalance(
        trackedBalance,
        numberOfPeriodsWithSecondaryRate,
        loan.state.interestRateSecondary
      );
    }
    return {
      periodIndex,
      trackedBalance,
      outstandingBalance: roundSpecific(trackedBalance)
    };
  }

  function determineLoanPreviewExtended(loan: Loan, timestamp: number): LoanPreviewExtended {
    const loanPreview: LoanPreview = determineLoanPreview(loan, timestamp);
    const lateFeeAmount = determineLateFeeAmount(loan, timestamp);
    return {
      periodIndex: loanPreview.periodIndex,
      trackedBalance: loanPreview.trackedBalance,
      outstandingBalance: loanPreview.outstandingBalance,
      borrowedAmount: loan.state.borrowedAmount,
      addonAmount: loan.state.addonAmount,
      repaidAmount: loan.state.repaidAmount,
      discountAmount: loan.state.discountAmount,
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
      totalBorrowedAmount: loans.map(loan => loan.state.borrowedAmount).reduce((sum, amount) => sum + amount),
      totalAddonAmount: loans.map(loan => loan.state.addonAmount).reduce((sum, amount) => sum + amount),
      totalRepaidAmount: loans.map(loan => loan.state.repaidAmount).reduce((sum, amount) => sum + amount),
      totalLateFeeAmount: loanPreviews.map(preview => preview.lateFeeAmount).reduce((sum, amount) => sum + amount),
      totalDiscountAmount: loanPreviews.map(preview => preview.discountAmount).reduce((sum, amount) => sum + amount),
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

  function processDiscount(loan: Loan, props: {
    discountAmount: number | bigint;
    discountTimestamp: number;
  }) {
    const discountTimestampWithOffset = calculateTimestampWithOffset(props.discountTimestamp);
    if (loan.state.trackedTimestamp >= discountTimestampWithOffset) {
      return;
    }
    let discountAmount = props.discountAmount;
    const loanPreviewBeforeDiscount = determineLoanPreview(loan, props.discountTimestamp);
    loan.state.lateFeeAmount = determineLateFeeAmount(loan, props.discountTimestamp);
    if (loanPreviewBeforeDiscount.outstandingBalance === discountAmount) {
      discountAmount = FULL_REPAYMENT_AMOUNT;
    }
    if (discountAmount === FULL_REPAYMENT_AMOUNT) {
      loan.state.trackedBalance = 0;
      loan.state.discountAmount += loanPreviewBeforeDiscount.outstandingBalance;
    } else {
      discountAmount = Number(discountAmount);
      loan.state.trackedBalance = loanPreviewBeforeDiscount.trackedBalance - discountAmount;
      loan.state.discountAmount += discountAmount;
    }
    loan.state.trackedTimestamp = discountTimestampWithOffset;
  }

  async function deployLendingMarket(): Promise<Fixture> {
    let market = await upgrades.deployProxy(lendingMarketFactory, [owner.address], { kind: "uups" });

    market = connect(market, owner); // Explicitly specifying the initial account
    const marketUnderAdmin = connect(market, admin);
    const marketAddress = getAddress(market);

    return {
      market,
      marketUnderAdmin,
      marketAddress,
      ordinaryLoan: defaultLoan,
      installmentLoanParts: []
    };
  }

  async function deployLendingMarketAndConfigureItForLoan(): Promise<Fixture> {
    const fixture: Fixture = await deployLendingMarket();
    const { market, marketAddress } = fixture;

    // Register and configure a credit line & liquidity pool
    await proveTx(market.createProgram(creditLineAddress, liquidityPoolAddress));

    // Grant roles
    await proveTx(market.grantRole(PAUSER_ROLE, owner.address));
    await proveTx(market.grantRole(ADMIN_ROLE, admin.address));

    // Mock configurations
    await proveTx(creditLine.mockLoanTerms(borrower.address, BORROWED_AMOUNT, creatLoanTerms()));
    await proveTx(liquidityPool.mockAddonTreasury(addonTreasury.address));

    // Supply tokens
    await proveTx(token.mint(owner.address, INITIAL_BALANCE));
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
    const { marketUnderAdmin } = fixture;

    // Configure the late fee amount
    const lateFeeAmount = (LATE_FEE_AMOUNT);
    await proveTx(creditLine.mockLateFeeAmount(lateFeeAmount));

    // Take an ordinary loan
    const ordinaryLoanId = Number(await marketUnderAdmin.loanCounter());
    const tx1 = marketUnderAdmin.takeLoanFor(
      borrower.address,
      PROGRAM_ID,
      BORROWED_AMOUNT,
      ADDON_AMOUNT,
      DURATION_IN_PERIODS
    );
    fixture.ordinaryLoan = createLoan({
      id: ordinaryLoanId,
      borrowedAmount: BORROWED_AMOUNT,
      addonAmount: ADDON_AMOUNT,
      lateFeeAmount,
      timestamp: await getTxTimestamp(tx1)
    });

    // Take an installment loan
    const firstInstallmentId = Number(await marketUnderAdmin.loanCounter());
    const tx2 = marketUnderAdmin.takeInstallmentLoanFor(
      borrower.address,
      PROGRAM_ID,
      BORROWED_AMOUNTS,
      ADDON_AMOUNTS,
      DURATIONS_IN_PERIODS
    );

    fixture.installmentLoanParts = createInstallmentLoanParts({
      firstInstallmentId,
      borrowedAmounts: BORROWED_AMOUNTS,
      addonAmounts: ADDON_AMOUNTS,
      durations: DURATIONS_IN_PERIODS,
      lateFeeAmount,
      timestamp: await getTxTimestamp(tx2)
    });
    return fixture;
  }

  describe("Function initialize()", async () => {
    it("Configures the contract as expected", async () => {
      const { market } = await setUpFixture(deployLendingMarket);

      // Role hashes
      expect(await market.OWNER_ROLE()).to.equal(OWNER_ROLE);
      expect(await market.ADMIN_ROLE()).to.equal(ADMIN_ROLE);
      expect(await market.PAUSER_ROLE()).to.equal(PAUSER_ROLE);

      // The role admins
      expect(await market.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE);
      expect(await market.getRoleAdmin(ADMIN_ROLE)).to.equal(OWNER_ROLE);
      expect(await market.getRoleAdmin(PAUSER_ROLE)).to.equal(OWNER_ROLE);

      // Roles
      expect(await market.hasRole(OWNER_ROLE, deployer.address)).to.equal(false);
      expect(await market.hasRole(ADMIN_ROLE, deployer.address)).to.equal(false);
      expect(await market.hasRole(OWNER_ROLE, owner.address)).to.equal(true); // !!!
      expect(await market.hasRole(ADMIN_ROLE, owner.address)).to.equal(false);

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
      const expectedLoanPreviewExtended: LoanPreviewExtended =
        determineLoanPreviewExtended(defaultLoan, await getLatestBlockTimestamp());
      const someLoanId = 123;
      checkEquality(await market.getLoanState(someLoanId), defaultLoanState);
      checkEquality(await market.getLoanPreview(someLoanId, 0), expectedLoanPreview);
      checkEquality((await market.getLoanPreviewExtendedBatch([someLoanId], 0))[0], expectedLoanPreviewExtended);
    });

    it("Is reverted if called a second time", async () => {
      const { market } = await setUpFixture(deployLendingMarket);

      await expect(market.initialize(owner.address))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ALREADY_INITIALIZED);
    });

    it("Is reverted if the internal initializer is called outside the init process", async () => {
      const { market } = await setUpFixture(deployLendingMarket);
      await expect(
        market.call_parent_initialize(owner.address) // Call via the testable version
      ).to.be.revertedWithCustomError(market, ERROR_NAME_CONTRACT_IS_NOT_INITIALIZING);
    });

    it("Is reverted if the unchained internal initializer is called outside the init process", async () => {
      const { market } = await setUpFixture(deployLendingMarket);
      await expect(
        market.call_parent_initialize_unchained(owner.address) // Call via the testable version
      ).to.be.revertedWithCustomError(market, ERROR_NAME_CONTRACT_IS_NOT_INITIALIZING);
    });
  });

  describe("Function '$__VERSION()'", async () => {
    it("Returns expected values", async () => {
      const { market } = await setUpFixture(deployLendingMarket);
      const marketVersion = await market.$__VERSION();
      checkEquality(marketVersion, EXPECTED_VERSION);
    });
  });

  describe("Function 'upgradeToAndCall()'", async () => {
    it("Executes as expected", async () => {
      const { market } = await setUpFixture(deployLendingMarket);
      await checkContractUupsUpgrading(market, lendingMarketFactory);
    });

    it("Is reverted if the caller does not have the owner role", async () => {
      const { market } = await setUpFixture(deployLendingMarket);

      await expect(connect(market, admin).upgradeToAndCall(market, "0x"))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(admin.address, OWNER_ROLE);
      await expect(connect(market, stranger).upgradeToAndCall(market, "0x"))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(stranger.address, OWNER_ROLE);
    });

    it("Is reverted if the provided implementation address is not a lending market contract", async () => {
      const { market } = await setUpFixture(deployLendingMarket);
      const mockContractFactory = await ethers.getContractFactory("UUPSExtUpgradeableMock");
      const mockContract = await mockContractFactory.deploy() as Contract;
      await mockContract.waitForDeployment();

      await expect(market.upgradeToAndCall(mockContract, "0x"))
        .to.be.revertedWithCustomError(market, ERROR_NAME_IMPLEMENTATION_ADDRESS_INVALID);
    });
  });

  describe("Function 'createProgram()'", async () => {
    it("Executes as expected and emits the correct events", async () => {
      const { market } = await setUpFixture(deployLendingMarket);

      const tx = market.createProgram(creditLineAddress, liquidityPoolAddress);
      await expect(tx)
        .to.emit(market, EVENT_NAME_PROGRAM_CREATED)
        .withArgs(owner.address, PROGRAM_ID);
      await expect(tx)
        .to.emit(market, EVENT_NAME_PROGRAM_UPDATED)
        .withArgs(PROGRAM_ID, creditLineAddress, liquidityPoolAddress);

      expect(await market.getProgramCreditLine(PROGRAM_ID)).to.eq(creditLineAddress);
      expect(await market.getProgramLiquidityPool(PROGRAM_ID)).to.eq(liquidityPool);
    });

    it("Is reverted if the contract is paused", async () => {
      const { market } = await setUpFixture(deployLendingMarket);
      await proveTx(market.grantRole(PAUSER_ROLE, owner.address));
      await proveTx(market.pause());

      await expect(market.createProgram(creditLineAddress, liquidityPoolAddress))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the caller does not have the owner role", async () => {
      const { market } = await setUpFixture(deployLendingMarket);

      await expect(connect(market, admin).createProgram(creditLineAddress, liquidityPoolAddress))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(admin.address, OWNER_ROLE);
      await expect(connect(market, stranger).createProgram(creditLineAddress, liquidityPoolAddress))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(stranger.address, OWNER_ROLE);
    });

    it("Is reverted if the provided credit line address is zero", async () => {
      const { market } = await setUpFixture(deployLendingMarket);
      const wrongCreditLineAddress = (ZERO_ADDRESS);

      await expect(market.createProgram(wrongCreditLineAddress, liquidityPoolAddress))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ZERO_ADDRESS);
    });

    it("Is reverted if the provided credit line address is not a contract", async () => {
      const { market } = await setUpFixture(deployLendingMarket);
      const wrongCreditLineAddress = "0x0000000000000000000000000000000000000001";

      await expect(market.createProgram(wrongCreditLineAddress, liquidityPoolAddress))
        .to.be.revertedWithCustomError(market, ERROR_NAME_CONTRACT_ADDRESS_INVALID);
    });

    it("Is reverted if the provided credit line address is not a credit line contract", async () => {
      const { market } = await setUpFixture(deployLendingMarket);
      const wrongCreditLineAddress = (tokenAddress);

      await expect(market.createProgram(wrongCreditLineAddress, liquidityPoolAddress))
        .to.be.revertedWithCustomError(market, ERROR_NAME_CONTRACT_ADDRESS_INVALID);
    });

    it("Is reverted if the provided liquidity pool address is zero", async () => {
      const { market } = await setUpFixture(deployLendingMarket);
      const wrongLiquidityPoolAddress = (ZERO_ADDRESS);

      await expect(market.createProgram(creditLineAddress, wrongLiquidityPoolAddress))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ZERO_ADDRESS);
    });

    it("Is reverted if the provided liquidity pool address is not a contract", async () => {
      const { market } = await setUpFixture(deployLendingMarket);
      const wrongLiquidityPoolAddress = "0x0000000000000000000000000000000000000001";

      await expect(market.createProgram(creditLineAddress, wrongLiquidityPoolAddress))
        .to.be.revertedWithCustomError(market, ERROR_NAME_CONTRACT_ADDRESS_INVALID);
    });

    it("Is reverted if the provided liquidity pool address is not a liquidity pool contract", async () => {
      const { market } = await setUpFixture(deployLendingMarket);
      const wrongLiquidityPoolAddress = (tokenAddress);

      await expect(market.createProgram(creditLineAddress, wrongLiquidityPoolAddress))
        .to.be.revertedWithCustomError(market, ERROR_NAME_CONTRACT_ADDRESS_INVALID);
    });

    it("Is reverted if the lending program ID counter already equals the max value", async () => {
      const { market } = await setUpFixture(deployLendingMarket);

      await proveTx(market.setProgramIdCounter(maxUintForBits(32))); // Call via the testable version

      await expect(market.createProgram(creditLineAddress, liquidityPoolAddress))
        .to.be.revertedWithCustomError(market, ERROR_NAME_PROGRAM_ID_EXCESS);
    });
  });

  describe("Function 'updateProgram()'", async () => {
    it("Executes as expected and emits correct event", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);

      // Change the credit line address only
      await expect(market.updateProgram(PROGRAM_ID, anotherCreditLineAddress, liquidityPoolAddress))
        .to.emit(market, EVENT_NAME_PROGRAM_UPDATED)
        .withArgs(PROGRAM_ID, anotherCreditLineAddress, liquidityPoolAddress);
      expect(await market.getProgramCreditLine(PROGRAM_ID)).to.eq(anotherCreditLineAddress);
      expect(await market.getProgramLiquidityPool(PROGRAM_ID)).to.eq(liquidityPool);

      // Change the Liquidity pool address only
      await expect(market.updateProgram(PROGRAM_ID, anotherCreditLineAddress, anotherLiquidityPoolAddress))
        .to.emit(market, EVENT_NAME_PROGRAM_UPDATED)
        .withArgs(PROGRAM_ID, anotherCreditLineAddress, anotherLiquidityPoolAddress);
      expect(await market.getProgramCreditLine(PROGRAM_ID)).to.eq(anotherCreditLineAddress);
      expect(await market.getProgramLiquidityPool(PROGRAM_ID)).to.eq(anotherLiquidityPoolAddress);

      // Change the credit line and liquidity pool addresses together
      await expect(market.updateProgram(PROGRAM_ID, creditLineAddress, liquidityPoolAddress))
        .to.emit(market, EVENT_NAME_PROGRAM_UPDATED)
        .withArgs(PROGRAM_ID, creditLineAddress, liquidityPoolAddress);
      expect(await market.getProgramCreditLine(PROGRAM_ID)).to.eq(creditLineAddress);
      expect(await market.getProgramLiquidityPool(PROGRAM_ID)).to.eq(liquidityPoolAddress);
    });

    it("Is reverted if contract is paused", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
      await proveTx(market.grantRole(PAUSER_ROLE, owner.address));
      await proveTx(market.pause());

      await expect(
        market.updateProgram(PROGRAM_ID, creditLineAddress, liquidityPoolAddress)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the caller does not have the owner role", async () => {
      const { market } = await setUpFixture(deployLendingMarket);

      await expect(connect(market, admin).updateProgram(PROGRAM_ID, creditLineAddress, liquidityPoolAddress))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(admin.address, OWNER_ROLE);
      await expect(connect(market, stranger).updateProgram(PROGRAM_ID, creditLineAddress, liquidityPoolAddress))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(stranger.address, OWNER_ROLE);
    });

    it("Is reverted if the provided program ID is zero", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
      const wrongProgramId = 0;

      await expect(market.updateProgram(wrongProgramId, creditLineAddress, liquidityPoolAddress))
        .to.be.revertedWithCustomError(market, ERROR_NAME_PROGRAM_NOT_EXIST);
    });

    it("Is reverted if the provided credit line address is zero", async () => {
      const { market } = await setUpFixture(deployLendingMarket);
      const wrongCreditLineAddress = (ZERO_ADDRESS);

      await expect(
        market.updateProgram(PROGRAM_ID, wrongCreditLineAddress, liquidityPoolAddress)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_ZERO_ADDRESS);
    });

    it("Is reverted if the provided credit line address is not a contract", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoans);
      const wrongCreditLineAddress = "0x0000000000000000000000000000000000000001";

      await expect(
        market.updateProgram(PROGRAM_ID, wrongCreditLineAddress, liquidityPoolAddress)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_CONTRACT_ADDRESS_INVALID);
    });

    it("Is reverted if the provided credit line address is not a line contract", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoans);
      const wrongCreditLineAddress = (tokenAddress);

      await expect(
        market.updateProgram(PROGRAM_ID, wrongCreditLineAddress, liquidityPoolAddress)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_CONTRACT_ADDRESS_INVALID);
    });

    it("Is reverted if the provided liquidity pool address is zero", async () => {
      const { market } = await setUpFixture(deployLendingMarket);
      const wrongLiquidityPoolAddress = (ZERO_ADDRESS);

      await expect(
        market.updateProgram(PROGRAM_ID, creditLineAddress, wrongLiquidityPoolAddress)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_ZERO_ADDRESS);
    });

    it("Is reverted if the provided liquidity pool address is not a contract", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoans);
      const wrongLiquidityPoolAddress = "0x0000000000000000000000000000000000000001";

      await expect(
        market.updateProgram(PROGRAM_ID, creditLineAddress, wrongLiquidityPoolAddress)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_CONTRACT_ADDRESS_INVALID);
    });

    it("Is reverted if the provided liquidity pool address is not a pool contract", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoans);
      const wrongLiquidityPoolAddress = (tokenAddress);

      await expect(
        market.updateProgram(PROGRAM_ID, creditLineAddress, wrongLiquidityPoolAddress)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_CONTRACT_ADDRESS_INVALID);
    });

    it("Is reverted if the provided credit line and liquidity pool are already configured", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoans);

      await expect(
        market.updateProgram(PROGRAM_ID, creditLineAddress, liquidityPoolAddress)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_ALREADY_CONFIGURED);
    });
  });

  describe("Function 'takeLoanFor()'", async () => {
    async function executeAndCheck(props: { isAddonAmountZero: boolean }) {
      const { marketUnderAdmin } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);

      const addonAmount = props.isAddonAmountZero ? 0 : BORROWED_AMOUNT / 100;
      const principalAmount = BORROWED_AMOUNT + addonAmount;
      const expectedLoanId = 0;

      // Check the returned value of the function
      const actualLoanId: bigint = await marketUnderAdmin.takeLoanFor.staticCall(
        borrower.address,
        PROGRAM_ID,
        BORROWED_AMOUNT,
        addonAmount,
        DURATION_IN_PERIODS
      );
      expect(actualLoanId).to.eq(expectedLoanId);

      const tx: Promise<TransactionResponse> = marketUnderAdmin.takeLoanFor(
        borrower.address,
        PROGRAM_ID,
        BORROWED_AMOUNT,
        addonAmount,
        DURATION_IN_PERIODS
      );
      const timestamp = await getTxTimestamp(tx);
      const actualLoanState: LoanState = await marketUnderAdmin.getLoanState(expectedLoanId);
      const expectedLoan: Loan = createLoan({
        id: expectedLoanId,
        borrowedAmount: BORROWED_AMOUNT,
        addonAmount,
        lateFeeAmount: LATE_FEE_AMOUNT,
        timestamp
      });

      checkEquality(actualLoanState, expectedLoan.state);
      expect(await marketUnderAdmin.loanCounter()).to.eq(expectedLoanId + 1);

      await expect(tx).to.changeTokenBalances(
        token,
        [liquidityPool, borrower, addonTreasury, marketUnderAdmin],
        [-principalAmount, +BORROWED_AMOUNT, +addonAmount, 0]
      );
      if (addonAmount != 0) {
        expect(await getNumberOfEvents(tx, token, EVENT_NAME_TRANSFER)).to.eq(2);
      } else {
        expect(await getNumberOfEvents(tx, token, EVENT_NAME_TRANSFER)).to.eq(1);
      }

      await expect(tx)
        .to.emit(marketUnderAdmin, EVENT_NAME_LOAN_TAKEN)
        .withArgs(expectedLoanId, borrower.address, principalAmount, DURATION_IN_PERIODS);

      // Check that the appropriate market hook functions are called
      await expect(tx).to.emit(liquidityPool, EVENT_NAME_ON_BEFORE_LOAN_TAKEN).withArgs(expectedLoanId);
      await expect(tx).to.emit(creditLine, EVENT_NAME_ON_BEFORE_LOAN_TAKEN).withArgs(expectedLoanId);

      // Check the returned value of the function for the second loan
      const nextActualLoanId: bigint = await marketUnderAdmin.takeLoanFor.staticCall(
        borrower.address,
        PROGRAM_ID,
        BORROWED_AMOUNT,
        addonAmount,
        DURATION_IN_PERIODS
      );
      expect(nextActualLoanId).to.eq(expectedLoanId + 1);
    }

    describe("Executes as expected and emits the correct events if", async () => {
      it("The addon amount is NOT zero", async () => {
        await executeAndCheck({ isAddonAmountZero: false });
      });

      it("The addon amount is zero", async () => {
        await executeAndCheck({ isAddonAmountZero: true });
      });
    });

    describe("Is reverted if", async () => {
      it("The contract is paused", async () => {
        const { market, marketUnderAdmin } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        await proveTx(market.pause());

        await expect(
          marketUnderAdmin.takeLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROWED_AMOUNT,
            ADDON_AMOUNT,
            DURATION_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_ENFORCED_PAUSED);
      });

      it("The caller does not have the admin role", async () => {
        const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);

        await expect(
          connect(market, owner).takeLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROWED_AMOUNT,
            ADDON_AMOUNT,
            DURATION_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(
          market,
          ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED
        ).withArgs(owner.address, ADMIN_ROLE);

        await expect(
          connect(market, borrower).takeLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROWED_AMOUNT,
            ADDON_AMOUNT,
            DURATION_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(
          market,
          ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED
        ).withArgs(borrower.address, ADMIN_ROLE);
      });

      it("Te borrower address is zero", async () => {
        const { marketUnderAdmin } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        const wrongBorrowerAddress = (ZERO_ADDRESS);

        await expect(
          marketUnderAdmin.takeLoanFor(
            wrongBorrowerAddress,
            PROGRAM_ID,
            BORROWED_AMOUNT,
            ADDON_AMOUNT,
            DURATION_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_ZERO_ADDRESS);
      });

      it("The program ID is zero", async () => {
        const { marketUnderAdmin } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        const wrongProgramId = 0;

        await expect(
          marketUnderAdmin.takeLoanFor(
            borrower.address,
            wrongProgramId,
            BORROWED_AMOUNT,
            ADDON_AMOUNT,
            DURATION_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_PROGRAM_NOT_EXIST);
      });

      it("The borrowed amount is zero", async () => {
        const { marketUnderAdmin } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        const wrongBorrowedAmount = 0;

        await expect(
          marketUnderAdmin.takeLoanFor(
            borrower.address,
            PROGRAM_ID,
            wrongBorrowedAmount,
            ADDON_AMOUNT,
            DURATION_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_INVALID_AMOUNT);
      });

      it("The borrowed amount is not rounded according to the accuracy factor", async () => {
        const { marketUnderAdmin } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        const wrongBorrowedAmount = BORROWED_AMOUNT - 1;
        expect(wrongBorrowedAmount % ACCURACY_FACTOR).not.to.eq(0);

        await expect(
          marketUnderAdmin.takeLoanFor(
            borrower.address,
            PROGRAM_ID,
            wrongBorrowedAmount,
            ADDON_AMOUNT,
            DURATION_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_INVALID_AMOUNT);
      });

      it("The addon amount is not rounded according to the accuracy factor", async () => {
        const { marketUnderAdmin } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        const wrongAddonAmount = ADDON_AMOUNT - 1;
        expect(wrongAddonAmount % ACCURACY_FACTOR).not.to.eq(0);

        await expect(
          marketUnderAdmin.takeLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROWED_AMOUNT,
            wrongAddonAmount,
            DURATION_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_INVALID_AMOUNT);
      });

      it("The credit line is not configured for a lending program", async () => {
        const { marketUnderAdmin } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        await proveTx(
          marketUnderAdmin.setCreditLineForProgram(PROGRAM_ID, ZERO_ADDRESS) // Call via the testable version
        );

        await expect(
          marketUnderAdmin.takeLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROWED_AMOUNT,
            ADDON_AMOUNT,
            DURATION_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_PROGRAM_CREDIT_LINE_NOT_CONFIGURED);
      });

      it("The liquidity pool is not configured for a lending program", async () => {
        const { marketUnderAdmin } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        await proveTx(
          marketUnderAdmin.setLiquidityPoolForProgram(PROGRAM_ID, ZERO_ADDRESS) // Call via the testable version
        );

        await expect(
          marketUnderAdmin.takeLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROWED_AMOUNT,
            ADDON_AMOUNT,
            DURATION_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_PROGRAM_LIQUIDITY_POOL_NOT_CONFIGURED);
      });

      it("The loan ID counter is greater than the max allowed value", async () => {
        const { marketUnderAdmin } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        await proveTx(marketUnderAdmin.setLoanIdCounter(maxUintForBits(40) + 1n));

        await expect(
          marketUnderAdmin.takeLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROWED_AMOUNT,
            ADDON_AMOUNT,
            DURATION_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_LOAN_ID_EXCESS);
      });

      it("The addon treasury is NOT configured on the liquidity pool", async () => {
        const { marketUnderAdmin } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        await proveTx(liquidityPool.mockAddonTreasury(ZERO_ADDRESS));

        await expect(
          marketUnderAdmin.takeLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROWED_AMOUNT,
            ADDON_AMOUNT,
            DURATION_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_ADDON_TREASURY_ADDRESS_ZERO);
      });
    });
  });

  describe("Function 'takeInstallmentLoanFor()'", async () => {
    before(async () => {
      const totalBorrowedAmount = BORROWED_AMOUNTS.reduce((sum, amount) => sum + amount);
      const totalAddonAmount = ADDON_AMOUNTS.reduce((sum, amount) => sum + amount);

      // Check rounding of amounts
      expect(totalBorrowedAmount % ACCURACY_FACTOR).to.eq(0, `totalBorrowedAmount is unrounded, but must be`);
      expect(totalAddonAmount % ACCURACY_FACTOR).to.eq(0, `totalAddonAmount is unrounded, but must be`);
      for (let i = 0; i < INSTALLMENT_COUNT; ++i) {
        expect(BORROWED_AMOUNTS[i] % ACCURACY_FACTOR).not.to.eq(0, `borrowedAmounts[${i}] is rounded, but must not be`);
        expect(ADDON_AMOUNTS[i] % ACCURACY_FACTOR).not.to.eq(0, `addonAmounts[${i}] is rounded, but must not be`);
      }
    });

    async function executeAndCheck(props: {
      installmentCount: number;
      areAddonAmountsZero: boolean;
    }) {
      const { marketUnderAdmin } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
      const { installmentCount, areAddonAmountsZero } = props;

      expect(installmentCount).not.greaterThan(INSTALLMENT_COUNT);

      const expectedLoanIds = Array.from({ length: installmentCount }, (_, i) => i);
      const borrowedAmounts = BORROWED_AMOUNTS.slice(0, installmentCount);
      const addonAmounts = ADDON_AMOUNTS.slice(0, installmentCount);
      const durationsInPeriods = DURATIONS_IN_PERIODS.slice(0, installmentCount);

      if (installmentCount > 2) {
        addonAmounts[1] = 0; // An addon amount can be zero
        addonAmounts[2] += 1; // Fix total addon amount rounding
      }
      if (installmentCount == 1) {
        borrowedAmounts[0] = BORROWED_AMOUNT;
        addonAmounts[0] = ADDON_AMOUNT;
      }
      if (areAddonAmountsZero) {
        addonAmounts.fill(0);
      }
      const expectedLoanIdRange = [BigInt(expectedLoanIds[0]), BigInt(expectedLoanIds.length)];
      const totalBorrowedAmount = borrowedAmounts.reduce((sum, amount) => sum + amount);
      const totalAddonAmount = addonAmounts.reduce((sum, amount) => sum + amount);
      const principalAmounts: number[] = borrowedAmounts.map((amount, i) => amount + addonAmounts[i]);
      const totalPrincipal = principalAmounts.reduce((sum, amount) => sum + amount);

      // Check rounding of amounts
      expect(totalBorrowedAmount % ACCURACY_FACTOR).to.eq(0, `totalBorrowedAmount is unrounded, but must be`);
      expect(totalAddonAmount % ACCURACY_FACTOR).to.eq(0, `totalAddonAmount is unrounded, but must be`);

      // Check the returned value of the function
      const actualLoanIdRange: bigint[] = await marketUnderAdmin.takeInstallmentLoanFor.staticCall(
        borrower.address,
        PROGRAM_ID,
        borrowedAmounts,
        addonAmounts,
        durationsInPeriods
      );
      expect(actualLoanIdRange).to.deep.eq(expectedLoanIdRange);

      const tx: Promise<TransactionResponse> = marketUnderAdmin.takeInstallmentLoanFor(
        borrower.address,
        PROGRAM_ID,
        borrowedAmounts,
        addonAmounts,
        durationsInPeriods
      );
      const timestamp = await getTxTimestamp(tx);
      const actualLoanStates: LoanState[] = await getLoanStates(marketUnderAdmin, expectedLoanIds);
      const expectedLoans: Loan[] = createInstallmentLoanParts({
        firstInstallmentId: expectedLoanIds[0],
        borrowedAmounts,
        addonAmounts,
        durations: durationsInPeriods,
        lateFeeAmount: LATE_FEE_AMOUNT,
        timestamp
      });

      for (let i = 0; i < installmentCount; ++i) {
        checkEquality(actualLoanStates[i], expectedLoans[i].state, i);
        await expect(tx)
          .to.emit(marketUnderAdmin, EVENT_NAME_LOAN_TAKEN)
          .withArgs(expectedLoanIds[i], borrower.address, principalAmounts[i], durationsInPeriods[i]);

        // Check that the appropriate market hook functions are called
        await expect(tx).to.emit(liquidityPool, EVENT_NAME_ON_BEFORE_LOAN_TAKEN).withArgs(expectedLoanIds[i]);
        await expect(tx).to.emit(creditLine, EVENT_NAME_ON_BEFORE_LOAN_TAKEN).withArgs(expectedLoanIds[i]);
      }
      await expect(tx)
        .to.emit(marketUnderAdmin, EVENT_NAME_INSTALLMENT_LOAN_TAKEN)
        .withArgs(
          expectedLoanIds[0],
          borrower.address,
          PROGRAM_ID,
          installmentCount,
          totalBorrowedAmount,
          totalAddonAmount
        );
      expect(await marketUnderAdmin.loanCounter()).to.eq(expectedLoanIds[installmentCount - 1] + 1);

      await expect(tx).to.changeTokenBalances(
        token,
        [liquidityPool, borrower, addonTreasury, marketUnderAdmin],
        [-totalPrincipal, +totalBorrowedAmount, +totalAddonAmount, 0]
      );
      if (totalAddonAmount != 0) {
        expect(await getNumberOfEvents(tx, token, EVENT_NAME_TRANSFER)).to.eq(2);
      } else {
        expect(await getNumberOfEvents(tx, token, EVENT_NAME_TRANSFER)).to.eq(1);
      }

      // Check the returned value of the function for the second loan
      const nextActualLoanId: bigint = await marketUnderAdmin.takeLoanFor.staticCall(
        borrower.address,
        PROGRAM_ID,
        BORROWED_AMOUNT,
        ADDON_AMOUNT,
        DURATION_IN_PERIODS
      );
      expect(nextActualLoanId).to.eq(expectedLoanIds[installmentCount - 1] + 1);
    }

    describe("Executes as expected and emits the correct events if", async () => {
      it("The loan has multiple installments and NOT all addon amounts are zero", async () => {
        await executeAndCheck({ installmentCount: INSTALLMENT_COUNT, areAddonAmountsZero: false });
      });

      it("The loan has multiple installments and all addon amounts are zero", async () => {
        await executeAndCheck({ installmentCount: INSTALLMENT_COUNT, areAddonAmountsZero: true });
      });

      it("The loan has only one installment and the addon amount is NOT zero", async () => {
        await executeAndCheck({ installmentCount: 1, areAddonAmountsZero: false });
      });
    });

    describe("Is reverted if", async () => {
      it("The contract is paused", async () => {
        const { market, marketUnderAdmin } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        await proveTx(market.pause());

        await expect(
          marketUnderAdmin.takeInstallmentLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROWED_AMOUNTS,
            ADDON_AMOUNTS,
            DURATIONS_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_ENFORCED_PAUSED);
      });

      it("The caller does not have the admin role", async () => {
        const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);

        await expect(
          connect(market, owner).takeInstallmentLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROWED_AMOUNTS,
            ADDON_AMOUNTS,
            DURATIONS_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(
          market,
          ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED
        ).withArgs(owner.address, ADMIN_ROLE);

        await expect(
          connect(market, borrower).takeInstallmentLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROWED_AMOUNTS,
            ADDON_AMOUNTS,
            DURATIONS_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(
          market,
          ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED
        ).withArgs(borrower.address, ADMIN_ROLE);
      });

      it("The borrower address is zero", async () => {
        const { marketUnderAdmin } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        const wrongBorrowerAddress = (ZERO_ADDRESS);

        await expect(
          marketUnderAdmin.takeInstallmentLoanFor(
            wrongBorrowerAddress,
            PROGRAM_ID,
            BORROWED_AMOUNTS,
            ADDON_AMOUNTS,
            DURATIONS_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_ZERO_ADDRESS);
      });

      it("The program ID is zero", async () => {
        const { marketUnderAdmin } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        const wrongProgramId = 0;

        await expect(
          marketUnderAdmin.takeInstallmentLoanFor(
            borrower.address,
            wrongProgramId,
            BORROWED_AMOUNTS,
            ADDON_AMOUNTS,
            DURATIONS_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_PROGRAM_NOT_EXIST);
      });

      it("The input borrowed amount array is empty", async () => {
        const { marketUnderAdmin } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        const wrongBorrowedAmounts: number[] = [];

        await expect(
          marketUnderAdmin.takeInstallmentLoanFor(
            borrower.address,
            PROGRAM_ID,
            wrongBorrowedAmounts,
            ADDON_AMOUNTS,
            DURATIONS_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_INVALID_AMOUNT);
      });

      it("One of the borrowed amount values is zero", async () => {
        const { marketUnderAdmin } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        const wrongBorrowedAmounts = [...BORROWED_AMOUNTS];
        wrongBorrowedAmounts[INSTALLMENT_COUNT - 1] = 0;

        await expect(
          marketUnderAdmin.takeInstallmentLoanFor(
            borrower.address,
            PROGRAM_ID,
            wrongBorrowedAmounts,
            ADDON_AMOUNTS,
            DURATIONS_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_INVALID_AMOUNT);
      });

      it("The total borrowed amount is not rounded according to the accuracy factor", async () => {
        const { marketUnderAdmin } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        const wrongBorrowedAmounts = [...BORROWED_AMOUNTS];
        wrongBorrowedAmounts[INSTALLMENT_COUNT - 1] += 1;

        await expect(
          marketUnderAdmin.takeInstallmentLoanFor(
            borrower.address,
            PROGRAM_ID,
            wrongBorrowedAmounts,
            ADDON_AMOUNTS,
            DURATIONS_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_INVALID_AMOUNT);
      });

      it("The total addon amount is not rounded according to the accuracy factor", async () => {
        const { marketUnderAdmin } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        const wrongAddonAmounts = [...ADDON_AMOUNTS];
        wrongAddonAmounts[INSTALLMENT_COUNT - 1] += 1;

        await expect(
          marketUnderAdmin.takeInstallmentLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROWED_AMOUNTS,
            wrongAddonAmounts,
            DURATIONS_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_INVALID_AMOUNT);
      });

      it("The durations in the input array do not correspond to a non-decreasing sequence", async () => {
        const { marketUnderAdmin } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        const wrongDurations = [...DURATIONS_IN_PERIODS];
        wrongDurations[INSTALLMENT_COUNT - 1] = wrongDurations[INSTALLMENT_COUNT - 2] - 1;

        await expect(
          marketUnderAdmin.takeInstallmentLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROWED_AMOUNTS,
            ADDON_AMOUNTS,
            wrongDurations
          )
        ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_DURATION_ARRAY_INVALID);
      });

      it("The number of installments is greater than the max allowed value", async () => {
        const { marketUnderAdmin } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        await proveTx(marketUnderAdmin.setInstallmentCountMax(INSTALLMENT_COUNT - 1));

        await expect(
          marketUnderAdmin.takeInstallmentLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROWED_AMOUNTS,
            ADDON_AMOUNTS,
            DURATIONS_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_INSTALLMENT_COUNT_EXCESS);
      });

      it("The length of input arrays mismatches", async () => {
        const { marketUnderAdmin } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        const wrongAddonAmounts = [...ADDON_AMOUNTS, 0];
        const wrongDurations = [...DURATIONS_IN_PERIODS, DURATIONS_IN_PERIODS[INSTALLMENT_COUNT - 1] + 1];

        await expect(
          marketUnderAdmin.takeInstallmentLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROWED_AMOUNTS,
            wrongAddonAmounts,
            DURATIONS_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_ARRAY_LENGTH_MISMATCH);

        await expect(
          marketUnderAdmin.takeInstallmentLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROWED_AMOUNTS,
            ADDON_AMOUNTS,
            wrongDurations
          )
        ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_ARRAY_LENGTH_MISMATCH);
      });

      it("The credit line is not configured for a lending program", async () => {
        const { marketUnderAdmin } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        await proveTx(
          marketUnderAdmin.setCreditLineForProgram(PROGRAM_ID, ZERO_ADDRESS) // Call via the testable version
        );

        await expect(
          marketUnderAdmin.takeInstallmentLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROWED_AMOUNTS,
            ADDON_AMOUNTS,
            DURATIONS_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_PROGRAM_CREDIT_LINE_NOT_CONFIGURED);
      });

      it("The liquidity pool is not configured for a lending program", async () => {
        const { marketUnderAdmin } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        await proveTx(
          marketUnderAdmin.setLiquidityPoolForProgram(PROGRAM_ID, ZERO_ADDRESS) // Call via the testable version
        );

        await expect(
          marketUnderAdmin.takeInstallmentLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROWED_AMOUNTS,
            ADDON_AMOUNTS,
            DURATIONS_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_PROGRAM_LIQUIDITY_POOL_NOT_CONFIGURED);
      });

      it("The loan ID counter is greater than the max allowed value", async () => {
        const { marketUnderAdmin } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        await proveTx(marketUnderAdmin.setLoanIdCounter(maxUintForBits(40) + 2n - BigInt(INSTALLMENT_COUNT)));

        await expect(
          marketUnderAdmin.takeInstallmentLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROWED_AMOUNTS,
            ADDON_AMOUNTS,
            DURATIONS_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_LOAN_ID_EXCESS);
      });

      it("The addon treasury is NOT configured on the liquidity pool", async () => {
        const { marketUnderAdmin } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
        await proveTx(liquidityPool.mockAddonTreasury(ZERO_ADDRESS));

        await expect(
          marketUnderAdmin.takeInstallmentLoanFor(
            borrower.address,
            PROGRAM_ID,
            BORROWED_AMOUNTS,
            ADDON_AMOUNTS,
            DURATIONS_IN_PERIODS
          )
        ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_ADDON_TREASURY_ADDRESS_ZERO);
      });
    });
  });

  describe("Function 'repayLoan()'", async () => {
    async function repayLoanAndCheck(
      fixture: Fixture,
      loans: Loan,
      repaymentAmount: number | bigint,
      payerKind: PayerKind
    ): Promise<Loan> {
      const expectedLoan: Loan = clone(loans);
      const { market } = fixture;
      let tx: Promise<TransactionResponse>;
      let payer: HardhatEthersSigner;
      switch (payerKind) {
        case PayerKind.Borrower:
          tx = connect(market, borrower).repayLoan(expectedLoan.id, repaymentAmount);
          payer = borrower;
          break;
        default:
          tx = connect(market, stranger).repayLoan(expectedLoan.id, repaymentAmount);
          payer = stranger;
      }
      const repaidAmountBefore = expectedLoan.state.repaidAmount;
      processRepayment(expectedLoan, { repaymentAmount, repaymentTimestamp: await getTxTimestamp(tx) });
      repaymentAmount = expectedLoan.state.repaidAmount - repaidAmountBefore;

      const actualLoanStateAfterRepayment = await market.getLoanState(expectedLoan.id);
      checkEquality(actualLoanStateAfterRepayment, expectedLoan.state);

      await expect(tx).to.changeTokenBalances(
        token,
        [liquidityPool, payer, market],
        [+repaymentAmount, -repaymentAmount, 0]
      );

      await expect(tx).to.emit(market, EVENT_NAME_LOAN_REPAYMENT).withArgs(
        expectedLoan.id,
        payer.address,
        borrower.address,
        repaymentAmount,
        expectedLoan.state.trackedBalance
      );

      // Check that the appropriate market hook functions are called
      await expect(tx)
        .to.emit(liquidityPool, EVENT_NAME_ON_AFTER_LOAN_PAYMENT)
        .withArgs(expectedLoan.id, repaymentAmount);
      await expect(tx)
        .to.emit(creditLine, EVENT_NAME_ON_AFTER_LOAN_PAYMENT)
        .withArgs(expectedLoan.id, repaymentAmount);

      return expectedLoan;
    }

    describe("Executes as expected if", async () => {
      it("There is a partial repayment from the borrower on the same period the loan is taken", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        await repayLoanAndCheck(fixture, fixture.ordinaryLoan, REPAYMENT_AMOUNT, PayerKind.Borrower);
      });

      it("There is a partial repayment from a stranger before the loan is defaulted", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const periodIndex = fixture.ordinaryLoan.startPeriod + fixture.ordinaryLoan.state.durationInPeriods / 2;
        await increaseBlockTimestampToPeriodIndex(periodIndex);
        await repayLoanAndCheck(fixture, fixture.ordinaryLoan, REPAYMENT_AMOUNT, PayerKind.Stranger);
      });

      it("There is a partial repayment from a borrower after the loan is defaulted", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const periodIndex = fixture.ordinaryLoan.startPeriod + fixture.ordinaryLoan.state.durationInPeriods + 1;
        await increaseBlockTimestampToPeriodIndex(periodIndex);
        await repayLoanAndCheck(fixture, fixture.ordinaryLoan, REPAYMENT_AMOUNT, PayerKind.Borrower);
      });

      it("There is a partial repayment from the borrower at the due date and another one a day after", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const periodIndex = fixture.ordinaryLoan.startPeriod + fixture.ordinaryLoan.state.durationInPeriods;
        await increaseBlockTimestampToPeriodIndex(periodIndex);
        let loan = fixture.ordinaryLoan;
        loan = await repayLoanAndCheck(fixture, loan, REPAYMENT_AMOUNT, PayerKind.Borrower);
        await increaseBlockTimestampToPeriodIndex(periodIndex + 1);
        await repayLoanAndCheck(fixture, loan, REPAYMENT_AMOUNT, PayerKind.Borrower);
      });

      it("There is a full repayment through the amount matches the outstanding balance", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const futureTimestamp = await increaseBlockTimestampToPeriodIndex(fixture.ordinaryLoan.startPeriod + 1);
        const loanPreview: LoanPreview = determineLoanPreview(fixture.ordinaryLoan, futureTimestamp);
        const repaymentAmount = loanPreview.outstandingBalance;
        await repayLoanAndCheck(fixture, fixture.ordinaryLoan, repaymentAmount, PayerKind.Borrower);
      });

      it("There is a full repayment through the amount equals max uint256 value", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        await increaseBlockTimestampToPeriodIndex(fixture.ordinaryLoan.startPeriod + 1);
        await repayLoanAndCheck(fixture, fixture.ordinaryLoan, FULL_REPAYMENT_AMOUNT, PayerKind.Borrower);
      });

      it("There is a partial repayment for a frozen loan", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loan = clone(fixture.ordinaryLoan);
        let periodIndex = loan.startPeriod + loan.state.durationInPeriods / 2;
        await increaseBlockTimestampToPeriodIndex(periodIndex);
        const tx = fixture.marketUnderAdmin.freeze(loan.id);
        loan.state.freezeTimestamp = calculateTimestampWithOffset(await getTxTimestamp(tx));
        periodIndex += loan.state.durationInPeriods;
        await increaseBlockTimestampToPeriodIndex(periodIndex);
        await repayLoanAndCheck(fixture, loan, REPAYMENT_AMOUNT, PayerKind.Stranger);
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
        const wrongRepaymentAmount = BORROWED_AMOUNT + ADDON_AMOUNT + ACCURACY_FACTOR;

        await expect(market.repayLoan(loan.id, wrongRepaymentAmount))
          .to.be.revertedWithCustomError(market, ERROR_NAME_INVALID_AMOUNT);
      });
    });
  });

  describe("Function 'repayLoanForBatch()'", async () => {
    async function executeAndCheck(
      fixture: Fixture,
      loans: Loan[],
      repaymentAmounts: (number | bigint)[],
      payerKind: PayerKind
    ): Promise<Loan[]> {
      const expectedLoans: Loan[] = loans.map(loan => clone(loan));
      const loanIds: number[] = expectedLoans.map(loan => loan.id);
      const { marketUnderAdmin } = fixture;
      let payer: HardhatEthersSigner;

      switch (payerKind) {
        case PayerKind.Borrower:
          payer = borrower;
          break;
        default:
          payer = stranger;
      }
      const tx: Promise<TransactionResponse> =
        marketUnderAdmin.repayLoanForBatch(loanIds, repaymentAmounts, payer.address);

      const repaidAmountsBefore = expectedLoans.map(loan => loan.state.repaidAmount);
      const repaymentTimestamp = await getTxTimestamp(tx);
      const expectedRepaymentAmounts: number[] = [];
      for (let i = 0; i < expectedLoans.length; ++i) {
        const expectedLoan = expectedLoans[i];
        processRepayment(expectedLoan, { repaymentAmount: repaymentAmounts[i], repaymentTimestamp });
        const expectedRepaymentAmount = expectedLoan.state.repaidAmount - repaidAmountsBefore[i];
        const actualLoanStateAfterRepayment = await marketUnderAdmin.getLoanState(expectedLoan.id);
        checkEquality(actualLoanStateAfterRepayment, expectedLoan.state);

        await expect(tx).to.emit(marketUnderAdmin, EVENT_NAME_LOAN_REPAYMENT).withArgs(
          expectedLoan.id,
          payer.address,
          borrower.address,
          expectedRepaymentAmount,
          expectedLoan.state.trackedBalance
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
        [liquidityPool, payer, marketUnderAdmin],
        [totalRepaymentAmount, -totalRepaymentAmount, 0]
      );

      return expectedLoans;
    }

    describe("Executes as expected if", async () => {
      it("There are partial repayments from the borrower on the same period the loan is taken", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loans: Loan[] = [
          fixture.ordinaryLoan,
          fixture.installmentLoanParts[fixture.installmentLoanParts.length - 1]
        ];
        const repaymentAmounts = [REPAYMENT_AMOUNT, REPAYMENT_AMOUNT / 2];
        await executeAndCheck(fixture, loans, repaymentAmounts, PayerKind.Borrower);
      });

      it("There are partial repayments from a stranger before the loan is defaulted", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loans: Loan[] = [
          fixture.ordinaryLoan,
          fixture.installmentLoanParts[fixture.installmentLoanParts.length - 1]
        ];
        const repaymentAmounts = [REPAYMENT_AMOUNT, REPAYMENT_AMOUNT / 2];
        const periodIndex = loans[0].startPeriod + loans[0].state.durationInPeriods / 2;
        await increaseBlockTimestampToPeriodIndex(periodIndex);
        await executeAndCheck(fixture, loans, repaymentAmounts, PayerKind.Stranger);
      });

      it("There are partial repayment from the borrower at the due date and another one a day after", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        let loans: Loan[] = [
          fixture.ordinaryLoan,
          fixture.installmentLoanParts[fixture.installmentLoanParts.length - 1]
        ];
        const periodIndex = loans[0].startPeriod + loans[0].state.durationInPeriods;
        await increaseBlockTimestampToPeriodIndex(periodIndex);
        const repaymentAmounts = [REPAYMENT_AMOUNT, REPAYMENT_AMOUNT / 2];
        loans = await executeAndCheck(fixture, loans, repaymentAmounts, PayerKind.Borrower);
        await increaseBlockTimestampToPeriodIndex(periodIndex + 1);
        await executeAndCheck(fixture, loans, repaymentAmounts, PayerKind.Borrower);
      });

      it("There is a full repayment through the amount matches the outstanding balance", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loans: Loan[] = [
          fixture.ordinaryLoan,
          fixture.installmentLoanParts[fixture.installmentLoanParts.length - 1]
        ];
        const futureTimestamp = await increaseBlockTimestampToPeriodIndex(loans[0].startPeriod + 1);
        const loanPreview: LoanPreview = determineLoanPreview(fixture.ordinaryLoan, futureTimestamp);
        const repaymentAmounts = [loanPreview.outstandingBalance, REPAYMENT_AMOUNT];
        await executeAndCheck(fixture, loans, repaymentAmounts, PayerKind.Borrower);
      });

      it("There is a full repayment through the amount equals max uint256 value", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loans: Loan[] = [
          fixture.ordinaryLoan,
          fixture.installmentLoanParts[fixture.installmentLoanParts.length - 1]
        ];
        const repaymentAmounts = [REPAYMENT_AMOUNT, FULL_REPAYMENT_AMOUNT];
        await increaseBlockTimestampToPeriodIndex(loans[1].startPeriod + 3);
        await executeAndCheck(fixture, loans, repaymentAmounts, PayerKind.Borrower);
      });

      it("There is a partial repayment for a frozen loan", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loans: Loan[] = [
          fixture.ordinaryLoan,
          clone(fixture.installmentLoanParts[fixture.installmentLoanParts.length - 1])
        ];
        const repaymentAmounts = [REPAYMENT_AMOUNT, REPAYMENT_AMOUNT / 2];
        let periodIndex = loans[1].startPeriod + 1;
        await increaseBlockTimestampToPeriodIndex(periodIndex);
        const tx = fixture.marketUnderAdmin.freeze(loans[1].id);
        loans[1].state.freezeTimestamp = calculateTimestampWithOffset(await getTxTimestamp(tx));
        periodIndex += Math.round(loans[1].state.durationInPeriods / 2);
        await increaseBlockTimestampToPeriodIndex(periodIndex);
        await executeAndCheck(fixture, loans, repaymentAmounts, PayerKind.Borrower);
      });

      it("There are empty input arrays", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loans: Loan[] = [];
        const repaymentAmounts: number[] = [];
        await increaseBlockTimestampToPeriodIndex(fixture.installmentLoanParts[0].startPeriod + 3);
        await executeAndCheck(fixture, loans, repaymentAmounts, PayerKind.Borrower);
      });
    });

    describe("Is reverted if", async () => {
      it("The contract is paused", async () => {
        const { market, marketUnderAdmin } = await setUpFixture(deployLendingMarketAndTakeLoans);
        await proveTx(market.pause());

        await expect(marketUnderAdmin.repayLoanForBatch([], [], borrower.address))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
      });

      it("The caller does not have the admin role", async () => {
        const { market, installmentLoanParts: loans } = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loanIds = loans.map(loan => loan.id);
        const repaymentAmounts: number[] = Array(loans.length).fill(REPAYMENT_AMOUNT);

        await expect(connect(market, owner).repayLoanForBatch(loanIds, repaymentAmounts, borrower.address))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
          .withArgs(owner.address, ADMIN_ROLE);
        await expect(connect(market, borrower).repayLoanForBatch(loanIds, repaymentAmounts, borrower.address))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
          .withArgs(borrower.address, ADMIN_ROLE);
        await expect(connect(market, stranger).repayLoanForBatch(loanIds, repaymentAmounts, borrower.address))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
          .withArgs(stranger.address, ADMIN_ROLE);
      });

      it("The length of the input arrays does not match", async () => {
        const { marketUnderAdmin, installmentLoanParts: loans } = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loanIds = loans.map(loan => loan.id);
        const repaymentAmounts: number[] = Array(loans.length).fill(REPAYMENT_AMOUNT);

        await expect(marketUnderAdmin.repayLoanForBatch(
          [...loanIds, loanIds[0]],
          repaymentAmounts,
          borrower.address
        )).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_ARRAY_LENGTH_MISMATCH);

        await expect(marketUnderAdmin.repayLoanForBatch(
          loanIds,
          [...repaymentAmounts, REPAYMENT_AMOUNT],
          borrower.address
        )).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_ARRAY_LENGTH_MISMATCH);

        await expect(marketUnderAdmin.repayLoanForBatch(
          loanIds,
          [],
          borrower.address
        )).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_ARRAY_LENGTH_MISMATCH);

        await expect(marketUnderAdmin.repayLoanForBatch(
          [],
          repaymentAmounts,
          borrower.address
        )).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_ARRAY_LENGTH_MISMATCH);
      });

      it("The provided repayer address is zero", async () => {
        const { marketUnderAdmin, installmentLoanParts: loans } = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loanIds = loans.map(loan => loan.id);
        const repaymentAmounts: number[] = Array(loans.length).fill(REPAYMENT_AMOUNT);
        const repayerAddress = (ZERO_ADDRESS);

        await expect(
          marketUnderAdmin.repayLoanForBatch(loanIds, repaymentAmounts, repayerAddress)
        ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_ZERO_ADDRESS);
      });

      it("One of the loans does not exist", async () => {
        const { marketUnderAdmin, installmentLoanParts: loans } = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loanIds = loans.map(loan => loan.id);
        const repaymentAmounts: number[] = Array(loans.length).fill(REPAYMENT_AMOUNT);
        loanIds[loanIds.length - 1] += 123;

        await expect(
          marketUnderAdmin.repayLoanForBatch(loanIds, repaymentAmounts, borrower.address)
        ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_LOAN_NOT_EXIST);
      });

      it("One of the loans is already repaid", async () => {
        const { marketUnderAdmin, installmentLoanParts: loans } = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loanIds = loans.map(loan => loan.id);
        const repaymentAmounts: number[] = Array(loans.length).fill(REPAYMENT_AMOUNT);
        await proveTx(marketUnderAdmin.repayLoanForBatch(
          [loanIds[loanIds.length - 1]],
          [FULL_REPAYMENT_AMOUNT],
          borrower.address
        ));

        await expect(marketUnderAdmin.repayLoanForBatch(loanIds, repaymentAmounts, borrower.address))
          .to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_LOAN_ALREADY_REPAID);
      });

      it("One of the repayment amounts is zero", async () => {
        const { marketUnderAdmin, installmentLoanParts: loans } = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loanIds = loans.map(loan => loan.id);
        const repaymentAmounts: number[] = Array(loans.length).fill(REPAYMENT_AMOUNT);
        repaymentAmounts[loans.length - 1] = 0;

        await expect(marketUnderAdmin.repayLoanForBatch(loanIds, repaymentAmounts, borrower.address))
          .to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_INVALID_AMOUNT);
      });

      it("One of the repayment amounts is not rounded according to the accuracy factor", async () => {
        const { marketUnderAdmin, installmentLoanParts: loans } = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loanIds = loans.map(loan => loan.id);
        const repaymentAmounts: number[] = Array(loans.length).fill(REPAYMENT_AMOUNT);
        repaymentAmounts[loans.length - 1] = REPAYMENT_AMOUNT - 1;

        await expect(marketUnderAdmin.repayLoanForBatch(loanIds, repaymentAmounts, borrower.address))
          .to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_INVALID_AMOUNT);
      });

      it("One of the repayment amounts is bigger than outstanding balance", async () => {
        const { marketUnderAdmin, installmentLoanParts: loans } = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loanIds = loans.map(loan => loan.id);
        const repaymentAmounts: number[] = Array(loans.length).fill(REPAYMENT_AMOUNT);
        const lastLoan = loans[loans.length - 1];
        repaymentAmounts[loans.length - 1] =
          roundSpecific(lastLoan.state.borrowedAmount + lastLoan.state.addonAmount) + ACCURACY_FACTOR;

        await expect(marketUnderAdmin.repayLoanForBatch(loanIds, repaymentAmounts, borrower.address))
          .to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_INVALID_AMOUNT);
      });
    });
  });

  describe("Function 'discountLoanForBatch()'", () => {
    async function executeAndCheck(
      fixture: Fixture,
      loans: Loan[],
      discountAmounts: (number | bigint)[]
    ): Promise<Loan[]> {
      const expectedLoans: Loan[] = loans.map(loan => clone(loan));
      const loanIds: number[] = expectedLoans.map(loan => loan.id);
      const { marketUnderAdmin } = fixture;

      const discountAmountsBefore = expectedLoans.map(loan => loan.state.discountAmount);

      const tx = marketUnderAdmin.discountLoanForBatch(loanIds, discountAmounts);
      const discountTimestamp = await getTxTimestamp(tx);

      for (let i = 0; i < expectedLoans.length; ++i) {
        const expectedLoan = expectedLoans[i];
        processDiscount(expectedLoan, { discountAmount: discountAmounts[i], discountTimestamp: discountTimestamp });
        const expectedDiscountAmount = expectedLoan.state.discountAmount - discountAmountsBefore[i];
        const actualLoanStateAfterDiscount = await marketUnderAdmin.getLoanState(expectedLoan.id);
        checkEquality(actualLoanStateAfterDiscount, expectedLoan.state);

        await expect(tx).to.emit(marketUnderAdmin, EVENT_NAME_LOAN_DISCOUNTED).withArgs(
          expectedLoan.id,
          expectedDiscountAmount,
          expectedLoan.state.trackedBalance
        );
      }

      return expectedLoans;
    }

    describe("Executes as expected if", async () => {
      it("There are partial discounts on the same period the loan is taken", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loans = fixture.installmentLoanParts;
        const discountAmounts = Array(loans.length).fill(DISCOUNT_AMOUNT);

        await executeAndCheck(fixture, loans, discountAmounts);
      });

      it("There are partial discounts at the due date and another one a day after", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        let loans: Loan[] = [
          fixture.ordinaryLoan,
          fixture.installmentLoanParts[fixture.installmentLoanParts.length - 1]
        ];
        const periodIndex = loans[0].startPeriod + loans[0].state.durationInPeriods;
        await increaseBlockTimestampToPeriodIndex(periodIndex);
        const discountAmounts = [DISCOUNT_AMOUNT, DISCOUNT_AMOUNT / 2];

        loans = await executeAndCheck(fixture, loans, discountAmounts);
        await increaseBlockTimestampToPeriodIndex(periodIndex + 1);
        await executeAndCheck(fixture, loans, discountAmounts);
      });

      it("There are full discounts through the amount matches the outstanding balance", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loans = fixture.installmentLoanParts;

        const timestamp = await getLatestBlockTimestamp();
        const loanPreviews: LoanPreview[] = loans.map(loan => determineLoanPreview(loan, timestamp));
        const discountAmounts = loanPreviews.map(preview => preview.outstandingBalance);

        await executeAndCheck(fixture, loans, discountAmounts);
      });

      it("There is a full discount through the amount equals max uint256 value", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loans = fixture.installmentLoanParts;
        const discountAmounts = Array(loans.length).fill(FULL_REPAYMENT_AMOUNT);

        await executeAndCheck(fixture, loans, discountAmounts);
      });

      it("There is a partial discount for a frozen loan", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loans: Loan[] = [
          fixture.ordinaryLoan,
          clone(fixture.installmentLoanParts[fixture.installmentLoanParts.length - 1])
        ];
        const discountAmounts = [DISCOUNT_AMOUNT, DISCOUNT_AMOUNT / 2];
        let periodIndex = loans[1].startPeriod + loans[1].state.durationInPeriods / 2;
        await increaseBlockTimestampToPeriodIndex(periodIndex);
        const tx = fixture.marketUnderAdmin.freeze(loans[1].id);
        loans[1].state.freezeTimestamp = calculateTimestampWithOffset(await getTxTimestamp(tx));
        periodIndex += loans[1].state.durationInPeriods;
        await increaseBlockTimestampToPeriodIndex(periodIndex);
        await executeAndCheck(fixture, loans, discountAmounts);
      });

      it("There are empty input arrays", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        await executeAndCheck(fixture, [], []);
      });
    });

    describe("Is reverted if", () => {
      it("The contract is paused", async () => {
        const { market } = await setUpFixture(deployLendingMarketAndTakeLoans);
        await proveTx(market.pause());

        await expect(market.discountLoanForBatch([], []))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
      });

      it("The caller does not have the admin role", async () => {
        const { market, installmentLoanParts: loans } = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loanIds = loans.map(loan => loan.id);
        const discountAmounts: number[] = Array(loans.length).fill(DISCOUNT_AMOUNT);

        await expect(connect(market, owner).discountLoanForBatch(loanIds, discountAmounts))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
          .withArgs(owner.address, ADMIN_ROLE);
        await expect(connect(market, borrower).discountLoanForBatch(loanIds, discountAmounts))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
          .withArgs(borrower.address, ADMIN_ROLE);
        await expect(connect(market, stranger).discountLoanForBatch(loanIds, discountAmounts))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
          .withArgs(stranger.address, ADMIN_ROLE);
      });

      it("The length of the input arrays does not match", async () => {
        const { marketUnderAdmin, installmentLoanParts: loans } = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loanIds = loans.map(loan => loan.id);
        const discountAmounts: number[] = Array(loans.length).fill(DISCOUNT_AMOUNT);

        await expect(marketUnderAdmin.discountLoanForBatch(
          [...loanIds, loanIds[0]],
          discountAmounts
        )).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_ARRAY_LENGTH_MISMATCH);

        await expect(marketUnderAdmin.discountLoanForBatch(
          loanIds,
          [...discountAmounts, DISCOUNT_AMOUNT]
        )).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_ARRAY_LENGTH_MISMATCH);

        await expect(marketUnderAdmin.discountLoanForBatch(
          loanIds,
          []
        )).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_ARRAY_LENGTH_MISMATCH);

        await expect(marketUnderAdmin.discountLoanForBatch(
          [],
          discountAmounts
        )).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_ARRAY_LENGTH_MISMATCH);
      });

      it("One of the loans does not exist", async () => {
        const { marketUnderAdmin, installmentLoanParts: loans } = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loanIds = loans.map(loan => loan.id);
        const discountAmounts: number[] = Array(loans.length).fill(DISCOUNT_AMOUNT);
        loanIds[loans.length - 1] += 123;

        await expect(marketUnderAdmin.discountLoanForBatch(loanIds, discountAmounts))
          .to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_LOAN_NOT_EXIST);
      });

      it("One of the loans is already repaid", async () => {
        const { marketUnderAdmin, installmentLoanParts: loans } = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loanIds = loans.map(loan => loan.id);
        const discountAmounts: number[] = Array(loans.length).fill(DISCOUNT_AMOUNT);
        await proveTx(connect(marketUnderAdmin, borrower).repayLoan(loanIds[loans.length - 1], FULL_REPAYMENT_AMOUNT));

        await expect(marketUnderAdmin.discountLoanForBatch(loanIds, discountAmounts))
          .to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_LOAN_ALREADY_REPAID);
      });

      it("One of the discount amounts is zero", async () => {
        const { marketUnderAdmin, installmentLoanParts: loans } = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loanIds = loans.map(loan => loan.id);
        const discountAmounts: number[] = Array(loans.length).fill(DISCOUNT_AMOUNT);
        discountAmounts[loans.length - 1] = 0;

        await expect(marketUnderAdmin.discountLoanForBatch(loanIds, discountAmounts))
          .to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_INVALID_AMOUNT);
      });

      it("One of the discount amounts is not rounded according to the accuracy factor", async () => {
        const { marketUnderAdmin, installmentLoanParts: loans } = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loanIds = loans.map(loan => loan.id);
        const discountAmounts: number[] = Array(loans.length).fill(DISCOUNT_AMOUNT);
        discountAmounts[loans.length - 1] = DISCOUNT_AMOUNT - 1;

        await expect(marketUnderAdmin.discountLoanForBatch(loanIds, discountAmounts))
          .to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_INVALID_AMOUNT);
      });

      it("One of the discount amounts is bigger than the outstanding balance", async () => {
        const { marketUnderAdmin, installmentLoanParts: loans } = await setUpFixture(deployLendingMarketAndTakeLoans);
        const loanIds = loans.map(loan => loan.id);
        const discountAmounts: number[] = Array(loans.length).fill(DISCOUNT_AMOUNT);
        const lastLoan = loans[loans.length - 1];
        discountAmounts[loans.length - 1] =
          roundSpecific(lastLoan.state.borrowedAmount + lastLoan.state.addonAmount) + ACCURACY_FACTOR;

        await expect(marketUnderAdmin.discountLoanForBatch(loanIds, discountAmounts))
          .to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_INVALID_AMOUNT);
      });
    });
  });

  describe("Function 'freeze()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
      const { marketUnderAdmin, ordinaryLoan: loan } = fixture;
      const expectedLoan = clone(fixture.ordinaryLoan);

      const tx = marketUnderAdmin.freeze(loan.id);
      expectedLoan.state.freezeTimestamp = calculateTimestampWithOffset(await getTxTimestamp(tx));

      const actualLoanStateAfterFreezing: LoanState = await marketUnderAdmin.getLoanState(loan.id);
      await expect(tx).to.emit(marketUnderAdmin, EVENT_NAME_LOAN_FROZEN).withArgs(loan.id);
      checkEquality(actualLoanStateAfterFreezing, expectedLoan.state);
    });

    it("Is reverted if the contract is paused", async () => {
      const { market, marketUnderAdmin, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
      await proveTx(market.pause());

      await expect(marketUnderAdmin.freeze(loan.id)).to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the loan does not exist", async () => {
      const { marketUnderAdmin, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
      const wrongLoanId = loan.id + 123;

      await expect(marketUnderAdmin.freeze(wrongLoanId))
        .to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_LOAN_NOT_EXIST);
    });

    it("Is reverted if the loan is already repaid", async () => {
      const { marketUnderAdmin, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
      await proveTx(connect(marketUnderAdmin, borrower).repayLoan(loan.id, FULL_REPAYMENT_AMOUNT));

      await expect(marketUnderAdmin.freeze(loan.id))
        .to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_LOAN_ALREADY_REPAID);
    });

    it("Is reverted if the caller does not have the admin role", async () => {
      const { market, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);

      await expect(connect(market, owner).freeze(loan.id))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(owner.address, ADMIN_ROLE);
      await expect(connect(market, borrower).freeze(loan.id))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(borrower.address, ADMIN_ROLE);
      await expect(connect(market, stranger).freeze(loan.id))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(stranger.address, ADMIN_ROLE);
    });

    it("Is reverted if the loan is already frozen", async () => {
      const { marketUnderAdmin, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
      await proveTx(marketUnderAdmin.freeze(loan.id));

      await expect(marketUnderAdmin.freeze(loan.id))
        .to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_LOAN_ALREADY_FROZEN);
    });
  });

  describe("Function 'unfreeze()'", async () => {
    async function freezeUnfreezeAndCheck(fixture: Fixture, props: {
      freezingTimestamp: number;
      unfreezingTimestamp: number;
      repaymentAmountWhileFreezing: number;
    }) {
      const { marketUnderAdmin } = fixture;
      const expectedLoan = clone(fixture.ordinaryLoan);
      const { freezingTimestamp, unfreezingTimestamp, repaymentAmountWhileFreezing } = props;
      const frozenInterval = unfreezingTimestamp - freezingTimestamp;

      if (await getLatestBlockTimestamp() < freezingTimestamp) {
        await increaseBlockTimestampTo(freezingTimestamp);
      }
      let tx = marketUnderAdmin.freeze(expectedLoan.id);
      expectedLoan.state.freezeTimestamp = calculateTimestampWithOffset(await getTxTimestamp(tx));

      if (props.repaymentAmountWhileFreezing != 0) {
        await increaseBlockTimestampTo(freezingTimestamp + frozenInterval / 2);
        tx = connect(marketUnderAdmin, borrower).repayLoan(expectedLoan.id, repaymentAmountWhileFreezing);
        processRepayment(expectedLoan, {
          repaymentAmount: repaymentAmountWhileFreezing,
          repaymentTimestamp: await getTxTimestamp(tx)
        });
      }

      if (freezingTimestamp != unfreezingTimestamp) {
        await increaseBlockTimestampTo(props.unfreezingTimestamp);
      }

      tx = marketUnderAdmin.unfreeze(expectedLoan.id);
      processRepayment(expectedLoan, { repaymentAmount: 0, repaymentTimestamp: await getTxTimestamp(tx) });
      expectedLoan.state.durationInPeriods +=
        calculatePeriodIndex(calculateTimestampWithOffset(unfreezingTimestamp)) -
        calculatePeriodIndex(calculateTimestampWithOffset(freezingTimestamp));
      expectedLoan.state.freezeTimestamp = 0;

      await expect(tx).to.emit(marketUnderAdmin, EVENT_NAME_LOAN_UNFROZEN).withArgs(expectedLoan.id);
      const actualLoanState: LoanState = await marketUnderAdmin.getLoanState(expectedLoan.id);
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

        await expect(connect(market, admin).unfreeze(loan.id))
          .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_ALREADY_REPAID);
      });

      it("The caller does not have the admin role", async () => {
        const { market, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);

        await expect(connect(market, owner).unfreeze(loan.id))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
          .withArgs(owner.address, ADMIN_ROLE);
        await expect(connect(market, borrower).unfreeze(loan.id))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
          .withArgs(borrower.address, ADMIN_ROLE);
        await expect(connect(market, stranger).unfreeze(loan.id))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
          .withArgs(stranger.address, ADMIN_ROLE);
      });

      it("The loan is not frozen", async () => {
        const { marketUnderAdmin, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);

        await expect(marketUnderAdmin.unfreeze(loan.id))
          .to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_LOAN_NOT_FROZEN);
      });
    });
  });

  describe("Function 'updateLoanDuration()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { marketUnderAdmin, ordinaryLoan } = await setUpFixture(deployLendingMarketAndTakeLoans);
      const expectedLoan: Loan = clone(ordinaryLoan);
      const newDuration = expectedLoan.state.durationInPeriods + 1;
      expectedLoan.state.durationInPeriods = newDuration;

      await expect(marketUnderAdmin.updateLoanDuration(expectedLoan.id, newDuration))
        .to.emit(marketUnderAdmin, EVENT_NAME_LOAN_DURATION_UPDATED)
        .withArgs(expectedLoan.id, newDuration, DURATION_IN_PERIODS);
      const actualLoanState = await marketUnderAdmin.getLoanState(expectedLoan.id);
      checkEquality(actualLoanState, expectedLoan.state);
    });

    it("Is reverted if the contract is paused", async () => {
      const { market, marketUnderAdmin, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
      await proveTx(market.pause());

      await expect(marketUnderAdmin.updateLoanDuration(loan.id, DURATION_IN_PERIODS))
        .to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the loan does not exist", async () => {
      const { marketUnderAdmin, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
      const wrongLoanId = loan.id + 123;

      await expect(marketUnderAdmin.updateLoanDuration(wrongLoanId, DURATION_IN_PERIODS))
        .to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_LOAN_NOT_EXIST);
    });

    it("Is reverted if the loan is already repaid", async () => {
      const { marketUnderAdmin, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
      await proveTx(connect(marketUnderAdmin, borrower).repayLoan(loan.id, FULL_REPAYMENT_AMOUNT));

      await expect(marketUnderAdmin.updateLoanDuration(loan.id, DURATION_IN_PERIODS))
        .to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_LOAN_ALREADY_REPAID);
    });

    it("Is reverted if the caller does not have the admin role", async () => {
      const { market, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);

      await expect(connect(market, owner).updateLoanDuration(loan.id, DURATION_IN_PERIODS))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(owner.address, ADMIN_ROLE);
      await expect(connect(market, borrower).updateLoanDuration(loan.id, DURATION_IN_PERIODS))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(borrower.address, ADMIN_ROLE);
      await expect(connect(market, stranger).updateLoanDuration(loan.id, DURATION_IN_PERIODS))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(stranger.address, ADMIN_ROLE);
    });

    it("Is reverted if the new duration is the same as the previous one or less", async () => {
      const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
      const { marketUnderAdmin, ordinaryLoan: loan } = fixture;
      let newDuration = fixture.ordinaryLoan.state.durationInPeriods;

      await expect(
        marketUnderAdmin.updateLoanDuration(loan.id, newDuration)
      ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_INAPPROPRIATE_DURATION_IN_PERIODS);

      newDuration -= 1;
      await expect(
        marketUnderAdmin.updateLoanDuration(loan.id, newDuration)
      ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_INAPPROPRIATE_DURATION_IN_PERIODS);
    });

    it("Is reverted if the new duration is greater than 32-bit unsigned integer", async () => {
      const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
      const { marketUnderAdmin, ordinaryLoan: loan } = fixture;
      const newDuration = maxUintForBits(32) + 1n;

      await expect(marketUnderAdmin.updateLoanDuration(loan.id, newDuration))
        .to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST)
        .withArgs(32, newDuration);
    });
  });

  describe("Function 'updateLoanInterestRatePrimary()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { marketUnderAdmin, ordinaryLoan } = await setUpFixture(deployLendingMarketAndTakeLoans);
      const expectedLoan = clone(ordinaryLoan);
      const oldInterestRate = expectedLoan.state.interestRatePrimary;
      const newInterestRate = oldInterestRate - 1;
      expectedLoan.state.interestRatePrimary = newInterestRate;

      await expect(marketUnderAdmin.updateLoanInterestRatePrimary(expectedLoan.id, newInterestRate))
        .to.emit(marketUnderAdmin, EVENT_NAME_LOAN_INTEREST_RATE_PRIMARY_UPDATED)
        .withArgs(expectedLoan.id, newInterestRate, oldInterestRate);
      const actualLoanState = await marketUnderAdmin.getLoanState(expectedLoan.id);
      checkEquality(actualLoanState, expectedLoan.state);
    });

    it("Is reverted if the contract is paused", async () => {
      const { market, marketUnderAdmin, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
      await proveTx(market.pause());

      await expect(
        marketUnderAdmin.updateLoanInterestRatePrimary(loan.id, INTEREST_RATE_PRIMARY)
      ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the loan does not exist", async () => {
      const { marketUnderAdmin, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
      const wrongLoanId = loan.id + 123;

      await expect(
        marketUnderAdmin.updateLoanInterestRatePrimary(wrongLoanId, INTEREST_RATE_PRIMARY)
      ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_LOAN_NOT_EXIST);
    });

    it("Is reverted if the loan is already repaid", async () => {
      const { marketUnderAdmin, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
      await proveTx(connect(marketUnderAdmin, borrower).repayLoan(loan.id, FULL_REPAYMENT_AMOUNT));

      await expect(
        marketUnderAdmin.updateLoanInterestRatePrimary(loan.id, INTEREST_RATE_PRIMARY)
      ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_LOAN_ALREADY_REPAID);
    });

    it("Is reverted if the caller does not have the admin role", async () => {
      const { market, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);

      await expect(connect(market, owner).updateLoanInterestRatePrimary(loan.id, INTEREST_RATE_PRIMARY))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(owner.address, ADMIN_ROLE);
      await expect(connect(market, borrower).updateLoanInterestRatePrimary(loan.id, INTEREST_RATE_PRIMARY))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(borrower.address, ADMIN_ROLE);
      await expect(connect(market, stranger).updateLoanInterestRatePrimary(loan.id, INTEREST_RATE_PRIMARY))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(stranger.address, ADMIN_ROLE);
    });

    it("Is reverted if the new interest rate is the same as the previous one or greater", async () => {
      const { marketUnderAdmin, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
      let newInterestRate = loan.state.interestRatePrimary;

      await expect(
        marketUnderAdmin.updateLoanInterestRatePrimary(loan.id, newInterestRate)
      ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_INAPPROPRIATE_INTEREST_RATE);

      newInterestRate += 1;
      await expect(
        marketUnderAdmin.updateLoanInterestRatePrimary(loan.id, newInterestRate + 1)
      ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_INAPPROPRIATE_INTEREST_RATE);
    });
  });

  describe("Function 'updateLoanInterestRateSecondary()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { marketUnderAdmin, ordinaryLoan } = await setUpFixture(deployLendingMarketAndTakeLoans);
      const expectedLoan = clone(ordinaryLoan);
      const oldInterestRate = expectedLoan.state.interestRateSecondary;
      const newInterestRate = oldInterestRate - 1;
      expectedLoan.state.interestRateSecondary = newInterestRate;

      await expect(marketUnderAdmin.updateLoanInterestRateSecondary(expectedLoan.id, newInterestRate))
        .to.emit(marketUnderAdmin, EVENT_NAME_LOAN_INTEREST_RATE_SECONDARY_UPDATED)
        .withArgs(expectedLoan.id, newInterestRate, oldInterestRate);
      const actualLoanState = await marketUnderAdmin.getLoanState(expectedLoan.id);
      checkEquality(actualLoanState, expectedLoan.state);
    });

    it("Is reverted if the contract is paused", async () => {
      const { market, marketUnderAdmin, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
      await proveTx(market.pause());

      await expect(
        marketUnderAdmin.updateLoanInterestRateSecondary(loan.id, INTEREST_RATE_SECONDARY)
      ).to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the loan does not exist", async () => {
      const { marketUnderAdmin, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
      const wrongLoanId = loan.id + 123;

      await expect(marketUnderAdmin.updateLoanInterestRateSecondary(wrongLoanId, INTEREST_RATE_SECONDARY))
        .to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_LOAN_NOT_EXIST);
    });

    it("Is reverted if the loan is already repaid", async () => {
      const { marketUnderAdmin, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
      await proveTx(connect(marketUnderAdmin, borrower).repayLoan(loan.id, FULL_REPAYMENT_AMOUNT));

      await expect(marketUnderAdmin.updateLoanInterestRateSecondary(loan.id, INTEREST_RATE_SECONDARY))
        .to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_LOAN_ALREADY_REPAID);
    });

    it("Is reverted if the caller does not have the admin role", async () => {
      const { market, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);

      await expect(connect(market, owner).updateLoanInterestRateSecondary(loan.id, INTEREST_RATE_SECONDARY))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(owner.address, ADMIN_ROLE);
      await expect(connect(market, borrower).updateLoanInterestRateSecondary(loan.id, INTEREST_RATE_SECONDARY))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(borrower.address, ADMIN_ROLE);
      await expect(connect(market, stranger).updateLoanInterestRateSecondary(loan.id, INTEREST_RATE_SECONDARY))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(stranger.address, ADMIN_ROLE);
    });

    it("Is is reverted if the new interest rate is the same as the previous one or greater", async () => {
      const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
      const { marketUnderAdmin, ordinaryLoan: loan } = fixture;
      let newInterestRate = loan.state.interestRateSecondary;

      await expect(marketUnderAdmin.updateLoanInterestRateSecondary(loan.id, newInterestRate))
        .to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_INAPPROPRIATE_INTEREST_RATE);

      newInterestRate += 1;
      await expect(marketUnderAdmin.updateLoanInterestRateSecondary(loan.id, newInterestRate))
        .to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_INAPPROPRIATE_INTEREST_RATE);
    });
  });

  describe("Function 'revokeLoan()'", async () => {
    async function revokeAndCheck(fixture: Fixture, props: {
      isAddonAmountZero: boolean;
      loan: Loan;
    }) {
      const { market } = fixture;
      const expectedLoan = clone(props.loan);
      const borrowerBalanceChange = expectedLoan.state.repaidAmount - expectedLoan.state.borrowedAmount;

      if (props.isAddonAmountZero) {
        expectedLoan.state.addonAmount = 0;
        await proveTx(fixture.market.zeroAddonAmountBatch([expectedLoan.id]));
      }

      const tx: Promise<TransactionResponse> = connect(market, admin).revokeLoan(expectedLoan.id);

      expectedLoan.state.trackedBalance = 0;
      expectedLoan.state.trackedTimestamp = calculateTimestampWithOffset(await getTxTimestamp(tx));

      await expect(tx).to.emit(market, EVENT_NAME_LOAN_REVOKED).withArgs(expectedLoan.id);
      const addonAmount = expectedLoan.state.addonAmount;
      await expect(tx).to.changeTokenBalances(
        token,
        [borrower, liquidityPool, addonTreasury, market],
        [borrowerBalanceChange, -borrowerBalanceChange + addonAmount, -addonAmount, 0]
      );
      if (addonAmount != 0 && borrowerBalanceChange != 0) {
        expect(await getNumberOfEvents(tx, token, EVENT_NAME_TRANSFER)).to.eq(2);
      } else if (addonAmount == 0 && borrowerBalanceChange == 0) {
        expect(await getNumberOfEvents(tx, token, EVENT_NAME_TRANSFER)).to.eq(0);
      } else {
        expect(await getNumberOfEvents(tx, token, EVENT_NAME_TRANSFER)).to.eq(1);
      }
      const actualLoanState = await market.getLoanState(expectedLoan.id);
      checkEquality(actualLoanState, expectedLoan.state);

      // Check hook calls
      await expect(tx).to.emit(creditLine, EVENT_NAME_ON_AFTER_LOAN_REVOCATION).withArgs(expectedLoan.id);
      await expect(tx).and.to.emit(liquidityPool, EVENT_NAME_ON_AFTER_LOAN_REVOCATION).withArgs(expectedLoan.id);
    }

    describe("Executes as expected and emits correct event if", async () => {
      describe("The addon amount is NOT zero and", async () => {
        it("Is called after a repayment that is less than the borrowed amount", async () => {
          const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);

          const loan = clone(fixture.ordinaryLoan);
          const repaymentAmount = roundSpecific(loan.state.borrowedAmount / 2);
          expect(repaymentAmount).lessThan(loan.state.borrowedAmount);
          const tx = connect(fixture.market, borrower).repayLoan(loan.id, repaymentAmount);
          processRepayment(loan, { repaymentAmount, repaymentTimestamp: await getTxTimestamp(tx) });
          await increaseBlockTimestampToPeriodIndex(loan.startPeriod + 1);

          await revokeAndCheck(fixture, { isAddonAmountZero: false, loan });
        });

        it("Is called after a repayment that equals the borrowed amount", async () => {
          const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);

          const loan = clone(fixture.ordinaryLoan);
          const repaymentAmount = loan.state.borrowedAmount;
          expect(repaymentAmount).lessThan(loan.state.borrowedAmount + loan.state.addonAmount);
          const tx = connect(fixture.market, borrower).repayLoan(loan.id, repaymentAmount);
          processRepayment(loan, { repaymentAmount, repaymentTimestamp: await getTxTimestamp(tx) });
          await increaseBlockTimestampToPeriodIndex(loan.startPeriod + 2);

          await revokeAndCheck(fixture, { isAddonAmountZero: false, loan });
        });

        it("Is called after a repayment that is greater than the borrowed amount", async () => {
          const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);

          const loan = clone(fixture.ordinaryLoan);
          const repaymentAmount = loan.state.borrowedAmount + ACCURACY_FACTOR;
          expect(repaymentAmount).lessThan(loan.state.borrowedAmount + loan.state.addonAmount);
          const tx = connect(fixture.market, borrower).repayLoan(loan.id, repaymentAmount);
          processRepayment(loan, { repaymentAmount, repaymentTimestamp: await getTxTimestamp(tx) });
          await increaseBlockTimestampToPeriodIndex(loan.startPeriod + loan.state.durationInPeriods + 1);

          await revokeAndCheck(fixture, { isAddonAmountZero: false, loan });
        });

        it("Is called for a partially repaid loan after freezing", async () => {
          const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);

          const loan = clone(fixture.ordinaryLoan);
          const repaymentAmount = roundSpecific(loan.state.borrowedAmount / 2);
          let tx = connect(fixture.market, borrower).repayLoan(loan.id, repaymentAmount);
          processRepayment(loan, { repaymentAmount, repaymentTimestamp: await getTxTimestamp(tx) });

          let periodIndex = loan.startPeriod + loan.state.durationInPeriods / 2;
          await increaseBlockTimestampToPeriodIndex(periodIndex);
          tx = fixture.marketUnderAdmin.freeze(loan.id);
          loan.state.freezeTimestamp = calculateTimestampWithOffset(await getTxTimestamp(tx));
          periodIndex += loan.state.durationInPeriods;
          await increaseBlockTimestampToPeriodIndex(periodIndex);

          await revokeAndCheck(fixture, { isAddonAmountZero: false, loan });
        });
      });

      describe("The addon amount is zero and", async () => {
        it("Is called after a repayment that equals the borrowed amount", async () => {
          const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);

          const loan = clone(fixture.ordinaryLoan);
          const repaymentAmount = loan.state.borrowedAmount;
          const tx = connect(fixture.market, borrower).repayLoan(loan.id, repaymentAmount);
          processRepayment(loan, { repaymentAmount, repaymentTimestamp: await getTxTimestamp(tx) });
          await increaseBlockTimestampToPeriodIndex(loan.startPeriod + loan.state.durationInPeriods / 2);

          await revokeAndCheck(fixture, { isAddonAmountZero: true, loan: loan });
        });
      });
    });

    describe("Is reverted if", async () => {
      it("The contract is paused", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const { market, marketUnderAdmin, ordinaryLoan: loan } = fixture;
        await proveTx(market.pause());

        await expect(marketUnderAdmin.revokeLoan(loan.id))
          .to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_ENFORCED_PAUSED);
      });

      it("The loan does not exist", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const { marketUnderAdmin, ordinaryLoan: loan } = fixture;

        await expect(marketUnderAdmin.revokeLoan(loan.id + 123))
          .to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_LOAN_NOT_EXIST);
      });

      it("The loan is already repaid", async () => {
        const { marketUnderAdmin, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
        await proveTx(connect(marketUnderAdmin, borrower).repayLoan(loan.id, FULL_REPAYMENT_AMOUNT));

        await expect(marketUnderAdmin.revokeLoan(loan.id))
          .to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_LOAN_ALREADY_REPAID);
      });

      it("The caller is not an admin", async () => {
        const { market, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);

        await expect(connect(market, owner).revokeLoan(loan.id))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
          .withArgs(owner.address, ADMIN_ROLE);
        await expect(connect(market, borrower).revokeLoan(loan.id))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
          .withArgs(borrower.address, ADMIN_ROLE);
        await expect(connect(market, stranger).revokeLoan(loan.id))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
          .withArgs(stranger.address, ADMIN_ROLE);
      });

      it("The loan is a sub-loan of an installment loan", async () => {
        const { marketUnderAdmin, installmentLoanParts: [loan] } = await setUpFixture(deployLendingMarketAndTakeLoans);

        await expect(marketUnderAdmin.revokeLoan(loan.id))
          .to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_LOAN_TYPE_UNEXPECTED)
          .withArgs(
            LoanType.Installment, // actual
            LoanType.Ordinary // expected
          );
      });

      it("The addon treasury is NOT configured on the liquidity pool", async () => {
        const { marketUnderAdmin, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);
        await proveTx(liquidityPool.mockAddonTreasury(ZERO_ADDRESS));

        await expect(marketUnderAdmin.revokeLoan(loan.id))
          .to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_ADDON_TREASURY_ADDRESS_ZERO);
      });
    });
  });

  describe("Function 'revokeInstallmentLoan()'", async () => {
    async function revokeAndCheck(fixture: Fixture, props: {
      areAddonAmountsZero: boolean;
      loans: Loan[];
    }) {
      const { market, installmentLoanParts: loans } = fixture;
      const loanIds = loans.map(loan => loan.id);
      const expectedLoans = props.loans.map(loan => clone(loan));
      const borrowerBalanceChange = expectedLoans
        .map(loan => loan.state.repaidAmount - loan.state.borrowedAmount)
        .reduce((sum, amount) => sum + amount);

      if (props.areAddonAmountsZero) {
        expectedLoans.forEach(loan => loan.state.addonAmount = 0);
        await proveTx(fixture.market.zeroAddonAmountBatch(expectedLoans.map(loan => loan.id)));
      }

      const middleLoanId = loanIds.length > 1 ? 1 : 0;

      const tx: Promise<TransactionResponse> = connect(market, admin).revokeInstallmentLoan(middleLoanId);

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

      const totalAddonAmount = expectedLoans
        .map(loan => loan.state.addonAmount)
        .reduce((sum, amount) => sum + amount);
      await expect(tx).to.changeTokenBalances(
        token,
        [borrower, liquidityPool, addonTreasury, market],
        [borrowerBalanceChange, -borrowerBalanceChange + totalAddonAmount, -totalAddonAmount, 0]
      );
      if (totalAddonAmount != 0 && borrowerBalanceChange != 0) {
        expect(await getNumberOfEvents(tx, token, EVENT_NAME_TRANSFER)).to.eq(2);
      } else if (totalAddonAmount == 0 && borrowerBalanceChange == 0) {
        expect(await getNumberOfEvents(tx, token, EVENT_NAME_TRANSFER)).to.eq(0);
      } else {
        expect(await getNumberOfEvents(tx, token, EVENT_NAME_TRANSFER)).to.eq(1);
      }
    }

    describe("Executes as expected and emits correct event if", async () => {
      describe("NOT all addon amounts are zero and", async () => {
        describe("All installments are ongoing and", async () => {
          it("Is called the next day after the loan started and without repayments", async () => {
            const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
            const loans = fixture.installmentLoanParts;
            const periodIndex = loans[0].startPeriod + 1;
            await increaseBlockTimestampToPeriodIndex(periodIndex);
            await revokeAndCheck(fixture, { areAddonAmountsZero: false, loans });
          });

          it("Is called for partially repaid installments and after one of them is frozen", async () => {
            const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
            const loans = fixture.installmentLoanParts.map(loan => clone(loan));
            for (const loan of loans) {
              const repaymentAmount = roundSpecific(Math.round(loan.state.borrowedAmount / 2));
              const tx = connect(fixture.market, borrower).repayLoan(loan.id, repaymentAmount);
              const repaymentTimestamp = await getTxTimestamp(tx);
              processRepayment(loan, { repaymentAmount, repaymentTimestamp });
            }

            let periodIndex = loans[1].startPeriod + loans[1].state.durationInPeriods / 2;
            await increaseBlockTimestampToPeriodIndex(periodIndex);
            const tx = fixture.marketUnderAdmin.freeze(loans[1].id);
            loans[1].state.freezeTimestamp = calculateTimestampWithOffset(await getTxTimestamp(tx));
            periodIndex += loans[1].state.durationInPeriods;
            await increaseBlockTimestampToPeriodIndex(periodIndex);

            await revokeAndCheck(fixture, { areAddonAmountsZero: false, loans });
          });
        });

        describe("All installments are repaid except the last one", async () => {
          async function repayInstalmentsExceptLastOne(
            market: Contract,
            loans: Loan[]
          ): Promise<{ totalRepaymentAmount: number; totalBorrowedAmount: number }> {
            let totalRepaymentAmount = 0;
            let totalBorrowedAmount = 0;
            for (let i = 0; i < loans.length - 1; ++i) {
              const loan = loans[i];
              const tx = connect(market, borrower).repayLoan(loan.id, FULL_REPAYMENT_AMOUNT);
              const repaymentTimestamp = await getTxTimestamp(tx);
              processRepayment(loan, { repaymentAmount: FULL_REPAYMENT_AMOUNT, repaymentTimestamp });
              totalRepaymentAmount += loan.state.repaidAmount;
              totalBorrowedAmount += loan.state.borrowedAmount;
            }
            totalBorrowedAmount += loans[loans.length - 1].state.borrowedAmount;

            return {
              totalRepaymentAmount,
              totalBorrowedAmount
            };
          }

          it("Is called after the total repayment is less than the total borrowed amount", async () => {
            const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);

            const loans = fixture.installmentLoanParts.map(loan => clone(loan));
            const lastLoan: Loan = loans[loans.length - 1];
            const { totalBorrowedAmount, totalRepaymentAmount } =
              await repayInstalmentsExceptLastOne(fixture.market, loans);

            const repaymentAmount = roundSpecific(Math.round((totalBorrowedAmount - totalRepaymentAmount) / 2));
            expect(repaymentAmount).lessThan(lastLoan.state.borrowedAmount + lastLoan.state.addonAmount);
            expect(repaymentAmount + totalRepaymentAmount).lessThan(totalBorrowedAmount);
            const tx = connect(fixture.market, borrower).repayLoan(lastLoan.id, repaymentAmount);
            processRepayment(lastLoan, { repaymentAmount, repaymentTimestamp: await getTxTimestamp(tx) });
            const periodIndex = loans[0].startPeriod + loans[loans.length - 1].state.durationInPeriods / 2;
            await increaseBlockTimestampToPeriodIndex(periodIndex);

            await revokeAndCheck(fixture, { areAddonAmountsZero: false, loans });
          });

          it("Is called after the total repayment equals the total borrowed amount", async () => {
            const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);

            const loans = fixture.installmentLoanParts.map(loan => clone(loan));
            const lastLoan: Loan = loans[loans.length - 1];
            const { totalBorrowedAmount, totalRepaymentAmount } =
              await repayInstalmentsExceptLastOne(fixture.market, loans);

            const repaymentAmount = roundSpecific(totalBorrowedAmount - totalRepaymentAmount);
            expect(repaymentAmount).lessThan(roundSpecific(lastLoan.state.borrowedAmount + lastLoan.state.addonAmount));
            expect(totalRepaymentAmount + repaymentAmount).eq(totalBorrowedAmount);
            const tx = connect(fixture.market, borrower).repayLoan(lastLoan.id, repaymentAmount);
            processRepayment(lastLoan, { repaymentAmount, repaymentTimestamp: await getTxTimestamp(tx) });

            await increaseBlockTimestampToPeriodIndex(
              loans[0].startPeriod + loans[loans.length - 1].state.durationInPeriods + 1
            );

            await revokeAndCheck(fixture, { areAddonAmountsZero: false, loans });
          });

          it("Is called after the total repayment is greater than the total borrowed amount", async () => {
            const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);

            const loans = fixture.installmentLoanParts.map(loan => clone(loan));
            const lastLoan: Loan = loans[loans.length - 1];
            const { totalBorrowedAmount, totalRepaymentAmount } =
              await repayInstalmentsExceptLastOne(fixture.market, loans);

            const repaymentAmount = roundSpecific(totalBorrowedAmount - totalRepaymentAmount + ACCURACY_FACTOR);
            expect(repaymentAmount).lessThan(lastLoan.state.borrowedAmount + lastLoan.state.addonAmount);
            expect(repaymentAmount + totalRepaymentAmount).greaterThan(totalBorrowedAmount);
            const tx = connect(fixture.market, borrower).repayLoan(lastLoan.id, repaymentAmount);
            processRepayment(lastLoan, { repaymentAmount, repaymentTimestamp: await getTxTimestamp(tx) });

            await increaseBlockTimestampToPeriodIndex(loans[0].startPeriod + 1);

            await revokeAndCheck(fixture, { areAddonAmountsZero: false, loans });
          });
        });
      });

      describe("All addon amounts are zero and", async () => {
        describe("All installments are ongoing and", async () => {
          it("Is called after the due date", async () => {
            const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
            const loans = fixture.installmentLoanParts;
            await increaseBlockTimestampToPeriodIndex(
              loans[0].startPeriod + loans[loans.length - 1].state.durationInPeriods + 1
            );
            await revokeAndCheck(fixture, { areAddonAmountsZero: true, loans });
          });

          it("Is called after the total repaid amount is close to the total borrowed one", async () => {
            const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
            const loans = fixture.installmentLoanParts.map(loan => clone(loan));
            for (const loan of loans) {
              const repaymentAmount = roundSpecific(loan.state.borrowedAmount);
              const tx = connect(fixture.market, borrower).repayLoan(loan.id, repaymentAmount);
              processRepayment(loan, { repaymentAmount, repaymentTimestamp: await getTxTimestamp(tx) });
            }
            await increaseBlockTimestampToPeriodIndex(loans[0].startPeriod + 1);

            await revokeAndCheck(fixture, { areAddonAmountsZero: true, loans });
          });
        });
      });
    });

    describe("Is reverted if", async () => {
      it("The contract is paused", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const { market, marketUnderAdmin, installmentLoanParts: [loan] } = fixture;
        await proveTx(market.pause());

        await expect(marketUnderAdmin.revokeInstallmentLoan(loan.id))
          .to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_ENFORCED_PAUSED);
      });

      it("The loan does not exist", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
        const { marketUnderAdmin, installmentLoanParts: [loan] } = fixture;

        await expect(marketUnderAdmin.revokeInstallmentLoan(loan.id + 123))
          .to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_LOAN_NOT_EXIST);
      });

      it("All the sub-loans of the installment loan are already repaid", async () => {
        const { marketUnderAdmin, installmentLoanParts: loans } = await setUpFixture(deployLendingMarketAndTakeLoans);
        for (const loan of loans) {
          await proveTx(connect(marketUnderAdmin, borrower).repayLoan(loan.id, FULL_REPAYMENT_AMOUNT));
        }

        await expect(marketUnderAdmin.revokeInstallmentLoan(loans[0].id))
          .to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_LOAN_ALREADY_REPAID);
      });

      it("The caller is not an admin", async () => {
        const { market, installmentLoanParts: [loan] } = await setUpFixture(deployLendingMarketAndTakeLoans);

        await expect(connect(market, owner).revokeInstallmentLoan(loan.id))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
          .withArgs(owner.address, ADMIN_ROLE);
        await expect(connect(market, borrower).revokeInstallmentLoan(loan.id))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
          .withArgs(borrower.address, ADMIN_ROLE);
        await expect(connect(market, stranger).revokeInstallmentLoan(loan.id))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
          .withArgs(stranger.address, ADMIN_ROLE);
      });

      it("The loan is an ordinary loan", async () => {
        const { marketUnderAdmin, ordinaryLoan: loan } = await setUpFixture(deployLendingMarketAndTakeLoans);

        await expect(marketUnderAdmin.revokeInstallmentLoan(loan.id))
          .to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_LOAN_TYPE_UNEXPECTED)
          .withArgs(
            LoanType.Ordinary, // actual
            LoanType.Installment // expected
          );
      });

      it("The addon treasury is NOT configured on the liquidity pool", async () => {
        const { marketUnderAdmin, installmentLoanParts: [loan] } = await setUpFixture(deployLendingMarketAndTakeLoans);
        await proveTx(liquidityPool.mockAddonTreasury(ZERO_ADDRESS));

        await expect(marketUnderAdmin.revokeInstallmentLoan(loan.id))
          .to.be.revertedWithCustomError(marketUnderAdmin, ERROR_NAME_ADDON_TREASURY_ADDRESS_ZERO);
      });
    });
  });

  describe("Function 'migrateAccessControl()'", async () => {
    async function prepareMigration(fixture: Fixture, aliases: HardhatEthersSigner[]): Promise<{
      programCount: number;
      creditLineAddresses: string[];
      liquidityPoolAddresses: string[];
    }> {
      const { market } = fixture;
      const creditLines = [creditLine, anotherCreditLine];
      const liquidityPools = [liquidityPool, anotherLiquidityPool];
      const creditLineAddresses = creditLines.map(creditLine => getAddress(creditLine));
      const liquidityPoolAddresses = liquidityPools.map(liquidityPool => getAddress(liquidityPool));

      for (const alias of aliases) {
        await proveTx(market.setAlias(owner.address, alias.address, true));
      }

      if (await market.hasRole(ADMIN_ROLE, owner.address) === true) {
        await proveTx(market.revokeRole(ADMIN_ROLE, owner.address));
      }
      if (await market.hasRole(PAUSER_ROLE, owner.address) === true) {
        await proveTx(market.revokeRole(PAUSER_ROLE, owner.address));
      }

      market.setRoleAdmin(OWNER_ROLE, DEFAULT_ADMIN_ROLE);
      market.setRoleAdmin(ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
      market.setRoleAdmin(PAUSER_ROLE, DEFAULT_ADMIN_ROLE);

      const targetProgramCount = creditLines.length;
      let currentProgramCount = 0;
      for (let programId = 1; programId <= targetProgramCount; ++programId) {
        if (await market.getProgramCreditLine(programId) != ZERO_ADDRESS) {
          ++currentProgramCount;
        }
      }

      expect(creditLines.length).lessThanOrEqual(targetProgramCount);
      for (let programId = currentProgramCount + 1; programId <= targetProgramCount; ++programId) {
        await proveTx(market.createProgram(creditLineAddresses[programId - 1], liquidityPoolAddresses[programId - 1]));
      }

      for (let i = 0; i < targetProgramCount; ++i) {
        const programId = i + 1;
        await proveTx(market.setProgramLender(programId, owner.address));
        await proveTx(market.setCreditLineLender(creditLineAddresses[i], owner.address));
        await proveTx(market.setLiquidityPoolLender(liquidityPoolAddresses[i], owner.address));
      }

      // Check all settings at the end
      for (const alias of aliases) {
        expect(await market.isAlias(alias.address, owner.address)).to.be.true;
        expect(await market.hasRole(ADMIN_ROLE, alias.address)).to.be.false;
      }

      expect(await market.getRoleAdmin(OWNER_ROLE)).to.eq(DEFAULT_ADMIN_ROLE);
      expect(await market.getRoleAdmin(ADMIN_ROLE)).to.eq(DEFAULT_ADMIN_ROLE);
      expect(await market.getRoleAdmin(PAUSER_ROLE)).to.eq(DEFAULT_ADMIN_ROLE);

      expect(await market.hasRole(OWNER_ROLE, owner.address)).to.be.true;
      expect(await market.hasRole(ADMIN_ROLE, owner.address)).to.be.false;
      expect(await market.hasRole(PAUSER_ROLE, owner.address)).to.be.false;

      for (let programId = 1; programId <= targetProgramCount; ++programId) {
        expect(await market.getProgramLender(programId)).to.eq(owner.address);
      }

      for (const contractAddress of creditLineAddresses) {
        expect(await market.getCreditLineLender(contractAddress)).to.eq(owner.address);
      }

      for (const contractAddress of liquidityPoolAddresses) {
        expect(await market.getLiquidityPoolLender(contractAddress)).to.eq(owner.address);
      }

      return {
        programCount: targetProgramCount,
        creditLineAddresses,
        liquidityPoolAddresses
      };
    }

    it("Executes as expected", async () => {
      const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
      const aliases = [deployer, borrower, borrower, stranger]; // Intentional duplication in the array
      const aliasAddresses = aliases.map(alias => alias.address);
      const { market } = fixture;
      const { programCount, creditLineAddresses, liquidityPoolAddresses } = await prepareMigration(fixture, aliases);
      aliasAddresses.push(addonTreasury.address); // One more account that is not an alias;

      // The first call with not all aliases

      const tx1 = market.migrateAccessControl(programCount, [aliasAddresses[0], aliasAddresses[1], aliasAddresses[2]]);

      expect(await getNumberOfEvents(tx1, market, EVENT_NAME_LENDER_ALIAS_CONFIGURED)).to.eq(2);
      await expect(tx1)
        .to.emit(market, EVENT_NAME_LENDER_ALIAS_CONFIGURED)
        .withArgs(owner.address, aliasAddresses[0], false);
      await expect(tx1)
        .to.emit(market, EVENT_NAME_LENDER_ALIAS_CONFIGURED)
        .withArgs(owner.address, aliasAddresses[1], false);

      for (let i = 0; i < 3; ++i) {
        expect(await market.isAlias(aliasAddresses[i], owner.address)).to.be.false;
        expect(await market.hasRole(ADMIN_ROLE, aliasAddresses[i])).to.be.true;
      }
      expect(await market.isAlias(aliasAddresses[3], owner.address)).to.be.true; // !!!
      expect(await market.hasRole(ADMIN_ROLE, aliasAddresses[3])).to.be.false;
      expect(await market.isAlias(aliasAddresses[4], owner.address)).to.be.false;
      expect(await market.hasRole(ADMIN_ROLE, aliasAddresses[4])).to.be.false;

      expect(await market.getRoleAdmin(OWNER_ROLE)).to.eq(OWNER_ROLE);
      expect(await market.getRoleAdmin(ADMIN_ROLE)).to.eq(OWNER_ROLE);
      expect(await market.getRoleAdmin(PAUSER_ROLE)).to.eq(OWNER_ROLE);

      expect(await market.hasRole(OWNER_ROLE, owner.address)).to.be.true;
      expect(await market.hasRole(ADMIN_ROLE, owner.address)).to.be.true;
      expect(await market.hasRole(PAUSER_ROLE, owner.address)).to.be.true;

      for (let programId = 1; programId <= programCount; ++programId) {
        expect(await market.getProgramLender(programId)).to.eq(ZERO_ADDRESS);
      }
      for (const contractAddress of creditLineAddresses) {
        expect(await market.getCreditLineLender(contractAddress)).to.eq(ZERO_ADDRESS);
      }
      for (const contractAddress of liquidityPoolAddresses) {
        expect(await market.getLiquidityPoolLender(contractAddress)).to.eq(ZERO_ADDRESS);
      }

      // The second call with all aliases

      const tx2 = market.migrateAccessControl(programCount, aliasAddresses);

      expect(await getNumberOfEvents(tx2, market, EVENT_NAME_LENDER_ALIAS_CONFIGURED)).to.eq(1);
      await expect(tx2)
        .to.emit(market, EVENT_NAME_LENDER_ALIAS_CONFIGURED)
        .withArgs(owner.address, aliasAddresses[3], false);

      for (const aliasAddress of aliasAddresses) {
        expect(await market.isAlias(aliasAddress, owner.address)).to.be.false;
      }

      for (let i = 0; i < aliasAddresses.length - 1; ++i) {
        expect(await market.hasRole(ADMIN_ROLE, aliasAddresses[i])).to.be.true;
      }
      // Check that the admin role is not granted for an account that has not been an alias before the migration
      expect(await market.hasRole(ADMIN_ROLE, aliasAddresses[aliasAddresses.length - 1])).to.be.false;

      await expect(tx2).not.to.emit(market, "RoleAdminChanged"); // To be sure only aliases have been revoked

      // The third call with no aliases

      const tx3 = market.migrateAccessControl(programCount, []);

      expect(await getNumberOfEvents(tx3, market, EVENT_NAME_LENDER_ALIAS_CONFIGURED)).to.eq(0);
      await expect(tx3).not.to.emit(market, "RoleAdminChanged"); // To be sure only aliases have been revoked
    });

    it("Is reverted if the caller does not have the owner role", async () => {
      const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
      const aliasAddresses: string[] = [];
      const { market } = fixture;
      const programCount = 1;

      await expect(connect(market, admin).migrateAccessControl(programCount, aliasAddresses))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(admin.address, OWNER_ROLE);
    });

    it("Is reverted if the provided program count is less then the number of lending programs", async () => {
      const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
      const aliasAddresses: string[] = [];
      const { market } = fixture;
      const { programCount } = await prepareMigration(fixture, []);

      await expect(market.migrateAccessControl(programCount - 1, aliasAddresses)).to.be.reverted;
      await expect(market.migrateAccessControl(0, aliasAddresses)).to.be.reverted;
    });

    it("Is reverted if the provided program count is greater then the number of lending programs", async () => {
      const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
      const aliasAddresses: string[] = [];
      const { market } = fixture;
      const { programCount } = await prepareMigration(fixture, []);

      await expect(market.migrateAccessControl(programCount + 1, aliasAddresses)).to.be.reverted;
    });
  });

  describe("View functions", async () => {
    // This section tests only those functions that have not been previously used in other sections.
    it("Function 'getLoanPreview()' executes as expected", async () => {
      const fixture = await setUpFixture(deployLendingMarketAndTakeLoans);
      const { market } = fixture;

      const loans = [
        clone(fixture.ordinaryLoan),
        clone(fixture.installmentLoanParts[fixture.installmentLoanParts.length - 1])
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

      // Repay the first loan to be sure that the function works correctly with repaid loans
      const tx = connect(market, admin).repayLoanForBatch(
        [loans[0].id],
        [expectedLoanPreviews[0].outstandingBalance],
        borrower.address
      );
      timestamp = await getTxTimestamp(tx);
      processRepayment(
        loans[0],
        { repaymentTimestamp: timestamp, repaymentAmount: expectedLoanPreviews[0].outstandingBalance }
      );

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

      // The loan after defaulting and no credit line registered for the program ID.
      // The late fee amount must be zero in this case.
      const loan = clone(loans[0]);
      await proveTx(
        market.setCreditLineForProgram(loan.state.programId, ZERO_ADDRESS) // Call via the testable version
      );
      loan.config.lateFeeAmount = 0;
      const expectedLoanPreview = determineLoanPreview(loan, timestamp);
      const actualLoanPreview = await market.getLoanPreview(loan.id, timestamp);
      checkEquality(actualLoanPreview, expectedLoanPreview);
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

    it("Function '_checkIfAdmin()' executes as expected before the access control migration", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoans);

      await expect(market.checkIfAdmin(stranger.address))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(stranger.address, ADMIN_ROLE);

      await proveTx(market.setProgramLender(1, owner.address));
      await proveTx(market.setAlias(owner.address, stranger.address, true));

      await expect(market.checkIfAdmin(stranger.address)).not.to.be.reverted;
    });
  });

  describe("Pure functions", async () => {
    it("Function 'calculateTrackedBalance()' executes as expected", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoans);
      const actualBalance = await market.calculateTrackedBalance(
        BORROWED_AMOUNT,
        DURATION_IN_PERIODS,
        INTEREST_RATE_PRIMARY,
        INTEREST_RATE_FACTOR
      );

      const expectedBalance = calculateTrackedBalance(
        BORROWED_AMOUNT,
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
