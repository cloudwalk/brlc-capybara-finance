import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory, TransactionResponse } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  connect,
  getAddress,
  getBlockTimestamp,
  getLatestBlockTimestamp,
  increaseBlockTimestampTo,
  proveTx,
} from "../test-utils/eth";

const GRANTOR_ROLE = ethers.id("GRANTOR_ROLE");
const ADMIN_ROLE = ethers.id("ADMIN_ROLE");
const LIQUIDITY_OPERATOR_ROLE = ethers.id("LIQUIDITY_OPERATOR_ROLE");

const MAX_ALLOWANCE = ethers.MaxUint256;
const INITIAL_BALANCE = 10n ** 15n;
const INITIAL_DEPOSIT = 10n ** 15n;
const PERIOD_IN_SECONDS = 86400;
const PROGRAM_ID = 1;
const NEGATIVE_TIME_OFFSET = 3 * 60 * 60; // 3 hours

const FUNC_CONFIGURE_BORROWER_NEW =
  "configureBorrower(address,(uint32,uint32,uint32,uint64,uint64,uint8,uint32,uint32,uint32,uint32,uint8,uint32))";

enum BorrowingPolicy {
  // SingleActiveLoan = 0,
  // MultipleActiveLoans = 1
  TotalActiveAmountLimit = 2,
}

enum LateFeePolicy {
  Common = 0,
  // Individual = 1
}

enum ScenarioFinalAction {
  None = 0,
  FullRepayment = 1,
  Revocation = 2,
  FullRepaymentCheck = 3,
}

interface Fixture {
  lendingMarketFactory: ContractFactory;
  creditLineFactory: ContractFactory;
  liquidityPoolFactory: ContractFactory;
  tokenFactory: ContractFactory;

  token: Contract;
  lendingMarket: Contract;
  creditLine: Contract;
  liquidityPool: Contract;

  tokenAddress: string;
  lendingMarketAddress: string;
  creditLineAddress: string;
  liquidityPoolAddress: string;
}

interface TestScenario {
  borrowedAmount: number;
  addonAmount: number;
  durationInPeriods: number;
  interestRatePrimary: number;
  interestRateSecondary: number;
  lateFeeRate: number;
  iterationStep: number;
  relativePrecision: number;
  repaymentAmounts: number[];
  expectedOutstandingBalancesBeforeRepayment: number[];
  frozenStepIndexes: number[];
  finalAction: ScenarioFinalAction;
}

interface TestScenarioContext {
  scenario: TestScenario;
  fixture?: Fixture;
  stepIndex: number;
  loanId: bigint;
  loanTakingPeriod: number;
  frozenStepIndexes: Set<number>;
  frozenState: boolean;
  poolBalanceAtStart: bigint;
  poolBalanceAtFinish: bigint;
  totalRepaymentAmount: number;
}

interface CreditLineConfig {
  minBorrowedAmount: number;
  maxBorrowedAmount: number;
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
  lateFeeRate: number;

  [key: string]: number; // Index signature
}

interface BorrowerConfig {
  expiration: number;
  minDurationInPeriods: number;
  maxDurationInPeriods: number;
  minBorrowedAmount: number;
  maxBorrowedAmount: number;
  borrowingPolicy: BorrowingPolicy;
  interestRatePrimary: number;
  interestRateSecondary: number;
  addonFixedRate: number;
  addonPeriodRate: number;
  lateFeePolicy: LateFeePolicy;
  lateFeeRate: number;

  [key: string]: number | BorrowingPolicy; // Index signature
}

const testScenarioDefault: TestScenario = {
  borrowedAmount: 0,
  addonAmount: 0,
  durationInPeriods: 180,
  interestRatePrimary: 0,
  interestRateSecondary: 0,
  lateFeeRate: 20_000_000, // 2 %
  iterationStep: 30,
  relativePrecision: 1e-7, // 0.00001% difference
  repaymentAmounts: [],
  expectedOutstandingBalancesBeforeRepayment: [],
  frozenStepIndexes: [],
  finalAction: ScenarioFinalAction.None,
};

const testScenarioContextDefault: TestScenarioContext = {
  scenario: testScenarioDefault,
  stepIndex: 0,
  loanId: 0n,
  loanTakingPeriod: 0,
  frozenStepIndexes: new Set(),
  frozenState: false,
  poolBalanceAtStart: 0n,
  poolBalanceAtFinish: 0n,
  totalRepaymentAmount: 0,
};

function calculateLoanPeriodIndex(timestamp: number): number {
  return Math.floor((timestamp - NEGATIVE_TIME_OFFSET) / PERIOD_IN_SECONDS);
}

function calculateTimestampByLoanPeriodIndex(periodIndex: number): number {
  return Math.floor(periodIndex * PERIOD_IN_SECONDS + NEGATIVE_TIME_OFFSET);
}

describe("Contract 'LendingMarket': complex tests", async () => {
  let fixture: Fixture;

  let owner: HardhatEthersSigner;
  let borrower: HardhatEthersSigner;
  let addonTreasury: HardhatEthersSigner;

  before(async () => {
    [, owner, borrower, addonTreasury] = await ethers.getSigners();

    fixture = await deployContracts();
    await configureContracts(fixture);

    // Start tests at the beginning of a loan period to avoid rare failures due to crossing a border between two periods
    const periodIndex = calculateLoanPeriodIndex(await getLatestBlockTimestamp());
    const nextPeriodTimestamp = calculateTimestampByLoanPeriodIndex(periodIndex + 1);
    await increaseBlockTimestampTo(nextPeriodTimestamp);
  });

  async function deployContracts(): Promise<Fixture> {
    // Factories with an explicitly specified deployer account
    let tokenFactory: ContractFactory = await ethers.getContractFactory("ERC20Mock");
    tokenFactory = tokenFactory.connect(owner);
    let lendingMarketFactory: ContractFactory = await ethers.getContractFactory("LendingMarket");
    lendingMarketFactory = lendingMarketFactory.connect(owner);
    let creditLineFactory: ContractFactory = await ethers.getContractFactory("CreditLine");
    creditLineFactory = creditLineFactory.connect(owner);
    let liquidityPoolFactory: ContractFactory = await ethers.getContractFactory("LiquidityPool");
    liquidityPoolFactory = liquidityPoolFactory.connect(owner);

    // Deploy the token contract
    let token = (await tokenFactory.deploy()) as Contract;
    await token.waitForDeployment();
    token = connect(token, owner); // Explicitly specifying the initial account
    const tokenAddress = getAddress(token);

    // Deploy the lending market contract
    let lendingMarket = await upgrades.deployProxy(
      lendingMarketFactory,
      [owner.address],
      { kind: "uups" },
    ) as Contract;
    await lendingMarket.waitForDeployment();
    lendingMarket = connect(lendingMarket, owner); // Explicitly specifying the initial account
    const lendingMarketAddress = getAddress(lendingMarket);

    // Deploy the credit line contract
    let creditLine = await upgrades.deployProxy(
      creditLineFactory,
      [owner.address, lendingMarketAddress, tokenAddress],
      { kind: "uups" },
    ) as Contract;
    await creditLine.waitForDeployment();
    creditLine = connect(creditLine, owner); // Explicitly specifying the initial account
    const creditLineAddress = getAddress(creditLine);

    // Deploy the liquidity pool contract
    let liquidityPool = await upgrades.deployProxy(
      liquidityPoolFactory,
      [
        owner.address,
        tokenAddress,
      ],
      { kind: "uups" },
    ) as Contract;
    await liquidityPool.waitForDeployment();
    liquidityPool = connect(liquidityPool, owner); // Explicitly specifying the initial account
    const liquidityPoolAddress = getAddress(liquidityPool);

    return {
      lendingMarketFactory,
      creditLineFactory,
      liquidityPoolFactory,
      tokenFactory,

      token,
      lendingMarket,
      creditLine,
      liquidityPool,

      tokenAddress,
      lendingMarketAddress,
      creditLineAddress,
      liquidityPoolAddress,
    };
  }

  async function configureContracts(fixture: Fixture) {
    const { token, lendingMarket, lendingMarketAddress, creditLine, creditLineAddress } = fixture;
    const { liquidityPool, liquidityPoolAddress } = fixture;
    // Allowance
    await proveTx(connect(token, owner).approve(liquidityPoolAddress, ethers.MaxUint256));
    await proveTx(connect(token, borrower).approve(lendingMarketAddress, ethers.MaxUint256));

    // Configure contracts and create a lending program
    await proveTx(creditLine.grantRole(GRANTOR_ROLE, owner.address));
    await proveTx(creditLine.grantRole(ADMIN_ROLE, owner.address));
    await proveTx(lendingMarket.grantRole(GRANTOR_ROLE, owner.address));
    await proveTx(lendingMarket.grantRole(ADMIN_ROLE, owner.address));
    await proveTx(liquidityPool.grantRole(GRANTOR_ROLE, owner.address));
    await proveTx(liquidityPool.grantRole(LIQUIDITY_OPERATOR_ROLE, lendingMarketAddress));
    await proveTx(lendingMarket.createProgram(creditLineAddress, liquidityPoolAddress));

    // Configure addon treasure
    await proveTx(connect(token, addonTreasury).approve(lendingMarketAddress, MAX_ALLOWANCE));
    await proveTx(liquidityPool.setAddonTreasury(addonTreasury.address));

    // Mint token
    await proveTx(token.mint(owner.address, INITIAL_BALANCE));
    await proveTx(token.mint(borrower.address, INITIAL_BALANCE));
    await proveTx(token.mint(addonTreasury.address, INITIAL_BALANCE));

    // Configure liquidity pool and credit line
    await proveTx(liquidityPool.deposit(INITIAL_DEPOSIT));
    await proveTx(liquidityPool.approveSpender(lendingMarketAddress, MAX_ALLOWANCE));
  }

  async function runScenario(scenario: TestScenario): Promise<TestScenarioContext> {
    const context: TestScenarioContext = { ...testScenarioContextDefault, scenario, fixture };
    const { token, lendingMarket, liquidityPoolAddress } = context.fixture as Fixture;
    await prepareContractsForScenario(context);
    await manageLoansForScenario(context);
    context.poolBalanceAtStart = await token.balanceOf(liquidityPoolAddress);
    context.frozenStepIndexes = new Set(scenario.frozenStepIndexes);
    context.totalRepaymentAmount = scenario.repaymentAmounts.reduce((sum, amount) => sum + amount);

    for (let i = 0; i < scenario.repaymentAmounts.length; i++) {
      context.stepIndex = i;
      await manageLoanFreezingForScenario(context);
      await manageBlockTimestampForScenario(context);
      const loanPreviewBefore = await lendingMarket.getLoanPreview(context.loanId, 0);
      await repayLoanIfNeededForScenario(context);
      await checkLoanRepaymentForScenario(loanPreviewBefore, context);
    }
    await checkFinalPoolBalanceForScenario(context);
    await checkLoanRepaidAmountForScenario(context);
    await executeFinalActionIfNeededForScenario(context);

    return context;
  }

  async function prepareContractsForScenario(context: TestScenarioContext) {
    const { creditLine } = context.fixture as Fixture;
    const scenario = context.scenario;

    // Configure credit line
    const creditLineConfig: CreditLineConfig = createCreditLineConfig(scenario);
    await proveTx(creditLine.configureCreditLine(creditLineConfig));

    // Configure borrower
    const borrowerConfig: BorrowerConfig = createBorrowerConfig(scenario);
    await proveTx(creditLine[FUNC_CONFIGURE_BORROWER_NEW](borrower.address, borrowerConfig));
  }

  function createCreditLineConfig(scenario: TestScenario): CreditLineConfig {
    return {
      minDurationInPeriods: scenario.durationInPeriods,
      maxDurationInPeriods: scenario.durationInPeriods,
      minBorrowedAmount: scenario.borrowedAmount,
      maxBorrowedAmount: scenario.borrowedAmount,
      minInterestRatePrimary: scenario.interestRatePrimary,
      maxInterestRatePrimary: scenario.interestRatePrimary,
      minInterestRateSecondary: scenario.interestRateSecondary,
      maxInterestRateSecondary: scenario.interestRateSecondary,
      minAddonFixedRate: 0,
      maxAddonFixedRate: 0,
      minAddonPeriodRate: 0,
      maxAddonPeriodRate: 0,
      lateFeeRate: scenario.lateFeeRate,
    };
  }

  function createBorrowerConfig(scenario: TestScenario): BorrowerConfig {
    return {
      minBorrowedAmount: scenario.borrowedAmount,
      maxBorrowedAmount: scenario.borrowedAmount,
      minDurationInPeriods: scenario.durationInPeriods,
      maxDurationInPeriods: scenario.durationInPeriods,
      interestRatePrimary: scenario.interestRatePrimary,
      interestRateSecondary: scenario.interestRateSecondary,
      addonFixedRate: 0,
      addonPeriodRate: 0,
      borrowingPolicy: BorrowingPolicy.TotalActiveAmountLimit,
      expiration: 2 ** 32 - 1,
      lateFeePolicy: LateFeePolicy.Common,
      lateFeeRate: 0,
    };
  }

  async function isLoanClosed(lendingMarket: Contract, loanId: bigint): Promise<boolean> {
    const trackedBalance = (await lendingMarket.getLoanState(loanId)).trackedBalance;
    if (trackedBalance === undefined) {
      throw new Error("The 'trackedBalance' field does not exist in the loan state structure");
    }
    if (typeof trackedBalance !== "bigint") {
      throw new Error("The 'trackedBalance' field of the loan state structure has wrong type");
    }
    return trackedBalance === 0n;
  }

  async function manageLoansForScenario(context: TestScenarioContext) {
    const scenario: TestScenario = context.scenario;
    const { token, lendingMarket, liquidityPool } = context.fixture as Fixture;

    // Close a previous loan if it is not closed already
    const loanCounter = await lendingMarket.loanCounter();
    if (loanCounter > 0) {
      const previousLoanId = loanCounter - 1n;
      if (!(await isLoanClosed(lendingMarket, previousLoanId))) {
        await proveTx(lendingMarket.revokeLoan(previousLoanId));
      }
    }

    context.loanId = loanCounter;

    const liquidityPoolBalancesBefore = await liquidityPool.getBalances();
    expect(liquidityPoolBalancesBefore[1]).to.eq(0); // The addonsBalance must be zero because addonTreasury != 0

    const tx: Promise<TransactionResponse> = lendingMarket.takeLoanFor(
      borrower.address,
      PROGRAM_ID,
      scenario.borrowedAmount,
      scenario.addonAmount,
      scenario.durationInPeriods,
    );

    await expect(tx).to.changeTokenBalances(
      token,
      [lendingMarket, liquidityPool, borrower, addonTreasury, owner],
      [0, -(scenario.borrowedAmount + scenario.addonAmount), scenario.borrowedAmount, scenario.addonAmount, 0],
    );

    const liquidityPoolBalancesAfter = await liquidityPool.getBalances();
    expect(liquidityPoolBalancesAfter[0])
      .to.eq(Number(liquidityPoolBalancesBefore[0]) - scenario.borrowedAmount - scenario.addonAmount);
    expect(liquidityPoolBalancesAfter[1]).to.eq(0); // The addonsBalance must be zero because addonTreasury != 0

    const txReceipt = await proveTx(tx);
    context.loanTakingPeriod = calculateLoanPeriodIndex(await getBlockTimestamp(txReceipt.blockNumber));
  }

  async function manageLoanFreezingForScenario(context: TestScenarioContext) {
    const { lendingMarket } = context.fixture as Fixture;
    if (context.frozenStepIndexes.has(context.stepIndex)) {
      if (!context.frozenState) {
        await proveTx(lendingMarket.freeze(context.loanId));
        context.frozenState = true;
      }
    } else if (context.frozenState) {
      await proveTx(lendingMarket.unfreeze(context.loanId));
      context.frozenState = false;
    }
  }

  async function manageBlockTimestampForScenario(context: TestScenarioContext) {
    const targetLoanPeriod = context.loanTakingPeriod + (context.stepIndex + 1) * context.scenario.iterationStep;
    const targetTimestamp = calculateTimestampByLoanPeriodIndex(targetLoanPeriod);
    await increaseBlockTimestampTo(targetTimestamp);
  }

  async function repayLoanIfNeededForScenario(context: TestScenarioContext) {
    const { token, lendingMarket, liquidityPool } = context.fixture as Fixture;
    const repaymentAmount = context.scenario.repaymentAmounts[context.stepIndex] ?? 0;
    if (repaymentAmount != 0) {
      const liquidityPoolBalancesBefore = await liquidityPool.getBalances();
      await expect(
        connect(lendingMarket, borrower).repayLoan(context.loanId, repaymentAmount),
      ).to.changeTokenBalances(
        token,
        [lendingMarket, liquidityPool, borrower],
        [0, +repaymentAmount, -repaymentAmount],
      );
      const liquidityPoolBalancesAfter = await liquidityPool.getBalances();
      expect(liquidityPoolBalancesAfter[0] - liquidityPoolBalancesBefore[0]).to.eq(repaymentAmount);

      // The addonsBalance must be zero because addonTreasury != 0
      expect(liquidityPoolBalancesBefore[1]).to.eq(0);
      expect(liquidityPoolBalancesAfter[1]).to.eq(0);
    }
  }

  async function checkLoanRepaymentForScenario(
    loanPreviewBefore: Record<string, bigint>,
    context: TestScenarioContext,
  ) {
    const { lendingMarket } = context.fixture as Fixture;
    const scenario = context.scenario;
    const expectedBalanceBefore = scenario.expectedOutstandingBalancesBeforeRepayment[context.stepIndex] ?? 0;
    if (expectedBalanceBefore < 0) {
      // Do not check if the expected balance is negative
      return;
    }
    const loanPreviewAfter = await lendingMarket.getLoanPreview(context.loanId, 0);

    const actualBalanceBefore = Number(loanPreviewBefore.outstandingBalance);
    const actualBalanceAfter = Number(loanPreviewAfter.outstandingBalance);
    const repaymentAmount = scenario.repaymentAmounts[context.stepIndex] ?? 0;
    const expectedBalanceAfter = actualBalanceBefore - repaymentAmount;
    const differenceBefore = actualBalanceBefore - expectedBalanceBefore;
    const differenceAfter = actualBalanceAfter - expectedBalanceAfter;
    const actualRelativePrecision = Math.abs(differenceBefore / expectedBalanceBefore);
    const errorMessageBefore = `Balances mismatch before a repayment (` +
      `loan repayment index: ${context.stepIndex}; actual balance before: ${actualBalanceBefore}; ` +
      `expected balance before: ${expectedBalanceBefore}; difference: ${differenceBefore})`;
    const errorMessageAfter = `Balances mismatch after a repayment (` +
      `loan repayment index: ${context.stepIndex}; actual balance after: ${actualBalanceAfter}; ` +
      `expected balance after: ${expectedBalanceAfter}; difference: ${differenceAfter})`;

    expect(actualRelativePrecision).to.lessThanOrEqual(scenario.relativePrecision, errorMessageBefore);
    expect(actualBalanceAfter).to.eq(expectedBalanceAfter, errorMessageAfter);
  }

  async function checkFinalPoolBalanceForScenario(context: TestScenarioContext) {
    const { token, liquidityPoolAddress } = context.fixture as Fixture;
    context.poolBalanceAtFinish = await token.balanceOf(liquidityPoolAddress);
    expect(context.poolBalanceAtFinish - context.poolBalanceAtStart).to.eq(context.totalRepaymentAmount);
  }

  async function checkLoanRepaidAmountForScenario(context: TestScenarioContext) {
    const { lendingMarket } = context.fixture as Fixture;
    const loanState = await lendingMarket.getLoanState(context.loanId);
    expect(loanState.repaidAmount).to.eq(context.totalRepaymentAmount);
  }

  async function executeFinalActionIfNeededForScenario(context: TestScenarioContext) {
    switch (context.scenario.finalAction) {
      case ScenarioFinalAction.FullRepayment: {
        await executeAndCheckFullLoanRepaymentForScenario(context);
        break;
      }
      case ScenarioFinalAction.Revocation: {
        await executeAndCheckLoanRevocationForScenario(context);
        break;
      }
      case ScenarioFinalAction.FullRepaymentCheck: {
        const { lendingMarket } = context.fixture as Fixture;
        await checkLoanClosedState(lendingMarket, context.loanId);
        break;
      }
      default: {
        // do nothing
      }
    }
  }

  async function executeAndCheckFullLoanRepaymentForScenario(context: TestScenarioContext) {
    const { token, lendingMarket, liquidityPool } = context.fixture as Fixture;
    const outstandingBalance = (await lendingMarket.getLoanPreview(context.loanId, 0)).outstandingBalance;
    const liquidityPoolBalancesBefore = await liquidityPool.getBalances();
    await expect(
      connect(lendingMarket, borrower).repayLoan(context.loanId, ethers.MaxUint256),
    ).changeTokenBalances(
      token,
      [lendingMarket, liquidityPool, borrower],
      [0, outstandingBalance, -outstandingBalance],
    );
    const liquidityPoolBalancesAfter = await liquidityPool.getBalances();
    expect(liquidityPoolBalancesAfter[0] - liquidityPoolBalancesBefore[0]).to.eq(outstandingBalance);

    // The addonsBalance must be zero because addonTreasury != 0
    expect(liquidityPoolBalancesBefore[1]).to.eq(0);
    expect(liquidityPoolBalancesAfter[1]).to.eq(0);
    await checkLoanClosedState(lendingMarket, context.loanId);
  }

  async function executeAndCheckLoanRevocationForScenario(context: TestScenarioContext) {
    const { token, lendingMarket, liquidityPool } = context.fixture as Fixture;
    const scenario = context.scenario;
    const loanState = await lendingMarket.getLoanState(context.loanId);
    const refundAmount = Number(loanState.repaidAmount) - scenario.borrowedAmount;

    const liquidityPoolBalancesBefore = await liquidityPool.getBalances();
    expect(liquidityPoolBalancesBefore[1]).to.eq(0); // The addonsBalance must be zero because addonTreasury != 0

    await expect(
      lendingMarket.revokeLoan(context.loanId),
    ).to.changeTokenBalances(
      token,
      [lendingMarket, liquidityPool, borrower, addonTreasury],
      [0, -refundAmount + scenario.addonAmount, refundAmount, -scenario.addonAmount],
    );

    const liquidityPoolBalancesAfter = await liquidityPool.getBalances();
    expect(liquidityPoolBalancesAfter[0])
      .to.eq(Number(liquidityPoolBalancesBefore[0]) - refundAmount + scenario.addonAmount);
    expect(liquidityPoolBalancesAfter[1]).to.eq(0); // The addonsBalance must be zero because addonTreasury != 0

    await checkLoanRepaidAmountForScenario(context);
    await checkLoanClosedState(lendingMarket, context.loanId);
  }

  async function checkLoanClosedState(lendingMarket: Contract, loanId: bigint) {
    const loanState = await lendingMarket.getLoanState(loanId);
    const loanPreview = await lendingMarket.getLoanPreview(loanId, 0);
    expect(loanState.trackedBalance).to.eq(0);
    expect(loanPreview.trackedBalance).to.eq(0);
    expect(loanPreview.outstandingBalance).to.eq(0);
  }

  describe("Complex scenarios", async () => {
    it("Scenario 1: a typical loan with short freezing after defaulting and full repayment at the end", async () => {
      const principalAmount = 1e9; // 1000 BRLC
      const addonAmount = Math.floor(principalAmount * 0.2);
      const borrowedAmount = principalAmount - addonAmount;
      const interestRatePrimary = 2_724_943; // 170 % annual
      const interestRateSecondary = 4_067440; // 340 % annual

      const repaymentAmounts: number[] = Array(12).fill(170_000_000); // 170 BRLC
      repaymentAmounts[2] = 0;
      repaymentAmounts[3] = 0;

      const frozenStepIndexes: number[] = [8, 9];

      const expectedOutstandingBalancesBeforeRepayment: number[] = [

        // The numbers below are taken from the spreadsheet:
        // https://docs.google.com/spreadsheets/d/148elvx9Yd0QuaDtc7AkaelIn3t5rvZCx5iG2ceVfpe8
        1085060000, 992900000, 892900000, 968850000, 1051260000, 956220000,
        905800000, 831090000, 661090000, 491090000, 362670000, 217620000,

      ];

      const scenario: TestScenario = {
        ...testScenarioDefault,
        borrowedAmount,
        addonAmount,
        interestRatePrimary,
        interestRateSecondary,
        repaymentAmounts,
        expectedOutstandingBalancesBeforeRepayment,
        frozenStepIndexes,
        finalAction: ScenarioFinalAction.FullRepayment,
      };
      await runScenario(scenario);
    });

    it("Scenario 2: a typical loan with short freezing and repayments only after defaulting", async () => {
      const principalAmount = 1e9; // 1000 BRLC, no addon amount
      const addonAmount = 0;
      const borrowedAmount = principalAmount - addonAmount;
      const interestRatePrimary = 2_724_943; // 170 % annual
      const interestRateSecondary = 4_067440; // 340 % annual

      const repaymentAmounts: number[] = Array(12).fill(0); // 0 BRLC
      repaymentAmounts[10] = 1500_000_000; // 1500 BRLC
      repaymentAmounts[11] = 1_015_150_000; // 1015.15 BRLC

      const frozenStepIndexes: number[] = [2, 3];

      const expectedOutstandingBalancesBeforeRepayment: number[] = [

        // The numbers below are taken from the spreadsheet:
        // https://docs.google.com/spreadsheets/d/148elvx9Yd0QuaDtc7AkaelIn3t5rvZCx5iG2ceVfpe8
        1085060000, 1177360000, 1177360000, 1177360000, 1277510000, 1386180000,
        1504090000, 1632030000, 1880240000, 2123740000, 2398760000, 1015150000,

      ];

      const scenario: TestScenario = {
        ...testScenarioDefault,
        borrowedAmount,
        interestRatePrimary,
        interestRateSecondary,
        repaymentAmounts,
        expectedOutstandingBalancesBeforeRepayment,
        frozenStepIndexes,
        finalAction: ScenarioFinalAction.FullRepaymentCheck,
      };
      await runScenario(scenario);
    });

    it("Scenario 3: a big loan with big rates, lots of small repayments and revocation at the end", async () => {
      const principalAmount = 1e12; // 1000_000 BRLC
      const addonAmount = Math.floor(principalAmount * 0.1);
      const borrowedAmount = principalAmount - addonAmount;
      const interestRatePrimary = 4_219_472; // 365 % annual
      const interestRateSecondary = 5_814_801; // 730 % annual

      const repaymentAmounts: number[] = Array(24).fill(100_000_000); // 100 BRLC

      const frozenStepIndexes: number[] = [];

      const expectedOutstandingBalancesBeforeRepayment: number[] = [

        // The numbers below are taken from the spreadsheet:
        // https://docs.google.com/spreadsheets/d/148elvx9Yd0QuaDtc7AkaelIn3t5rvZCx5iG2ceVfpe8
        1134642760000, 1287300730000, 1460512990000, 1657047030000, 1880042950000, 2133063660000,
        2588953760000, 3080691310000, 3665850520000, 4362179870000, 5190799790000, 6176843200000,
        7350217850000, 8746513440000, 10408081090000, 12385317940000, 14738195680000, 17538079600000,
        20869893150000, 24834693800000, 29552738180000, 35167129580000, 41848158500000, 49798467640000,

      ];

      const scenario: TestScenario = {
        ...testScenarioDefault,
        borrowedAmount,
        addonAmount,
        interestRatePrimary,
        interestRateSecondary,
        repaymentAmounts,
        expectedOutstandingBalancesBeforeRepayment,
        frozenStepIndexes,
        finalAction: ScenarioFinalAction.Revocation,
      };
      await runScenario(scenario);
    });

    it("Scenario 4: a small loan with low rates, lots of repayments leading to the full repayment", async () => {
      const principalAmount = 1e6; // 1 BRLC
      const addonAmount = 1e4;
      const borrowedAmount = principalAmount - addonAmount;
      const interestRatePrimary = 261_157; // 10 % annual
      const interestRateSecondary = 499_635; // 20 % annual

      const repaymentAmounts: number[] = Array(12).fill(90_000); // 0.09 BRLC
      repaymentAmounts[repaymentAmounts.length - 1] = 80_000; // 0.08 BRLC

      const frozenStepIndexes: number[] = [];

      const expectedOutstandingBalancesBeforeRepayment: number[] = [

        // The numbers below are taken from the spreadsheet:
        // https://docs.google.com/spreadsheets/d/148elvx9Yd0QuaDtc7AkaelIn3t5rvZCx5iG2ceVfpe8
        1010000, 930000, 840000, 760000, 670000, 590000,
        520000, 430000, 350000, 260000, 170000, 80000,

      ];

      const scenario: TestScenario = {
        ...testScenarioDefault,
        borrowedAmount,
        addonAmount,
        interestRatePrimary,
        interestRateSecondary,
        repaymentAmounts,
        expectedOutstandingBalancesBeforeRepayment,
        frozenStepIndexes,
        finalAction: ScenarioFinalAction.FullRepaymentCheck,
      };
      await runScenario(scenario);
    });
  });
});
