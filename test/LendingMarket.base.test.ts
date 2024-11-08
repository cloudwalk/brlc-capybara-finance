import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory, TransactionReceipt, TransactionResponse } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  connect,
  getAddress,
  getBlockTimestamp,
  getLatestBlockTimestamp,
  getTxTimestamp,
  increaseBlockTimestampTo,
  proveTx
} from "../test-utils/eth";
import { checkEquality, setUpFixture } from "../test-utils/common";

interface LoanTerms {
  token: string;
  addonAmount: number;
  durationInPeriods: number;
  interestRatePrimary: number;
  interestRateSecondary: number;
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

  [key: string]: string | number; // Index signature
}

interface LoanPreview {
  periodIndex: number;
  trackedBalance: number;
  outstandingBalance: number;

  [key: string]: number; // Index signature
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
const ERROR_NAME_CREDIT_LINE_LENDER_NOT_CONFIGURED = "CreditLineLenderNotConfigured";
const ERROR_NAME_ENFORCED_PAUSED = "EnforcedPause";
const ERROR_NAME_LOAN_ALREADY_FROZEN = "LoanAlreadyFrozen";
const ERROR_NAME_LOAN_ALREADY_REPAID = "LoanAlreadyRepaid";
const ERROR_NAME_LOAN_NOT_EXIST = "LoanNotExist";
const ERROR_NAME_LOAN_NOT_FROZEN = "LoanNotFrozen";
const ERROR_NAME_INAPPROPRIATE_DURATION_IN_PERIODS = "InappropriateLoanDuration";
const ERROR_NAME_INAPPROPRIATE_INTEREST_RATE = "InappropriateInterestRate";
const ERROR_NAME_INVALID_AMOUNT = "InvalidAmount";
const ERROR_NAME_NOT_PAUSED = "ExpectedPause";
const ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED = "AccessControlUnauthorizedAccount";
const ERROR_NAME_UNAUTHORIZED = "Unauthorized";
const ERROR_NAME_ZERO_ADDRESS = "ZeroAddress";
const ERROR_NAME_PROGRAM_NOT_EXIST = "ProgramNotExist";
const ERROR_NAME_COOLDOWN_PERIOD_PASSED = "CooldownPeriodHasPassed";
const ERROR_NAME_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST = "SafeCastOverflowedUintDowncast";

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
const EVENT_NAME_LOAN_UNFROZEN = "LoanUnfrozen";
const EVENT_NAME_ON_BEFORE_LOAN_TAKEN = "OnBeforeLoanTakenCalled";
const EVENT_NAME_ON_AFTER_LOAN_PAYMENT = "OnAfterLoanPaymentCalled";
const EVENT_NAME_PAUSED = "Paused";
const EVENT_NAME_UNPAUSED = "Unpaused";
const EVENT_NAME_LOAN_REVOKED = "LoanRevoked";
const EVENT_NAME_ON_AFTER_LOAN_REVOCATION = "OnAfterLoanRevocationCalled";

const OWNER_ROLE = ethers.id("OWNER_ROLE");

const ZERO_ADDRESS = ethers.ZeroAddress;
const BORROW_AMOUNT = 100_000;
const REPAY_AMOUNT = 50_000;
const FULL_REPAY_AMOUNT = ethers.MaxUint256;
const MINT_AMOUNT = 1000_000_000_000;
const BORROWER_SUPPLY_AMOUNT = 100_000;
const DEPOSIT_AMOUNT = 1000_000_000;
const DEFAULT_INTEREST_RATE_PRIMARY = 10;
const DEFAULT_INTEREST_RATE_SECONDARY = 20;
const DEFAULT_INTEREST_RATE_FACTOR = 10 ** 9;
const DEFAULT_PERIOD_IN_SECONDS = 86400;
const DEFAULT_DURATION_IN_PERIODS = 10;
const DEFAULT_ADDON_AMOUNT = 1000;
const DEFAULT_LOAN_ID = 0;
const NON_EXISTENT_LOAN_ID = ethers.MaxUint256;
const ALIAS_STATUS_CONFIGURED = true;
const ALIAS_STATUS_NOT_CONFIGURED = false;
const DEFAULT_PROGRAM_ID = 1;
const NEGATIVE_TIME_OFFSET = 10800; // 3 hours
const ACCURACY_FACTOR = 10000;
const COOLDOWN_IN_PERIODS = 3;
const EXPECTED_VERSION: Version = {
  major: 1,
  minor: 0,
  patch: 0
};

describe("Contract 'LendingMarket': base tests", async () => {
  let lendingMarketFactory: ContractFactory;
  let creditLineFactory: ContractFactory;
  let liquidityPoolFactory: ContractFactory;
  let tokenFactory: ContractFactory;

  let creditLine: Contract;
  let liquidityPool: Contract;
  let token: Contract;

  let owner: HardhatEthersSigner;
  let lender: HardhatEthersSigner;
  let borrower: HardhatEthersSigner;
  let alias: HardhatEthersSigner;
  let attacker: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;

  let creditLineAddress: string;
  let liquidityPoolAddress: string;
  let tokenAddress: string;

  before(async () => {
    [owner, lender, borrower, alias, attacker, stranger] = await ethers.getSigners();

    // Factories with an explicitly specified deployer account
    lendingMarketFactory = await ethers.getContractFactory("LendingMarket");
    lendingMarketFactory = lendingMarketFactory.connect(owner);
    creditLineFactory = await ethers.getContractFactory("CreditLineMock");
    creditLineFactory = creditLineFactory.connect(owner);
    liquidityPoolFactory = await ethers.getContractFactory("LiquidityPoolMock");
    liquidityPoolFactory = liquidityPoolFactory.connect(owner);
    tokenFactory = await ethers.getContractFactory("ERC20Mock");
    tokenFactory = tokenFactory.connect(owner);

    creditLine = await creditLineFactory.deploy() as Contract;
    await creditLine.waitForDeployment();
    creditLine = connect(creditLine, owner); // Explicitly specifying the initial account
    creditLineAddress = getAddress(creditLine);

    liquidityPool = await liquidityPoolFactory.deploy() as Contract;
    await liquidityPool.waitForDeployment();
    liquidityPool = connect(liquidityPool, owner); // Explicitly specifying the initial account
    liquidityPoolAddress = getAddress(liquidityPool);

    token = await tokenFactory.deploy() as Contract;
    await token.waitForDeployment();
    token = connect(token, owner); // Explicitly specifying the initial account
    tokenAddress = getAddress(token);

    // Start tests at the beginning of a loan period to avoid rare failures due to crossing a border between two periods
    const periodIndex = calculatePeriodIndex(await getLatestBlockTimestamp());
    const nextPeriodTimestamp = (periodIndex + 1) * DEFAULT_PERIOD_IN_SECONDS;
    await increaseBlockTimestampTo(nextPeriodTimestamp);
  });

  function createMockTerms(): LoanTerms {
    return {
      token: tokenAddress,
      addonAmount: DEFAULT_ADDON_AMOUNT,
      durationInPeriods: DEFAULT_DURATION_IN_PERIODS,
      interestRatePrimary: DEFAULT_INTEREST_RATE_PRIMARY,
      interestRateSecondary: DEFAULT_INTEREST_RATE_SECONDARY
    };
  }

  function createInitialLoanState(timestamp: number, addonAmount: number = DEFAULT_ADDON_AMOUNT): LoanState {
    return {
      programId: DEFAULT_PROGRAM_ID,
      borrowAmount: BORROW_AMOUNT,
      addonAmount: addonAmount,
      startTimestamp: timestamp,
      durationInPeriods: DEFAULT_DURATION_IN_PERIODS,
      token: tokenAddress,
      borrower: borrower.address,
      interestRatePrimary: DEFAULT_INTEREST_RATE_PRIMARY,
      interestRateSecondary: DEFAULT_INTEREST_RATE_SECONDARY,
      repaidAmount: 0,
      trackedBalance: BORROW_AMOUNT + addonAmount,
      trackedTimestamp: timestamp,
      freezeTimestamp: 0
    };
  }

  function calculateOutstandingBalance(
    originalBalance: number,
    numberOfPeriods: number,
    interestRate: number
  ): number {
    const outstandingBalance =
      originalBalance * Math.pow(1 + interestRate / DEFAULT_INTEREST_RATE_FACTOR, numberOfPeriods);
    return Math.round(outstandingBalance);
  }

  function calculatePeriodIndex(timestamp: number): number {
    return Math.floor(timestamp / DEFAULT_PERIOD_IN_SECONDS);
  }

  function calculateTimestampWithOffset(timestamp: number) {
    return timestamp - NEGATIVE_TIME_OFFSET;
  }

  function defineLoanPreview(loanState: LoanState, timestamp: number, repaymentsAmount: number): LoanPreview {
    let outstandingBalance = loanState.borrowAmount;
    if (loanState.freezeTimestamp != 0) {
      timestamp = loanState.freezeTimestamp;
    }
    const periodIndex = calculatePeriodIndex(timestamp);
    const trackedPeriodIndex = calculatePeriodIndex(loanState.trackedTimestamp);
    const startPeriodIndex = calculatePeriodIndex(loanState.startTimestamp);
    const duePeriodIndex = startPeriodIndex + loanState.durationInPeriods;
    const numberOfPeriods = periodIndex - trackedPeriodIndex;
    const trackedBalance = loanState.borrowAmount + loanState.addonAmount;
    const numberOfPeriodsWithSecondaryRate = periodIndex - duePeriodIndex;
    const numberOfPeriodsWithPrimaryRate = numberOfPeriodsWithSecondaryRate > 0
      ? numberOfPeriods - numberOfPeriodsWithSecondaryRate
      : numberOfPeriods;

    if (numberOfPeriodsWithPrimaryRate > 0) {
      outstandingBalance = calculateOutstandingBalance(
        outstandingBalance,
        numberOfPeriodsWithPrimaryRate,
        loanState.interestRatePrimary
      );
    }
    if (numberOfPeriodsWithSecondaryRate > 0) {
      outstandingBalance = calculateOutstandingBalance(
        outstandingBalance,
        numberOfPeriodsWithSecondaryRate,
        loanState.interestRateSecondary
      );
    }
    return {
      periodIndex,
      trackedBalance: trackedBalance - repaymentsAmount,
      outstandingBalance: outstandingBalance
    };
  }

  async function deployLendingMarket(): Promise<{ market: Contract; marketUnderLender: Contract }> {
    let market = await upgrades.deployProxy(lendingMarketFactory, [owner.address]);

    market = connect(market, owner); // Explicitly specifying the initial account
    const marketUnderLender = connect(market, lender);

    return {
      market,
      marketUnderLender
    };
  }

  async function deployLendingMarketAndConfigureItForLoan(): Promise<{
    market: Contract;
    marketUnderLender: Contract;
  }> {
    const { market, marketUnderLender } = await deployLendingMarket();

    // register and configure a credit line & liquidity pool
    await proveTx(marketUnderLender.registerCreditLine(creditLineAddress));
    await proveTx(marketUnderLender.registerLiquidityPool(liquidityPoolAddress));
    await proveTx(marketUnderLender.createProgram(creditLineAddress, liquidityPoolAddress));

    // configure an alias
    await proveTx(marketUnderLender.configureAlias(alias.address, ALIAS_STATUS_CONFIGURED));

    // mock configurations
    await proveTx(creditLine.mockTokenAddress(tokenAddress));
    await proveTx(creditLine.mockLoanTerms(borrower.address, BORROW_AMOUNT, createMockTerms()));

    // supply tokens
    await proveTx(token.mint(lender.address, MINT_AMOUNT));
    await proveTx(token.mint(stranger.address, MINT_AMOUNT));
    await proveTx(connect(token, lender).transfer(liquidityPoolAddress, DEPOSIT_AMOUNT));
    await proveTx(liquidityPool.approveMarket(getAddress(market), tokenAddress));
    await proveTx(connect(token, borrower).approve(getAddress(market), ethers.MaxUint256));
    await proveTx(connect(token, stranger).approve(getAddress(market), ethers.MaxUint256));

    return {
      market,
      marketUnderLender
    };
  }

  async function deployLendingMarketAndTakeLoan(): Promise<{
    market: Contract;
    marketConnectedToLender: Contract;
    initialLoanState: LoanState;
  }> {
    const { market } = await deployLendingMarketAndConfigureItForLoan();
    const marketConnectedToLender = connect(market, lender);

    await proveTx(token.mint(borrower.address, BORROWER_SUPPLY_AMOUNT));
    const txReceipt: TransactionReceipt = await proveTx(connect(market, borrower).takeLoan(
      DEFAULT_PROGRAM_ID,
      BORROW_AMOUNT,
      DEFAULT_DURATION_IN_PERIODS
    ));
    const timestampWithOffset = calculateTimestampWithOffset(await getBlockTimestamp(txReceipt.blockNumber));
    const initialLoanState = createInitialLoanState(timestampWithOffset);

    return {
      market,
      marketConnectedToLender,
      initialLoanState
    };
  }

  describe("Function initialize()", async () => {
    it("Configures the contract as expected", async () => {
      const { market } = await setUpFixture(deployLendingMarket);
      expect(await market.hasRole(OWNER_ROLE, owner.address)).to.eq(true);
      expect(await market.paused()).to.eq(false);

      // Check the period calculation logic of the contract
      const someTimestamp = 123456789;
      expect(
        await market.calculatePeriodIndex(someTimestamp, DEFAULT_PERIOD_IN_SECONDS)
      ).to.eq(calculatePeriodIndex(someTimestamp));
    });

    it("Is reverted if called a second time", async () => {
      const { market } = await setUpFixture(deployLendingMarket);

      await expect(market.initialize(owner.address))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ALREADY_INITIALIZED);
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

      await expect(market.pause())
        .to.emit(market, EVENT_NAME_PAUSED)
        .withArgs(owner.address);
      expect(await market.paused()).to.eq(true);
    });

    it("Is reverted if the caller is not the owner", async () => {
      const { market } = await setUpFixture(deployLendingMarket);

      await expect(connect(market, attacker).pause())
        .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(attacker.address, OWNER_ROLE);
    });

    it("Is reverted if the contract is already paused", async () => {
      const { market } = await setUpFixture(deployLendingMarket);

      await proveTx(market.pause());
      await expect(market.pause())
        .to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
    });
  });

  describe("Function 'unpause()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { market } = await setUpFixture(deployLendingMarket);

      await proveTx(market.pause());
      expect(await market.paused()).to.eq(true);

      await expect(market.unpause())
        .to.emit(market, EVENT_NAME_UNPAUSED)
        .withArgs(owner.address);

      expect(await market.paused()).to.eq(false);
    });

    it("Is reverted if the caller is not the owner", async () => {
      const { market } = await setUpFixture(deployLendingMarket);

      await expect(connect(market, attacker).unpause())
        .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(attacker.address, OWNER_ROLE);
    });

    it("Is reverted if the contract is not paused yet", async () => {
      const { market } = await setUpFixture(deployLendingMarket);

      await expect(market.unpause())
        .to.be.revertedWithCustomError(market, ERROR_NAME_NOT_PAUSED);
    });
  });

  describe("Function 'registerCreditLine()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { marketUnderLender } = await setUpFixture(deployLendingMarket);

      await expect(marketUnderLender.registerCreditLine(creditLineAddress))
        .to.emit(marketUnderLender, EVENT_NAME_CREDIT_LINE_REGISTERED)
        .withArgs(lender.address, creditLineAddress);

      expect(await marketUnderLender.getCreditLineLender(creditLineAddress)).to.eq(lender.address);
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
  });

  describe("Function 'registerLiquidityPool()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { marketUnderLender } = await setUpFixture(deployLendingMarket);

      await expect(marketUnderLender.registerLiquidityPool(liquidityPoolAddress))
        .to.emit(marketUnderLender, EVENT_NAME_LIQUIDITY_POOL_REGISTERED)
        .withArgs(lender.address, liquidityPoolAddress);

      expect(await marketUnderLender.getLiquidityPoolLender(liquidityPoolAddress)).to.eq(lender.address);
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
  });

  describe("Function 'createProgram()'", async () => {
    it("Executes as expected and emits the correct events", async () => {
      const { marketUnderLender } = await setUpFixture(deployLendingMarket);
      await proveTx(marketUnderLender.registerCreditLine(creditLineAddress));
      await proveTx(marketUnderLender.registerLiquidityPool(liquidityPoolAddress));

      await expect(marketUnderLender.createProgram(creditLineAddress, liquidityPoolAddress))
        .to.emit(marketUnderLender, EVENT_NAME_PROGRAM_CREATED)
        .withArgs(lender.address, DEFAULT_PROGRAM_ID)
        .and.to.emit(marketUnderLender, EVENT_NAME_PROGRAM_UPDATED)
        .withArgs(DEFAULT_PROGRAM_ID, creditLineAddress, liquidityPoolAddress);

      expect(await marketUnderLender.getProgramLender(DEFAULT_PROGRAM_ID)).to.eq(lender.address);
      expect(await marketUnderLender.getProgramCreditLine(DEFAULT_PROGRAM_ID)).to.eq(creditLineAddress);
      expect(await marketUnderLender.getProgramLiquidityPool(DEFAULT_PROGRAM_ID)).to.eq(liquidityPool);
    });

    it("Is reverted if the contract is paused", async () => {
      const { market } = await setUpFixture(deployLendingMarket);
      await proveTx(market.pause());

      await expect(market.createProgram(creditLineAddress, liquidityPoolAddress))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the credit line address is zero", async () => {
      const { market } = await setUpFixture(deployLendingMarket);

      await expect(market.createProgram(ZERO_ADDRESS, liquidityPoolAddress))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ZERO_ADDRESS);
    });

    it("Is reverted if the liquidity pool address is zero", async () => {
      const { market } = await setUpFixture(deployLendingMarket);

      await expect(market.createProgram(creditLineAddress, ZERO_ADDRESS))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ZERO_ADDRESS);
    });

    it("Is reverted if the credit line is registered by other lender", async () => {
      const { market, marketUnderLender } = await setUpFixture(deployLendingMarket);
      await proveTx(marketUnderLender.registerCreditLine(creditLineAddress));

      await expect(connect(market, attacker).createProgram(creditLineAddress, liquidityPoolAddress))
        .to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
    });

    it("Is reverted if the liquidityPool is registered by other lender", async () => {
      const { market, marketUnderLender } = await setUpFixture(deployLendingMarket);
      await proveTx(connect(market, attacker).registerCreditLine(creditLineAddress));
      await proveTx(marketUnderLender.registerLiquidityPool(liquidityPoolAddress));

      await expect(connect(market, attacker).createProgram(creditLineAddress, liquidityPoolAddress))
        .to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
    });
  });

  describe("Function 'updateProgram()'", async () => {
    it("Executes as expected and emits correct event", async () => {
      const { market, marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);

      await proveTx(marketUnderLender.registerCreditLine(stranger.address));
      await proveTx(marketUnderLender.registerLiquidityPool(stranger.address));

      await expect(marketUnderLender.updateProgram(DEFAULT_PROGRAM_ID, stranger.address, liquidityPoolAddress))
        .to.emit(marketUnderLender, EVENT_NAME_PROGRAM_UPDATED)
        .withArgs(DEFAULT_PROGRAM_ID, stranger.address, liquidityPoolAddress);

      expect(await market.getProgramCreditLine(DEFAULT_PROGRAM_ID)).to.eq(stranger.address);

      await expect(marketUnderLender.updateProgram(DEFAULT_PROGRAM_ID, creditLineAddress, stranger.address))
        .to.emit(marketUnderLender, EVENT_NAME_PROGRAM_UPDATED)
        .withArgs(DEFAULT_PROGRAM_ID, creditLineAddress, stranger.address);

      expect(await market.getProgramLiquidityPool(DEFAULT_PROGRAM_ID)).to.eq(stranger.address);
    });

    it("Is reverted if contract is paused", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
      await proveTx(market.pause());

      await expect(market.updateProgram(DEFAULT_PROGRAM_ID, creditLineAddress, liquidityPoolAddress))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if program with the provided id does not exist", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);

      await expect(market.updateProgram(0, creditLineAddress, liquidityPoolAddress))
        .to.be.revertedWithCustomError(market, ERROR_NAME_PROGRAM_NOT_EXIST);
    });

    it("Is reverted if caller is not the lender of the program", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);

      await expect(connect(market, attacker).updateProgram(DEFAULT_PROGRAM_ID, creditLineAddress, liquidityPoolAddress))
        .to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
    });

    it("Is reverted if caller is not the lender of the creditLine", async () => {
      const { market, marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
      await proveTx(market.registerCreditLine(stranger.address));

      await expect(marketUnderLender.updateProgram(DEFAULT_PROGRAM_ID, stranger.address, liquidityPoolAddress))
        .to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
    });

    it("Is reverted if caller is not the lender of the liquidity pool", async () => {
      const { market, marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
      await proveTx(market.registerLiquidityPool(stranger.address));

      await expect(marketUnderLender.updateProgram(DEFAULT_PROGRAM_ID, creditLineAddress, stranger.address))
        .to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
    });
  });

  describe("Function 'takeLoan()'", async () => {
    it("Executes as expected and emits the correct events", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);

      const TOTAL_BORROW_AMOUNT = BORROW_AMOUNT + DEFAULT_ADDON_AMOUNT;

      // Check the returned value of the function for the first loan
      const expectedLoanId: bigint = await connect(market, borrower).takeLoan.staticCall(
        DEFAULT_PROGRAM_ID,
        BORROW_AMOUNT,
        DEFAULT_DURATION_IN_PERIODS
      );
      expect(expectedLoanId).to.eq(DEFAULT_LOAN_ID);

      const tx: Promise<TransactionResponse> = connect(market, borrower).takeLoan(
        DEFAULT_PROGRAM_ID,
        BORROW_AMOUNT,
        DEFAULT_DURATION_IN_PERIODS
      );
      const txReceipt = await proveTx(tx);
      const submittedLoan: LoanState = await market.getLoanState(DEFAULT_LOAN_ID);
      const timestampWithOffset = calculateTimestampWithOffset(await getBlockTimestamp(txReceipt.blockNumber));
      const expectedLoan: LoanState = createInitialLoanState(timestampWithOffset);

      checkEquality(submittedLoan, expectedLoan);

      await expect(tx).to.changeTokenBalances(
        token,
        [liquidityPool, borrower],
        [-BORROW_AMOUNT, +BORROW_AMOUNT]
      );

      await expect(tx)
        .to.emit(market, EVENT_NAME_LOAN_TAKEN)
        .withArgs(DEFAULT_LOAN_ID, borrower.address, TOTAL_BORROW_AMOUNT, DEFAULT_DURATION_IN_PERIODS);

      // Check that the appropriate market hook functions are called
      await expect(tx)
        .to.emit(liquidityPool, EVENT_NAME_ON_BEFORE_LOAN_TAKEN)
        .withArgs(DEFAULT_LOAN_ID);

      // Check the returned value of the function for the second loan
      const nextExpectedLoanId: bigint = await connect(market, borrower).takeLoan.staticCall(
        DEFAULT_PROGRAM_ID,
        BORROW_AMOUNT,
        DEFAULT_DURATION_IN_PERIODS
      );
      expect(nextExpectedLoanId).to.eq(DEFAULT_LOAN_ID + 1);
    });

    it("Is reverted if the contract is paused", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
      await proveTx(market.pause());

      await expect(
        connect(market, borrower).takeLoan(DEFAULT_PROGRAM_ID, BORROW_AMOUNT, DEFAULT_DURATION_IN_PERIODS)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if program with the passed id does not exist", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);

      await expect(market.takeLoan(0, BORROW_AMOUNT, DEFAULT_DURATION_IN_PERIODS))
        .to.be.revertedWithCustomError(market, ERROR_NAME_PROGRAM_NOT_EXIST);
    });

    it("Is reverted if the borrow amount is zero", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);

      await expect(market.takeLoan(DEFAULT_PROGRAM_ID, 0, DEFAULT_DURATION_IN_PERIODS))
        .to.be.revertedWithCustomError(market, ERROR_NAME_INVALID_AMOUNT);
    });

    it("Is reverted if the borrow amount is less than accuracy factor", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);

      await expect(market.takeLoan(DEFAULT_PROGRAM_ID, ACCURACY_FACTOR - 1, DEFAULT_DURATION_IN_PERIODS))
        .to.be.revertedWithCustomError(market, ERROR_NAME_INVALID_AMOUNT);
    });

    it("Is reverted if the credit line is not registered", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);

      await expect(market.takeLoan(DEFAULT_PROGRAM_ID + 1, BORROW_AMOUNT, DEFAULT_DURATION_IN_PERIODS))
        .to.be.revertedWithCustomError(market, ERROR_NAME_CREDIT_LINE_LENDER_NOT_CONFIGURED);
    });
  });

  describe("Function 'takeLoanFor()'", async () => {
    it("Executes as expected and emits the correct events", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);

      const addonAmount = BORROW_AMOUNT / 100;
      const totalBorrowAmount = BORROW_AMOUNT + addonAmount;

      // Check the returned value of the function for the first loan initiated by the lender
      let expectedLoanId: bigint = await connect(market, lender).takeLoanFor.staticCall(
        borrower.address,
        DEFAULT_PROGRAM_ID,
        BORROW_AMOUNT,
        addonAmount,
        DEFAULT_DURATION_IN_PERIODS
      );
      expect(expectedLoanId).to.eq(DEFAULT_LOAN_ID);

      // Check the returned value of the function for the first loan initiated by the alias
      expectedLoanId = await connect(market, alias).takeLoanFor.staticCall(
        borrower.address,
        DEFAULT_PROGRAM_ID,
        BORROW_AMOUNT,
        addonAmount,
        DEFAULT_DURATION_IN_PERIODS
      );
      expect(expectedLoanId).to.eq(DEFAULT_LOAN_ID);

      const tx: Promise<TransactionResponse> = connect(market, lender).takeLoanFor(
        borrower.address,
        DEFAULT_PROGRAM_ID,
        BORROW_AMOUNT,
        addonAmount,
        DEFAULT_DURATION_IN_PERIODS
      );
      const txReceipt: TransactionReceipt = await proveTx(tx);
      const submittedLoan: LoanState = await market.getLoanState(DEFAULT_LOAN_ID);
      const timestampWithOffset = calculateTimestampWithOffset(await getBlockTimestamp(txReceipt.blockNumber));
      const expectedLoan: LoanState = createInitialLoanState(timestampWithOffset, addonAmount);

      checkEquality(submittedLoan, expectedLoan);

      await expect(tx).to.changeTokenBalances(
        token,
        [liquidityPool, borrower],
        [-BORROW_AMOUNT, +BORROW_AMOUNT]
      );

      await expect(tx)
        .to.emit(market, EVENT_NAME_LOAN_TAKEN)
        .withArgs(DEFAULT_LOAN_ID, borrower.address, totalBorrowAmount, DEFAULT_DURATION_IN_PERIODS);

      // Check that the appropriate market hook functions are called
      await expect(tx)
        .to.emit(liquidityPool, EVENT_NAME_ON_BEFORE_LOAN_TAKEN)
        .withArgs(DEFAULT_LOAN_ID);

      // Check the returned value of the function for the second loan
      const nextExpectedLoanId: bigint = await connect(market, borrower).takeLoan.staticCall(
        DEFAULT_PROGRAM_ID,
        BORROW_AMOUNT,
        DEFAULT_DURATION_IN_PERIODS
      );
      expect(nextExpectedLoanId).to.eq(DEFAULT_LOAN_ID + 1);
    });

    it("Is reverted if the contract is paused", async () => {
      const { market, marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
      await proveTx(market.pause());

      await expect(marketUnderLender.takeLoanFor(
        borrower.address,
        DEFAULT_PROGRAM_ID,
        BORROW_AMOUNT,
        DEFAULT_ADDON_AMOUNT,
        DEFAULT_DURATION_IN_PERIODS
      )).to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the caller is not the lender or its alias", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);

      await expect(connect(market, borrower).takeLoanFor(
        borrower.address,
        DEFAULT_PROGRAM_ID,
        BORROW_AMOUNT,
        DEFAULT_ADDON_AMOUNT,
        DEFAULT_DURATION_IN_PERIODS
      )).to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
    });

    it("Is reverted if the borrower address is zero", async () => {
      const { marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);

      await expect(marketUnderLender.takeLoanFor(
        ZERO_ADDRESS, // borrower address
        DEFAULT_PROGRAM_ID,
        BORROW_AMOUNT,
        DEFAULT_ADDON_AMOUNT,
        DEFAULT_DURATION_IN_PERIODS
      )).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_ZERO_ADDRESS);
    });

    it("Is reverted if program with the passed ID is not registered", async () => {
      const { marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
      let nonExistentProgramId = 0;

      await expect(marketUnderLender.takeLoanFor(
        borrower.address,
        nonExistentProgramId,
        BORROW_AMOUNT,
        DEFAULT_ADDON_AMOUNT,
        DEFAULT_DURATION_IN_PERIODS
      )).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_UNAUTHORIZED);

      nonExistentProgramId = DEFAULT_PROGRAM_ID + 1;
      await expect(marketUnderLender.takeLoanFor(
        borrower.address,
        nonExistentProgramId,
        BORROW_AMOUNT,
        DEFAULT_ADDON_AMOUNT,
        DEFAULT_DURATION_IN_PERIODS
      )).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_UNAUTHORIZED);
    });

    it("Is reverted if the borrow amount is zero", async () => {
      const { marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
      const zeroBorrowAmount = 0;

      await expect(marketUnderLender.takeLoanFor(
        borrower.address,
        DEFAULT_PROGRAM_ID,
        zeroBorrowAmount,
        DEFAULT_ADDON_AMOUNT,
        DEFAULT_DURATION_IN_PERIODS
      )).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_INVALID_AMOUNT);
    });

    it("Is reverted if the borrow amount is not rounded according to the accuracy factor", async () => {
      const { marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
      const borrowAmount = BORROW_AMOUNT - 1;

      await expect(marketUnderLender.takeLoanFor(
        borrower.address,
        DEFAULT_PROGRAM_ID,
        borrowAmount,
        DEFAULT_ADDON_AMOUNT,
        DEFAULT_DURATION_IN_PERIODS
      )).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_INVALID_AMOUNT);
    });
  });

  describe("Function 'repayLoan()'", async () => {
    async function repayLoanAndCheck(
      market: Contract,
      repayAmount: number | bigint,
      payerKind: PayerKind,
      initialLoanState: LoanState
    ) {
      const expectedLoanState: LoanState = { ...initialLoanState };
      let tx: Promise<TransactionResponse>;
      let payer: HardhatEthersSigner;
      switch (payerKind) {
        case PayerKind.Borrower:
          tx = connect(market, borrower).repayLoan(DEFAULT_LOAN_ID, repayAmount);
          payer = borrower;
          break;
        case PayerKind.LiquidityPool:
          tx = liquidityPool.autoRepay(getAddress(market), DEFAULT_LOAN_ID, repayAmount);
          payer = borrower;
          break;
        default:
          tx = connect(market, stranger).repayLoan(DEFAULT_LOAN_ID, repayAmount);
          payer = stranger;
      }
      const repaymentTimestampWithOffset = calculateTimestampWithOffset(await getTxTimestamp(tx));

      const loanPreviewBeforeRepayment = defineLoanPreview(
        expectedLoanState,
        repaymentTimestampWithOffset,
        Number(repayAmount)
      );
      if (repayAmount === FULL_REPAY_AMOUNT) {
        repayAmount = loanPreviewBeforeRepayment.outstandingBalance;
        expectedLoanState.trackedBalance = 0;
        expectedLoanState.repaidAmount = loanPreviewBeforeRepayment.outstandingBalance;
      } else {
        repayAmount = Number(repayAmount);
        expectedLoanState.trackedBalance =
          loanPreviewBeforeRepayment.outstandingBalance + DEFAULT_ADDON_AMOUNT - repayAmount;
        expectedLoanState.repaidAmount = repayAmount;
      }
      expectedLoanState.trackedTimestamp = repaymentTimestampWithOffset;
      expectedLoanState.borrowAmount = initialLoanState.borrowAmount;
      const actualLoanStateAfterRepayment = await market.getLoanState(DEFAULT_LOAN_ID);
      checkEquality(actualLoanStateAfterRepayment, expectedLoanState);

      await expect(tx).to.changeTokenBalances(
        token,
        [liquidityPool, payer],
        [+repayAmount, -repayAmount]
      );

      await expect(tx)
        .to.emit(market, EVENT_NAME_LOAN_REPAYMENT)
        .withArgs(
          DEFAULT_LOAN_ID,
          payer.address,
          borrower.address,
          repayAmount,
          expectedLoanState.trackedBalance // outstanding balance
        );

      // Check that the appropriate market hook functions are called
      await expect(tx)
        .to.emit(liquidityPool, EVENT_NAME_ON_AFTER_LOAN_PAYMENT)
        .withArgs(DEFAULT_LOAN_ID, repayAmount);
    }

    describe("Executes as expected if", async () => {
      it("There is a partial repayment from the borrower on the same period the loan is taken", async () => {
        const { market, initialLoanState } = await setUpFixture(deployLendingMarketAndTakeLoan);
        await repayLoanAndCheck(market, REPAY_AMOUNT, PayerKind.Borrower, initialLoanState);
      });

      it("There is a partial repayment from a stranger before the loan is defaulted", async () => {
        const { market, initialLoanState } = await setUpFixture(deployLendingMarketAndTakeLoan);
        const timestamp = await getLatestBlockTimestamp();
        const futureTimestamp = timestamp + (DEFAULT_DURATION_IN_PERIODS / 2) * DEFAULT_PERIOD_IN_SECONDS;
        await increaseBlockTimestampTo(futureTimestamp);
        await repayLoanAndCheck(market, REPAY_AMOUNT, PayerKind.Stranger, initialLoanState);
      });
    });

    describe("Is reverted if", async () => {
      it("The contract is paused", async () => {
        const { market } = await setUpFixture(deployLendingMarketAndTakeLoan);
        await proveTx(market.pause());

        await expect(market.repayLoan(DEFAULT_LOAN_ID, REPAY_AMOUNT))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
      });

      it("The loan does not exist", async () => {
        const { market } = await setUpFixture(deployLendingMarket);

        await expect(market.repayLoan(DEFAULT_LOAN_ID, REPAY_AMOUNT))
          .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_NOT_EXIST);
      });

      it("The loan is already repaid", async () => {
        const { market } = await setUpFixture(deployLendingMarketAndTakeLoan);

        await proveTx(connect(market, borrower).repayLoan(DEFAULT_LOAN_ID, FULL_REPAY_AMOUNT));

        await expect(market.repayLoan(DEFAULT_LOAN_ID, REPAY_AMOUNT))
          .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_ALREADY_REPAID);
      });

      it("The repayment amount is zero", async () => {
        const { market } = await setUpFixture(deployLendingMarketAndTakeLoan);

        await expect(market.repayLoan(DEFAULT_LOAN_ID, 0))
          .to.be.revertedWithCustomError(market, ERROR_NAME_INVALID_AMOUNT);
      });

      it("The repayment amount is less than accuracy factor", async () => {
        const { market } = await setUpFixture(deployLendingMarketAndTakeLoan);

        await expect(market.repayLoan(DEFAULT_LOAN_ID, ACCURACY_FACTOR - 1))
          .to.be.revertedWithCustomError(market, ERROR_NAME_INVALID_AMOUNT);
      });

      it("The repayment amount is bigger than outstanding balance", async () => {
        const { market } = await setUpFixture(deployLendingMarketAndTakeLoan);

        await expect(market.repayLoan(DEFAULT_LOAN_ID, BORROW_AMOUNT * 2))
          .to.be.revertedWithCustomError(market, ERROR_NAME_INVALID_AMOUNT);
      });
    });
  });

  describe("Function 'freeze()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { market, marketConnectedToLender, initialLoanState } = await setUpFixture(deployLendingMarketAndTakeLoan);
      const expectedLoanState = { ...initialLoanState };

      const tx = marketConnectedToLender.freeze(DEFAULT_LOAN_ID);
      expectedLoanState.freezeTimestamp = calculateTimestampWithOffset(await getTxTimestamp(tx));

      const actualLoanStateAfterFreezing: LoanState = await market.getLoanState(DEFAULT_LOAN_ID);

      await expect(tx)
        .to.emit(market, EVENT_NAME_LOAN_FROZEN)
        .withArgs(DEFAULT_LOAN_ID);

      checkEquality(actualLoanStateAfterFreezing, expectedLoanState);
    });

    it("Is reverted if the contract is paused", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoan);
      await proveTx(market.pause());

      await expect(market.freeze(DEFAULT_LOAN_ID))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the loan does not exist", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoan);

      await expect(market.freeze(NON_EXISTENT_LOAN_ID))
        .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_NOT_EXIST);
    });

    it("Is reverted if the loan is already repaid", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoan);
      await proveTx(connect(market, borrower).repayLoan(DEFAULT_LOAN_ID, FULL_REPAY_AMOUNT));

      await expect(market.freeze(DEFAULT_LOAN_ID))
        .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_ALREADY_REPAID);
    });

    it("Is reverted if the caller is not the lender or an alias", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoan);

      await expect(connect(market, attacker).freeze(DEFAULT_LOAN_ID))
        .to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
    });

    it("Is reverted if the loan is already frozen", async () => {
      const { market, marketConnectedToLender } = await setUpFixture(deployLendingMarketAndTakeLoan);
      await proveTx(marketConnectedToLender.freeze(DEFAULT_LOAN_ID));

      await expect(marketConnectedToLender.freeze(DEFAULT_LOAN_ID))
        .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_ALREADY_FROZEN);
    });
  });

  describe("Function 'unfreeze()'", async () => {
    async function unfreezeAndCheck(
      marketConnectedToLender: Contract,
      initialLoanState: LoanState,
      frozenInterval: number
    ) {
      const freezingTx = marketConnectedToLender.freeze(DEFAULT_LOAN_ID);
      const freezingTimestamp = calculateTimestampWithOffset(await getTxTimestamp(freezingTx));

      if (frozenInterval > 0) {
        await increaseBlockTimestampTo(calculateTimestampWithOffset(await getLatestBlockTimestamp()) + frozenInterval);
      }

      const unfreezingTx = proveTx(marketConnectedToLender.unfreeze(DEFAULT_LOAN_ID));
      const unfreezingTimestamp = calculateTimestampWithOffset(await getTxTimestamp(freezingTx));

      const frozenPeriods = calculatePeriodIndex(unfreezingTimestamp) - calculatePeriodIndex(freezingTimestamp);
      const expectedLoanState = { ...initialLoanState };
      expectedLoanState.trackedTimestamp += frozenPeriods * DEFAULT_PERIOD_IN_SECONDS;
      expectedLoanState.durationInPeriods += frozenPeriods;

      await expect(unfreezingTx)
        .to.emit(marketConnectedToLender, EVENT_NAME_LOAN_UNFROZEN)
        .withArgs(DEFAULT_LOAN_ID);

      const actualLoanState: LoanState = await marketConnectedToLender.getLoanState(DEFAULT_LOAN_ID);
      checkEquality(actualLoanState, expectedLoanState);
    }

    it("Executes as expected if it is done at the same loan period as the freezing", async () => {
      const { marketConnectedToLender, initialLoanState } = await setUpFixture(deployLendingMarketAndTakeLoan);
      const frozenInterval = 0;
      await unfreezeAndCheck(marketConnectedToLender, initialLoanState, frozenInterval);
    });

    it("Is reverted if the contract is paused", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoan);
      await proveTx(market.pause());

      await expect(market.unfreeze(DEFAULT_LOAN_ID))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the loan does not exist", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoan);

      await expect(market.unfreeze(NON_EXISTENT_LOAN_ID))
        .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_NOT_EXIST);
    });

    it("Is reverted if the loan is already repaid", async () => {
      const { market, marketConnectedToLender } = await setUpFixture(deployLendingMarketAndTakeLoan);
      await proveTx(connect(market, borrower).repayLoan(DEFAULT_LOAN_ID, FULL_REPAY_AMOUNT));

      await expect(marketConnectedToLender.unfreeze(DEFAULT_LOAN_ID))
        .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_ALREADY_REPAID);
    });

    it("Is reverted if the caller is not the lender or an alias", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoan);

      await expect(connect(market, attacker).unfreeze(DEFAULT_LOAN_ID))
        .to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
    });

    it("Is reverted if the loan is not frozen", async () => {
      const { market, marketConnectedToLender } = await setUpFixture(deployLendingMarketAndTakeLoan);

      await expect(marketConnectedToLender.unfreeze(DEFAULT_LOAN_ID))
        .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_NOT_FROZEN);
    });
  });

  describe("Function 'updateLoanDuration()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { market, marketConnectedToLender, initialLoanState } = await setUpFixture(deployLendingMarketAndTakeLoan);
      const newDuration = DEFAULT_DURATION_IN_PERIODS + 1;
      const expectedLoanState: LoanState = { ...initialLoanState };
      expectedLoanState.durationInPeriods = newDuration;

      await expect(marketConnectedToLender.updateLoanDuration(DEFAULT_LOAN_ID, newDuration))
        .to.emit(market, EVENT_NAME_LOAN_DURATION_UPDATED)
        .withArgs(DEFAULT_LOAN_ID, newDuration, DEFAULT_DURATION_IN_PERIODS);
      const actualLoanState = await market.getLoanState(DEFAULT_LOAN_ID);
      checkEquality(actualLoanState, expectedLoanState);
    });

    it("Is reverted if the contract is paused", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoan);
      await proveTx(market.pause());

      await expect(market.updateLoanDuration(DEFAULT_LOAN_ID, DEFAULT_DURATION_IN_PERIODS))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the loan does not exist", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoan);

      await expect(market.updateLoanDuration(NON_EXISTENT_LOAN_ID, DEFAULT_DURATION_IN_PERIODS))
        .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_NOT_EXIST);
    });

    it("Is reverted if the loan is already repaid", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoan);
      await proveTx(connect(market, borrower).repayLoan(DEFAULT_LOAN_ID, FULL_REPAY_AMOUNT));

      await expect(market.updateLoanDuration(DEFAULT_LOAN_ID, DEFAULT_DURATION_IN_PERIODS))
        .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_ALREADY_REPAID);
    });

    it("Is reverted if the caller is not the lender or an alias", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoan);

      await expect(
        connect(market, attacker).updateLoanDuration(DEFAULT_LOAN_ID, DEFAULT_DURATION_IN_PERIODS)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
    });

    it("Is reverted if the new duration is the same as the previous one or less", async () => {
      const { market, marketConnectedToLender } = await setUpFixture(deployLendingMarketAndTakeLoan);

      await expect(marketConnectedToLender.updateLoanDuration(DEFAULT_LOAN_ID, DEFAULT_DURATION_IN_PERIODS))
        .to.be.revertedWithCustomError(market, ERROR_NAME_INAPPROPRIATE_DURATION_IN_PERIODS);
      await expect(marketConnectedToLender.updateLoanDuration(DEFAULT_LOAN_ID, DEFAULT_DURATION_IN_PERIODS - 1))
        .to.be.revertedWithCustomError(market, ERROR_NAME_INAPPROPRIATE_DURATION_IN_PERIODS);
    });

    it("Is reverted if the new duration is greater than 32-bit unsigned integer", async () => {
      const { market, marketConnectedToLender } = await setUpFixture(deployLendingMarketAndTakeLoan);
      const newDuration = BigInt(2) ** 32n + 1n;

      await expect(marketConnectedToLender.updateLoanDuration(DEFAULT_LOAN_ID, newDuration))
        .to.be.revertedWithCustomError(market, ERROR_NAME_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST)
        .withArgs(32, newDuration);
    });
  });

  describe("Function 'updateLoanInterestRatePrimary()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { market, marketConnectedToLender, initialLoanState } = await setUpFixture(deployLendingMarketAndTakeLoan);
      const newInterestRate = DEFAULT_INTEREST_RATE_PRIMARY - 1;
      const expectedLoanState = { ...initialLoanState };
      expectedLoanState.interestRatePrimary = newInterestRate;

      await expect(marketConnectedToLender.updateLoanInterestRatePrimary(DEFAULT_LOAN_ID, newInterestRate))
        .to.emit(market, EVENT_NAME_LOAN_INTEREST_RATE_PRIMARY_UPDATED)
        .withArgs(DEFAULT_LOAN_ID, newInterestRate, DEFAULT_INTEREST_RATE_PRIMARY);
      const actualLoanState = await marketConnectedToLender.getLoanState(DEFAULT_LOAN_ID);
      checkEquality(actualLoanState, expectedLoanState);
    });

    it("Is reverted if the contract is paused", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoan);
      await proveTx(market.pause());

      await expect(
        market.updateLoanInterestRatePrimary(DEFAULT_LOAN_ID, DEFAULT_INTEREST_RATE_PRIMARY)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the loan does not exist", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoan);

      await expect(market.updateLoanInterestRatePrimary(NON_EXISTENT_LOAN_ID, DEFAULT_INTEREST_RATE_PRIMARY))
        .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_NOT_EXIST);
    });

    it("Is reverted if the loan is already repaid", async () => {
      const { market, marketConnectedToLender } = await setUpFixture(deployLendingMarketAndTakeLoan);
      await proveTx(connect(market, borrower).repayLoan(DEFAULT_LOAN_ID, FULL_REPAY_AMOUNT));

      await expect(
        marketConnectedToLender.updateLoanInterestRatePrimary(DEFAULT_LOAN_ID, DEFAULT_INTEREST_RATE_PRIMARY)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_ALREADY_REPAID);
    });

    it("Is reverted if the caller is not the lender or an alias", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoan);

      await expect(
        connect(market, attacker).updateLoanInterestRatePrimary(DEFAULT_LOAN_ID, DEFAULT_INTEREST_RATE_PRIMARY)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
    });

    it("Is is reverted if the new interest rate is the same as the previous one or greater", async () => {
      const { market, marketConnectedToLender } = await setUpFixture(deployLendingMarketAndTakeLoan);

      await expect(
        marketConnectedToLender.updateLoanInterestRatePrimary(DEFAULT_LOAN_ID, DEFAULT_INTEREST_RATE_PRIMARY)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_INAPPROPRIATE_INTEREST_RATE);
      await expect(
        marketConnectedToLender.updateLoanInterestRatePrimary(DEFAULT_LOAN_ID, DEFAULT_INTEREST_RATE_PRIMARY + 1)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_INAPPROPRIATE_INTEREST_RATE);
    });
  });

  describe("Function 'updateLoanInterestRateSecondary()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { market, marketConnectedToLender, initialLoanState } = await setUpFixture(deployLendingMarketAndTakeLoan);
      const newInterestRate = DEFAULT_INTEREST_RATE_SECONDARY - 1;
      const expectedLoanState = { ...initialLoanState };
      expectedLoanState.interestRateSecondary = newInterestRate;

      await expect(marketConnectedToLender.updateLoanInterestRateSecondary(DEFAULT_LOAN_ID, newInterestRate))
        .to.emit(market, EVENT_NAME_LOAN_INTEREST_RATE_SECONDARY_UPDATED)
        .withArgs(DEFAULT_LOAN_ID, newInterestRate, DEFAULT_INTEREST_RATE_SECONDARY);
      const actualLoanState = await marketConnectedToLender.getLoanState(DEFAULT_LOAN_ID);
      checkEquality(actualLoanState, expectedLoanState);
    });

    it("Is reverted if the contract is paused", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoan);
      await proveTx(market.pause());

      await expect(market.updateLoanInterestRateSecondary(DEFAULT_LOAN_ID, DEFAULT_INTEREST_RATE_SECONDARY))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the loan does not exist", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoan);

      await expect(market.updateLoanInterestRateSecondary(NON_EXISTENT_LOAN_ID, DEFAULT_INTEREST_RATE_SECONDARY))
        .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_NOT_EXIST);
    });

    it("Is reverted if the loan is already repaid", async () => {
      const { market, marketConnectedToLender } = await setUpFixture(deployLendingMarketAndTakeLoan);
      await proveTx(connect(market, borrower).repayLoan(DEFAULT_LOAN_ID, FULL_REPAY_AMOUNT));

      await expect(
        marketConnectedToLender.updateLoanInterestRateSecondary(DEFAULT_LOAN_ID, DEFAULT_INTEREST_RATE_SECONDARY)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_ALREADY_REPAID);
    });

    it("Is reverted if the caller is not the lender or an alias", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoan);

      await expect(
        connect(market, attacker).updateLoanInterestRateSecondary(DEFAULT_LOAN_ID, DEFAULT_INTEREST_RATE_SECONDARY)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
    });

    it("Is is reverted if the new interest rate is the same as the previous one or greater", async () => {
      const { market, marketConnectedToLender } = await setUpFixture(deployLendingMarketAndTakeLoan);

      await expect(
        marketConnectedToLender.updateLoanInterestRateSecondary(DEFAULT_LOAN_ID, DEFAULT_INTEREST_RATE_SECONDARY)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_INAPPROPRIATE_INTEREST_RATE);
      await expect(
        marketConnectedToLender.updateLoanInterestRateSecondary(DEFAULT_LOAN_ID, DEFAULT_INTEREST_RATE_SECONDARY + 1)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_INAPPROPRIATE_INTEREST_RATE);
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

    it("Is reverted if the account address is zero", async () => {
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

  describe("Function 'revokeLoan()'", async () => {
    it("Executes as expected and emits correct event if caller is the lender", async () => {
      const { market, marketConnectedToLender } = await setUpFixture(deployLendingMarketAndTakeLoan);

      const tx: Promise<TransactionResponse> = marketConnectedToLender.revokeLoan(DEFAULT_LOAN_ID);
      await proveTx(tx);

      const loanStateAfterRevocation: LoanState = await market.getLoanState(DEFAULT_LOAN_ID);
      expect(loanStateAfterRevocation.trackedBalance).to.eq(0);

      await expect(tx).to.emit(market, EVENT_NAME_LOAN_REVOKED).withArgs(DEFAULT_LOAN_ID);

      await expect(tx).to.changeTokenBalances(
        token,
        [loanStateAfterRevocation.borrower, liquidityPool],
        [-BORROW_AMOUNT, +BORROW_AMOUNT]
      );

      // check hooks
      await expect(tx)
        .to.emit(creditLine, EVENT_NAME_ON_AFTER_LOAN_REVOCATION)
        .withArgs(DEFAULT_LOAN_ID)
        .and.to.emit(liquidityPool, EVENT_NAME_ON_AFTER_LOAN_REVOCATION)
        .withArgs(DEFAULT_LOAN_ID);
    });

    it("Executes as expected and emits correct event if caller is the borrower", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoan);

      const tx: Promise<TransactionResponse> = connect(market, borrower).revokeLoan(DEFAULT_LOAN_ID);
      await proveTx(tx);

      const loanStateAfterRevocation: LoanState = await market.getLoanState(DEFAULT_LOAN_ID);
      expect(loanStateAfterRevocation.trackedBalance).to.eq(0);

      await expect(tx)
        .to.emit(market, EVENT_NAME_LOAN_REVOKED)
        .withArgs(DEFAULT_LOAN_ID);

      await expect(tx).to.changeTokenBalances(
        token,
        [loanStateAfterRevocation.borrower, liquidityPool],
        [-BORROW_AMOUNT, +BORROW_AMOUNT]
      );

      // check hooks
      await expect(tx)
        .to.emit(creditLine, EVENT_NAME_ON_AFTER_LOAN_REVOCATION)
        .withArgs(DEFAULT_LOAN_ID)
        .and.to.emit(liquidityPool, EVENT_NAME_ON_AFTER_LOAN_REVOCATION)
        .withArgs(DEFAULT_LOAN_ID);
    });

    it("Executes as expected and emits correct event if the borrower made repayments", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoan);

      await proveTx(connect(market, borrower).repayLoan(DEFAULT_LOAN_ID, REPAY_AMOUNT));

      const tx: Promise<TransactionResponse> = connect(market, borrower).revokeLoan(DEFAULT_LOAN_ID);
      await proveTx(tx);

      const loanStateAfterRevocation: LoanState = await market.getLoanState(DEFAULT_LOAN_ID);
      expect(loanStateAfterRevocation.trackedBalance).to.eq(0);

      await expect(tx)
        .to.emit(market, EVENT_NAME_LOAN_REVOKED)
        .withArgs(DEFAULT_LOAN_ID);

      await expect(tx).to.changeTokenBalances(
        token,
        [loanStateAfterRevocation.borrower, liquidityPool],
        [-(BORROW_AMOUNT - REPAY_AMOUNT), +(BORROW_AMOUNT - REPAY_AMOUNT)]
      );

      // check hooks
      await expect(tx)
        .to.emit(creditLine, EVENT_NAME_ON_AFTER_LOAN_REVOCATION)
        .withArgs(DEFAULT_LOAN_ID)
        .and.to.emit(liquidityPool, EVENT_NAME_ON_AFTER_LOAN_REVOCATION)
        .withArgs(DEFAULT_LOAN_ID);
    });

    it("Is reverted if the contract is paused", async () => {
      const { market, marketConnectedToLender } = await setUpFixture(deployLendingMarketAndTakeLoan);
      await proveTx(market.pause());

      await expect(marketConnectedToLender.revokeLoan(DEFAULT_LOAN_ID))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the loan does not exist", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoan);

      await expect(market.revokeLoan(DEFAULT_LOAN_ID + 1))
        .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_NOT_EXIST);
    });

    it("Is reverted if the cooldown period has passed", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoan);
      await increaseBlockTimestampTo(
        await getLatestBlockTimestamp() + DEFAULT_PERIOD_IN_SECONDS ** COOLDOWN_IN_PERIODS
      );

      await expect(connect(market, borrower).revokeLoan(DEFAULT_LOAN_ID))
        .to.be.revertedWithCustomError(market, ERROR_NAME_COOLDOWN_PERIOD_PASSED);
    });

    it("Is reverted if the caller is unauthorized", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoan);

      await expect(connect(market, attacker).revokeLoan(DEFAULT_LOAN_ID))
        .to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
    });
  });

  describe("Function 'calculateOutstandingBalance()'", async () => {
    it("Executes as expected", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoan);
      const actualBalance = await market.calculateOutstandingBalance(
        BORROW_AMOUNT,
        DEFAULT_DURATION_IN_PERIODS,
        DEFAULT_INTEREST_RATE_PRIMARY,
        DEFAULT_INTEREST_RATE_FACTOR
      );

      const expectedBalance = calculateOutstandingBalance(
        BORROW_AMOUNT,
        DEFAULT_DURATION_IN_PERIODS,
        DEFAULT_INTEREST_RATE_PRIMARY
      );
      expect(actualBalance).to.eq(expectedBalance);
    });
  });

  describe("Constant getters", async () => {
    it("Function 'interestRateFactor()'", async () => {
      const { market } = await setUpFixture(deployLendingMarket);

      expect(await market.interestRateFactor()).to.eq(DEFAULT_INTEREST_RATE_FACTOR);
    });

    it("Function 'periodInSeconds()'", async () => {
      const { market } = await setUpFixture(deployLendingMarket);

      expect(await market.periodInSeconds()).to.eq(DEFAULT_PERIOD_IN_SECONDS);
    });

    it("Function 'timeOffset()'", async () => {
      const { market } = await setUpFixture(deployLendingMarket);

      const res = await market.timeOffset();

      expect(res[0]).to.eq(NEGATIVE_TIME_OFFSET);
      expect(res[1]).to.eq(false);
    });

    it("Function 'loanCounter()'", async () => {
      const { market } = await setUpFixture(deployLendingMarket);
      expect(await market.loanCounter()).to.eq(0);
    });
  });
});
