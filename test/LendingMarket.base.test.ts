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
import { checkEquality, maxUintForBits, roundMath, setUpFixture } from "../test-utils/common";

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

interface Fixture {
  market: Contract;
  marketUnderLender: Contract;
  marketAddress: string;
  loanId: number;
  initialLoanTerms: LoanTerms;
  initialLoanState: LoanState;
  loanStartPeriodIndex: number;
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
const ACCURACY_FACTOR = 10_000;
const INITIAL_BALANCE = 1000_000_000_000;
const BORROW_AMOUNT = 100_000_000_000;
const ADDON_AMOUNT = 100_000;
const REPAYMENT_AMOUNT = 50_000_000_000;
const FULL_REPAYMENT_AMOUNT = ethers.MaxUint256;
const INTEREST_RATE_FACTOR = 10 ** 9;
const INTEREST_RATE_PRIMARY = INTEREST_RATE_FACTOR / 10;
const INTEREST_RATE_SECONDARY = INTEREST_RATE_FACTOR / 5;
const PERIOD_IN_SECONDS = 86400;
const DURATION_IN_PERIODS = 10;
const ALIAS_STATUS_CONFIGURED = true;
const ALIAS_STATUS_NOT_CONFIGURED = false;
const PROGRAM_ID = 1;
const NEGATIVE_TIME_OFFSET = 3 * 60 * 60; // 3 hours
const COOLDOWN_IN_PERIODS = 3;
const EXPECTED_VERSION: Version = {
  major: 1,
  minor: 3,
  patch: 0
};

const defaultLoanTerms: LoanTerms = {
  token: ZERO_ADDRESS,
  addonAmount: 0,
  durationInPeriods: 0,
  interestRatePrimary: 0,
  interestRateSecondary: 0
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
  freezeTimestamp: 0
};

async function deployAndConnectContract(
  contractFactory: ContractFactory,
  account: HardhatEthersSigner
): Promise<Contract> {
  let contract = (await contractFactory.deploy()) as Contract;
  await contract.waitForDeployment();
  contract = connect(contract, account); // Explicitly specifying the initial account
  return contract;
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

  let creditLineAddress: string;
  let anotherCreditLineAddress: string;
  let liquidityPoolAddress: string;
  let anotherLiquidityPoolAddress: string;
  let tokenAddress: string;

  before(async () => {
    [owner, lender, borrower, alias, attacker, stranger] = await ethers.getSigners();

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

  function createLoanState(timestamp: number, addonAmount: number = ADDON_AMOUNT): LoanState {
    const timestampWithOffset = calculateTimestampWithOffset(timestamp);
    return {
      ...defaultLoanState,
      programId: PROGRAM_ID,
      borrowAmount: BORROW_AMOUNT,
      addonAmount: addonAmount,
      startTimestamp: timestampWithOffset,
      durationInPeriods: DURATION_IN_PERIODS,
      token: tokenAddress,
      borrower: borrower.address,
      interestRatePrimary: INTEREST_RATE_PRIMARY,
      interestRateSecondary: INTEREST_RATE_SECONDARY,
      trackedBalance: BORROW_AMOUNT + addonAmount,
      trackedTimestamp: timestampWithOffset
    };
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

  function defineLoanPreview(loanState: LoanState, timestamp: number): LoanPreview {
    let outstandingBalance = loanState.trackedBalance;
    let timestampWithOffset = calculateTimestampWithOffset(timestamp);
    if (loanState.freezeTimestamp != 0) {
      timestampWithOffset = loanState.freezeTimestamp;
    }
    const periodIndex = calculatePeriodIndex(timestampWithOffset);
    const trackedPeriodIndex = calculatePeriodIndex(loanState.trackedTimestamp);
    const startPeriodIndex = calculatePeriodIndex(loanState.startTimestamp);
    const duePeriodIndex = startPeriodIndex + loanState.durationInPeriods;
    const numberOfPeriods = periodIndex - trackedPeriodIndex;
    const numberOfPeriodsWithSecondaryRate = periodIndex - duePeriodIndex;
    const numberOfPeriodsWithPrimaryRate =
      numberOfPeriodsWithSecondaryRate > 0 ? numberOfPeriods - numberOfPeriodsWithSecondaryRate : numberOfPeriods;

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
      trackedBalance: outstandingBalance,
      outstandingBalance: Number(roundMath(outstandingBalance, ACCURACY_FACTOR))
    };
  }

  function processRepayment(loanState: LoanState, props: {
    repaymentAmount: number | bigint;
    repaymentTimestamp: number;
  }) {
    const repaymentTimestampWithOffset = calculateTimestampWithOffset(props.repaymentTimestamp);
    if (loanState.trackedTimestamp >= repaymentTimestampWithOffset) {
      return;
    }
    let repaymentAmount = props.repaymentAmount;
    const loanPreviewBeforeRepayment = defineLoanPreview(loanState, props.repaymentTimestamp);
    if (loanPreviewBeforeRepayment.outstandingBalance === repaymentAmount) {
      repaymentAmount = FULL_REPAYMENT_AMOUNT;
    }
    if (repaymentAmount === FULL_REPAYMENT_AMOUNT) {
      loanState.trackedBalance = 0;
      loanState.repaidAmount += loanPreviewBeforeRepayment.outstandingBalance;
    } else {
      repaymentAmount = Number(repaymentAmount);
      loanState.trackedBalance = loanPreviewBeforeRepayment.trackedBalance - repaymentAmount;
      loanState.repaidAmount += repaymentAmount;
    }
    loanState.trackedTimestamp = repaymentTimestampWithOffset;
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
      loanId: -1,
      initialLoanTerms: defaultLoanTerms,
      initialLoanState: defaultLoanState,
      loanStartPeriodIndex: -1
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
    await proveTx(liquidityPool.approveMarket(marketAddress, tokenAddress));
    await proveTx(connect(token, borrower).approve(marketAddress, ethers.MaxUint256));
    await proveTx(connect(token, stranger).approve(marketAddress, ethers.MaxUint256));

    return fixture;
  }

  async function deployLendingMarketAndTakeLoan(): Promise<Fixture> {
    const fixture = await deployLendingMarketAndConfigureItForLoan();
    const { market, marketUnderLender } = fixture;

    fixture.loanId = Number(await market.loanCounter());
    const txReceipt = await proveTx(marketUnderLender.takeLoanFor(
      borrower.address,
      PROGRAM_ID,
      BORROW_AMOUNT,
      ADDON_AMOUNT,
      DURATION_IN_PERIODS
    ));
    fixture.initialLoanState = createLoanState(await getBlockTimestamp(txReceipt.blockNumber));
    fixture.loanStartPeriodIndex = calculatePeriodIndex(fixture.initialLoanState.startTimestamp);
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
      const expectedLoanPreview: LoanPreview = defineLoanPreview(defaultLoanState, await getLatestBlockTimestamp());
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
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoan);
      const wrongCreditLineAddress = "0x0000000000000000000000000000000000000001";

      await expect(market.registerCreditLine(wrongCreditLineAddress))
        .to.be.revertedWithCustomError(market, ERROR_NAME_CONTRACT_ADDRESS_INVALID);
    });

    it("Is reverted if the provided address is not a credit line contract", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoan);
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
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoan);
      const wrongLiquidityPoolAddress = "0x0000000000000000000000000000000000000001";

      await expect(market.registerLiquidityPool(wrongLiquidityPoolAddress))
        .to.be.revertedWithCustomError(market, ERROR_NAME_CONTRACT_ADDRESS_INVALID);
    });

    it("Is reverted if the provided address is not a liquidity pool contract", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoan);
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
    it("Executes as expected and emits the correct events", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);

      const TOTAL_BORROW_AMOUNT = BORROW_AMOUNT + ADDON_AMOUNT;

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
      const actualLoan: LoanState = await market.getLoanState(expectedLoanId);
      const expectedLoan: LoanState = createLoanState(await getBlockTimestamp(txReceipt.blockNumber));

      checkEquality(actualLoan, expectedLoan);
      expect(await market.loanCounter()).to.eq(expectedLoanId + 1);

      await expect(tx).to.changeTokenBalances(
        token,
        [liquidityPool, borrower, market],
        [-BORROW_AMOUNT, +BORROW_AMOUNT, 0]
      );

      await expect(tx)
        .to.emit(market, EVENT_NAME_LOAN_TAKEN)
        .withArgs(expectedLoanId, borrower.address, TOTAL_BORROW_AMOUNT, DURATION_IN_PERIODS);

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
    });

    it("Is reverted if the contract is paused", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
      await proveTx(market.pause());

      await expect(
        connect(market, borrower).takeLoan(PROGRAM_ID, BORROW_AMOUNT, DURATION_IN_PERIODS)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the passed program ID is zero", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
      const wrongProgramId = 0;

      await expect(market.takeLoan(wrongProgramId, BORROW_AMOUNT, DURATION_IN_PERIODS))
        .to.be.revertedWithCustomError(market, ERROR_NAME_PROGRAM_NOT_EXIST);
    });

    it("Is reverted if the borrow amount is zero", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
      const wrongBorrowAmount = 0;

      await expect(market.takeLoan(PROGRAM_ID, wrongBorrowAmount, DURATION_IN_PERIODS))
        .to.be.revertedWithCustomError(market, ERROR_NAME_INVALID_AMOUNT);
    });

    it("Is reverted if the borrow amount is not rounded according to the accuracy factor", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
      const wrongBorrowAmount = BORROW_AMOUNT - 1;

      await expect(
        market.takeLoan(PROGRAM_ID, wrongBorrowAmount, DURATION_IN_PERIODS)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_INVALID_AMOUNT);
    });

    it("Is reverted if the credit line is not registered", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
      await proveTx(market.setCreditLineForProgram(PROGRAM_ID, ZERO_ADDRESS)); // Call via the testable version

      await expect(
        market.takeLoan(PROGRAM_ID, BORROW_AMOUNT, DURATION_IN_PERIODS)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_CREDIT_LINE_LENDER_NOT_CONFIGURED);
    });

    it("Is reverted if the liquidity pool is not registered", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
      await proveTx(market.setLiquidityPoolForProgram(PROGRAM_ID, ZERO_ADDRESS)); // Call via the testable version

      await expect(
        market.takeLoan(PROGRAM_ID, BORROW_AMOUNT, DURATION_IN_PERIODS)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_LIQUIDITY_POOL_LENDER_NOT_CONFIGURED);
    });
  });

  describe("Function 'takeLoanFor()'", async () => {
    it("Executes as expected and emits the correct events", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);

      const addonAmount = BORROW_AMOUNT / 100;
      const totalBorrowAmount = BORROW_AMOUNT + addonAmount;
      const expectedLoanId = 0;

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
      const txReceipt: TransactionReceipt = await proveTx(tx);
      const actualLoan: LoanState = await market.getLoanState(expectedLoanId);
      const expectedLoan: LoanState = createLoanState(await getBlockTimestamp(txReceipt.blockNumber), addonAmount);

      checkEquality(actualLoan, expectedLoan);
      expect(await market.loanCounter()).to.eq(expectedLoanId + 1);

      await expect(tx).to.changeTokenBalances(
        token,
        [liquidityPool, borrower, market],
        [-BORROW_AMOUNT, +BORROW_AMOUNT, 0]
      );

      await expect(tx)
        .to.emit(market, EVENT_NAME_LOAN_TAKEN)
        .withArgs(expectedLoanId, borrower.address, totalBorrowAmount, DURATION_IN_PERIODS);

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
    });

    it("Is reverted if the contract is paused", async () => {
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

    it("Is reverted if the caller is not the lender or its alias", async () => {
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

    it("Is reverted if the borrower address is zero", async () => {
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

    it("Is reverted if program with the passed ID is not registered", async () => {
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

    it("Is reverted if the borrow amount is zero", async () => {
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

    it("Is reverted if the borrow amount is not rounded according to the accuracy factor", async () => {
      const { marketUnderLender } = await setUpFixture(deployLendingMarketAndConfigureItForLoan);
      const wrongBorrowAmount = BORROW_AMOUNT - 1;

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

    it("Is reverted if the credit line is not registered", async () => {
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

    it("Is reverted if the liquidity pool is not registered", async () => {
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
  });

  describe("Function 'repayLoan()'", async () => {
    async function repayLoanAndCheck(
      fixture: Fixture,
      repaymentAmount: number | bigint,
      payerKind: PayerKind
    ) {
      const expectedLoanState: LoanState = { ...fixture.initialLoanState };
      const { market, marketAddress, loanId } = fixture;
      let tx: Promise<TransactionResponse>;
      let payer: HardhatEthersSigner;
      switch (payerKind) {
        case PayerKind.Borrower:
          tx = connect(market, borrower).repayLoan(loanId, repaymentAmount);
          payer = borrower;
          break;
        case PayerKind.LiquidityPool:
          tx = liquidityPool.repayLoan(marketAddress, loanId, repaymentAmount);
          payer = borrower;
          break;
        default:
          tx = connect(market, stranger).repayLoan(loanId, repaymentAmount);
          payer = stranger;
      }
      processRepayment(expectedLoanState, { repaymentAmount, repaymentTimestamp: await getTxTimestamp(tx) });
      repaymentAmount = expectedLoanState.repaidAmount;

      const actualLoanStateAfterRepayment = await market.getLoanState(loanId);
      checkEquality(actualLoanStateAfterRepayment, expectedLoanState);

      await expect(tx).to.changeTokenBalances(
        token,
        [liquidityPool, payer, market],
        [+repaymentAmount, -repaymentAmount, 0]
      );

      await expect(tx).to.emit(market, EVENT_NAME_LOAN_REPAYMENT).withArgs(
        loanId,
        payer.address,
        borrower.address,
        repaymentAmount,
        expectedLoanState.trackedBalance // outstanding balance
      );

      // Check that the appropriate market hook functions are called
      await expect(tx).to.emit(liquidityPool, EVENT_NAME_ON_AFTER_LOAN_PAYMENT).withArgs(loanId, repaymentAmount);
    }

    describe("Executes as expected if", async () => {
      it("There is a partial repayment from the borrower on the same period the loan is taken", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoan);
        await repayLoanAndCheck(fixture, REPAYMENT_AMOUNT, PayerKind.Borrower);
      });

      it("There is a partial repayment from a stranger before the loan is defaulted", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoan);
        const periodIndex = fixture.loanStartPeriodIndex + fixture.initialLoanState.durationInPeriods / 2;
        await increaseBlockTimestampToPeriodIndex(periodIndex);
        await repayLoanAndCheck(fixture, REPAYMENT_AMOUNT, PayerKind.Stranger);
      });

      it("There is a partial repayment from a liquidity pool after the loan is defaulted", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoan);
        const periodIndex = fixture.loanStartPeriodIndex + fixture.initialLoanState.durationInPeriods + 1;
        await increaseBlockTimestampToPeriodIndex(periodIndex);
        await repayLoanAndCheck(fixture, REPAYMENT_AMOUNT, PayerKind.LiquidityPool);
      });

      it("There is a full repayment through the amount matches the outstanding balance", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoan);
        const futureTimestamp = await increaseBlockTimestampToPeriodIndex(fixture.loanStartPeriodIndex + 1);
        const loanPreview: LoanPreview = defineLoanPreview(fixture.initialLoanState, futureTimestamp);
        await repayLoanAndCheck(fixture, loanPreview.outstandingBalance, PayerKind.Borrower);
      });

      it("There is a full repayment through the amount equals max uint256 value", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoan);
        await increaseBlockTimestampToPeriodIndex(fixture.loanStartPeriodIndex + 1);
        await repayLoanAndCheck(fixture, FULL_REPAYMENT_AMOUNT, PayerKind.Borrower);
      });
    });

    describe("Is reverted if", async () => {
      it("The contract is paused", async () => {
        const { market, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);
        await proveTx(market.pause());

        await expect(market.repayLoan(loanId, REPAYMENT_AMOUNT))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
      });

      it("The loan does not exist", async () => {
        const { market, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);
        const wrongLoanId = loanId + 1;

        await expect(market.repayLoan(wrongLoanId, REPAYMENT_AMOUNT))
          .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_NOT_EXIST);
      });

      it("The loan is already repaid", async () => {
        const { market, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);
        await proveTx(connect(market, borrower).repayLoan(loanId, FULL_REPAYMENT_AMOUNT));

        await expect(market.repayLoan(loanId, REPAYMENT_AMOUNT))
          .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_ALREADY_REPAID);
      });

      it("The repayment amount is zero", async () => {
        const { market, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);
        const wrongRepaymentAmount = 0;

        await expect(market.repayLoan(loanId, wrongRepaymentAmount))
          .to.be.revertedWithCustomError(market, ERROR_NAME_INVALID_AMOUNT);
      });

      it("The repayment amount is not rounded according to the accuracy factor", async () => {
        const { market, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);
        const wrongRepaymentAmount = REPAYMENT_AMOUNT - 1;

        await expect(market.repayLoan(loanId, wrongRepaymentAmount))
          .to.be.revertedWithCustomError(market, ERROR_NAME_INVALID_AMOUNT);
      });

      it("The repayment amount is bigger than outstanding balance", async () => {
        const { market, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);
        const wrongRepaymentAmount = BORROW_AMOUNT + ADDON_AMOUNT + ACCURACY_FACTOR;

        await expect(market.repayLoan(loanId, wrongRepaymentAmount))
          .to.be.revertedWithCustomError(market, ERROR_NAME_INVALID_AMOUNT);
      });
    });
  });

  describe("Function 'freeze()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { market, initialLoanState, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);
      const expectedLoanState = { ...initialLoanState };

      // Can be called by an alias
      await connect(market, alias).freeze.staticCall(loanId);

      const tx = connect(market, lender).freeze(loanId);
      expectedLoanState.freezeTimestamp = calculateTimestampWithOffset(await getTxTimestamp(tx));

      const actualLoanStateAfterFreezing: LoanState = await market.getLoanState(loanId);
      await expect(tx).to.emit(market, EVENT_NAME_LOAN_FROZEN).withArgs(loanId);
      checkEquality(actualLoanStateAfterFreezing, expectedLoanState);
    });

    it("Is reverted if the contract is paused", async () => {
      const { market, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);
      await proveTx(market.pause());

      await expect(market.freeze(loanId)).to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the loan does not exist", async () => {
      const { market, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);
      const wrongLoanId = loanId + 1;

      await expect(market.freeze(wrongLoanId))
        .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_NOT_EXIST);
    });

    it("Is reverted if the loan is already repaid", async () => {
      const { market, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);
      await proveTx(connect(market, borrower).repayLoan(loanId, FULL_REPAYMENT_AMOUNT));

      await expect(market.freeze(loanId))
        .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_ALREADY_REPAID);
    });

    it("Is reverted if the caller is not the lender or an alias", async () => {
      const { market, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);

      await expect(connect(market, attacker).freeze(loanId))
        .to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
    });

    it("Is reverted if the loan is already frozen", async () => {
      const { marketUnderLender, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);
      await proveTx(marketUnderLender.freeze(loanId));

      await expect(marketUnderLender.freeze(loanId))
        .to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_LOAN_ALREADY_FROZEN);
    });
  });

  describe("Function 'unfreeze()'", async () => {
    async function freezeUnfreezeAndCheck(fixture: Fixture, props: {
      freezingTimestamp: number;
      unfreezingTimestamp: number;
      repaymentAmountWhileFreezing: number;
    }) {
      const { marketUnderLender, loanId } = fixture;
      const expectedLoanState = { ...fixture.initialLoanState };
      const { freezingTimestamp, unfreezingTimestamp, repaymentAmountWhileFreezing } = props;
      const frozenInterval = unfreezingTimestamp - freezingTimestamp;

      if (await getLatestBlockTimestamp() < freezingTimestamp) {
        await increaseBlockTimestampTo(freezingTimestamp);
      }
      let tx = marketUnderLender.freeze(loanId);
      expectedLoanState.freezeTimestamp = calculateTimestampWithOffset(await getTxTimestamp(tx));

      if (props.repaymentAmountWhileFreezing != 0) {
        await increaseBlockTimestampTo(freezingTimestamp + frozenInterval / 2);
        tx = connect(marketUnderLender, borrower).repayLoan(fixture.loanId, repaymentAmountWhileFreezing);
        processRepayment(expectedLoanState, {
          repaymentAmount: repaymentAmountWhileFreezing,
          repaymentTimestamp: await getTxTimestamp(tx)
        });
      }

      if (freezingTimestamp != unfreezingTimestamp) {
        await increaseBlockTimestampTo(props.unfreezingTimestamp);
      }

      // Can be executed by an alias
      await connect(marketUnderLender, alias).unfreeze.staticCall(loanId);

      tx = marketUnderLender.unfreeze(loanId);
      processRepayment(expectedLoanState, { repaymentAmount: 0, repaymentTimestamp: await getTxTimestamp(tx) });
      expectedLoanState.durationInPeriods +=
        calculatePeriodIndex(calculateTimestampWithOffset(unfreezingTimestamp)) -
        calculatePeriodIndex(calculateTimestampWithOffset(freezingTimestamp));
      expectedLoanState.freezeTimestamp = 0;

      await expect(tx).to.emit(marketUnderLender, EVENT_NAME_LOAN_UNFROZEN).withArgs(loanId);
      const actualLoanState: LoanState = await marketUnderLender.getLoanState(loanId);
      checkEquality(actualLoanState, expectedLoanState);
    }

    describe("Executes as expected if", async () => {
      it("Unfreezing is done at the same loan period as the freezing", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoan);
        const startTimestamp = removeTimestampOffset(fixture.initialLoanState.startTimestamp);
        await freezeUnfreezeAndCheck(fixture, {
          freezingTimestamp: startTimestamp,
          unfreezingTimestamp: startTimestamp + PERIOD_IN_SECONDS / 2,
          repaymentAmountWhileFreezing: 0
        });
      });

      it("Unfreezing is done some periods after the freezing", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoan);
        const loanState = fixture.initialLoanState;
        const startTimestamp = removeTimestampOffset(fixture.initialLoanState.startTimestamp);
        const freezingTimestamp = startTimestamp + (loanState.durationInPeriods / 4) * PERIOD_IN_SECONDS;
        const unfreezingTimestamp = startTimestamp + (loanState.durationInPeriods / 2) * PERIOD_IN_SECONDS;
        await freezeUnfreezeAndCheck(fixture, {
          freezingTimestamp,
          unfreezingTimestamp,
          repaymentAmountWhileFreezing: 0
        });
      });

      it("Unfreezing is done some periods after the freezing and after a repayment", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoan);
        const loanState = fixture.initialLoanState;
        const startTimestamp = removeTimestampOffset(fixture.initialLoanState.startTimestamp);
        const freezingTimestamp = startTimestamp + (loanState.durationInPeriods - 1) * PERIOD_IN_SECONDS;
        const unfreezingTimestamp = startTimestamp + (loanState.durationInPeriods * 2) * PERIOD_IN_SECONDS;
        await freezeUnfreezeAndCheck(fixture, {
          freezingTimestamp,
          unfreezingTimestamp,
          repaymentAmountWhileFreezing: REPAYMENT_AMOUNT
        });
      });
    });

    it("Is reverted if the contract is paused", async () => {
      const { market, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);
      await proveTx(market.pause());

      await expect(market.unfreeze(loanId)).to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the loan does not exist", async () => {
      const { market, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);
      const wrongLoanId = loanId + 1;

      await expect(market.unfreeze(wrongLoanId))
        .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_NOT_EXIST);
    });

    it("Is reverted if the loan is already repaid", async () => {
      const { market, marketUnderLender, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);
      await proveTx(connect(market, borrower).repayLoan(loanId, FULL_REPAYMENT_AMOUNT));

      await expect(marketUnderLender.unfreeze(loanId))
        .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_ALREADY_REPAID);
    });

    it("Is reverted if the caller is not the lender or an alias", async () => {
      const { market, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);

      await expect(connect(market, attacker).unfreeze(loanId))
        .to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
    });

    it("Is reverted if the loan is not frozen", async () => {
      const { market, marketUnderLender, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);

      await expect(marketUnderLender.unfreeze(loanId))
        .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_NOT_FROZEN);
    });
  });

  describe("Function 'updateLoanDuration()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { marketUnderLender, initialLoanState, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);
      const newDuration = initialLoanState.durationInPeriods + 1;
      const expectedLoanState: LoanState = { ...initialLoanState };
      expectedLoanState.durationInPeriods = newDuration;

      // Can be called by an alias
      await connect(marketUnderLender, alias).updateLoanDuration.staticCall(loanId, newDuration);

      await expect(marketUnderLender.updateLoanDuration(loanId, newDuration))
        .to.emit(marketUnderLender, EVENT_NAME_LOAN_DURATION_UPDATED)
        .withArgs(loanId, newDuration, DURATION_IN_PERIODS);
      const actualLoanState = await marketUnderLender.getLoanState(loanId);
      checkEquality(actualLoanState, expectedLoanState);
    });

    it("Is reverted if the contract is paused", async () => {
      const { market, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);
      await proveTx(market.pause());

      await expect(market.updateLoanDuration(loanId, DURATION_IN_PERIODS))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the loan does not exist", async () => {
      const { market, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);
      const wrongLoanId = loanId + 1;

      await expect(market.updateLoanDuration(wrongLoanId, DURATION_IN_PERIODS))
        .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_NOT_EXIST);
    });

    it("Is reverted if the loan is already repaid", async () => {
      const { market, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);
      await proveTx(connect(market, borrower).repayLoan(loanId, FULL_REPAYMENT_AMOUNT));

      await expect(market.updateLoanDuration(loanId, DURATION_IN_PERIODS))
        .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_ALREADY_REPAID);
    });

    it("Is reverted if the caller is not the lender or an alias", async () => {
      const { market, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);

      await expect(connect(market, attacker).updateLoanDuration(loanId, DURATION_IN_PERIODS))
        .to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
    });

    it("Is reverted if the new duration is the same as the previous one or less", async () => {
      const { marketUnderLender, initialLoanState, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);
      let newDuration = initialLoanState.durationInPeriods;

      await expect(
        marketUnderLender.updateLoanDuration(loanId, newDuration)
      ).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_INAPPROPRIATE_DURATION_IN_PERIODS);

      newDuration -= 1;
      await expect(
        marketUnderLender.updateLoanDuration(loanId, newDuration)
      ).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_INAPPROPRIATE_DURATION_IN_PERIODS);
    });

    it("Is reverted if the new duration is greater than 32-bit unsigned integer", async () => {
      const { market, marketUnderLender, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);
      const newDuration = maxUintForBits(32) + 1n;

      await expect(marketUnderLender.updateLoanDuration(loanId, newDuration))
        .to.be.revertedWithCustomError(market, ERROR_NAME_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST)
        .withArgs(32, newDuration);
    });
  });

  describe("Function 'updateLoanInterestRatePrimary()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { marketUnderLender, initialLoanState, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);
      const oldInterestRate = initialLoanState.interestRatePrimary;
      const newInterestRate = oldInterestRate - 1;
      const expectedLoanState = { ...initialLoanState };
      expectedLoanState.interestRatePrimary = newInterestRate;

      // Can be executed by an alias
      await connect(marketUnderLender, alias).updateLoanInterestRatePrimary.staticCall(loanId, newInterestRate);

      await expect(marketUnderLender.updateLoanInterestRatePrimary(loanId, newInterestRate))
        .to.emit(marketUnderLender, EVENT_NAME_LOAN_INTEREST_RATE_PRIMARY_UPDATED)
        .withArgs(loanId, newInterestRate, oldInterestRate);
      const actualLoanState = await marketUnderLender.getLoanState(loanId);
      checkEquality(actualLoanState, expectedLoanState);
    });

    it("Is reverted if the contract is paused", async () => {
      const { market, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);
      await proveTx(market.pause());

      await expect(
        market.updateLoanInterestRatePrimary(loanId, INTEREST_RATE_PRIMARY)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the loan does not exist", async () => {
      const { market, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);
      const wrongLoanId = loanId + 1;

      await expect(
        market.updateLoanInterestRatePrimary(wrongLoanId, INTEREST_RATE_PRIMARY)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_NOT_EXIST);
    });

    it("Is reverted if the loan is already repaid", async () => {
      const { marketUnderLender, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);
      await proveTx(connect(marketUnderLender, borrower).repayLoan(loanId, FULL_REPAYMENT_AMOUNT));

      await expect(
        marketUnderLender.updateLoanInterestRatePrimary(loanId, INTEREST_RATE_PRIMARY)
      ).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_LOAN_ALREADY_REPAID);
    });

    it("Is reverted if the caller is not the lender or an alias", async () => {
      const { market, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);

      await expect(
        connect(market, attacker).updateLoanInterestRatePrimary(loanId, INTEREST_RATE_PRIMARY)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
    });

    it("Is is reverted if the new interest rate is the same as the previous one or greater", async () => {
      const { marketUnderLender, initialLoanState, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);
      let newInterestRate = initialLoanState.interestRatePrimary;

      await expect(
        marketUnderLender.updateLoanInterestRatePrimary(loanId, newInterestRate)
      ).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_INAPPROPRIATE_INTEREST_RATE);

      newInterestRate += 1;
      await expect(
        marketUnderLender.updateLoanInterestRatePrimary(loanId, newInterestRate + 1)
      ).to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_INAPPROPRIATE_INTEREST_RATE);
    });
  });

  describe("Function 'updateLoanInterestRateSecondary()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { marketUnderLender, initialLoanState, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);
      const oldInterestRate = initialLoanState.interestRateSecondary;
      const newInterestRate = oldInterestRate - 1;
      const expectedLoanState = { ...initialLoanState };
      expectedLoanState.interestRateSecondary = newInterestRate;

      // Can be executed by an alias
      await connect(marketUnderLender, alias).updateLoanInterestRateSecondary.staticCall(loanId, newInterestRate);

      await expect(marketUnderLender.updateLoanInterestRateSecondary(loanId, newInterestRate))
        .to.emit(marketUnderLender, EVENT_NAME_LOAN_INTEREST_RATE_SECONDARY_UPDATED)
        .withArgs(loanId, newInterestRate, oldInterestRate);
      const actualLoanState = await marketUnderLender.getLoanState(loanId);
      checkEquality(actualLoanState, expectedLoanState);
    });

    it("Is reverted if the contract is paused", async () => {
      const { market, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);
      await proveTx(market.pause());

      await expect(
        market.updateLoanInterestRateSecondary(loanId, INTEREST_RATE_SECONDARY)
      ).to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the loan does not exist", async () => {
      const { market, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);
      const wrongLoanId = loanId + 1;

      await expect(market.updateLoanInterestRateSecondary(wrongLoanId, INTEREST_RATE_SECONDARY))
        .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_NOT_EXIST);
    });

    it("Is reverted if the loan is already repaid", async () => {
      const { market, marketUnderLender, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);
      await proveTx(connect(market, borrower).repayLoan(loanId, FULL_REPAYMENT_AMOUNT));

      await expect(marketUnderLender.updateLoanInterestRateSecondary(loanId, INTEREST_RATE_SECONDARY))
        .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_ALREADY_REPAID);
    });

    it("Is reverted if the caller is not the lender or an alias", async () => {
      const { market, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);

      await expect(connect(market, attacker).updateLoanInterestRateSecondary(loanId, INTEREST_RATE_SECONDARY))
        .to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
    });

    it("Is is reverted if the new interest rate is the same as the previous one or greater", async () => {
      const { marketUnderLender, initialLoanState, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);
      let newInterestRate = initialLoanState.interestRateSecondary;

      await expect(marketUnderLender.updateLoanInterestRateSecondary(loanId, newInterestRate))
        .to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_INAPPROPRIATE_INTEREST_RATE);

      newInterestRate += 1;
      await expect(marketUnderLender.updateLoanInterestRateSecondary(loanId, newInterestRate))
        .to.be.revertedWithCustomError(marketUnderLender, ERROR_NAME_INAPPROPRIATE_INTEREST_RATE);
    });
  });

  describe("Function 'revokeLoan()'", async () => {
    async function revokeAndCheck(fixture: Fixture, props: {
      currentLoanState: LoanState;
      revoker: HardhatEthersSigner;
    }) {
      const { market, loanId } = fixture;
      const expectedLoanState = { ...props.currentLoanState };
      const borrowerBalanceChange = expectedLoanState.repaidAmount - expectedLoanState.borrowAmount;

      if (props.revoker === lender) {
        // Check it can be called by an alias too
        await connect(market, alias).revokeLoan.staticCall(loanId);
      }

      const tx: Promise<TransactionResponse> = connect(market, props.revoker).revokeLoan(loanId);

      expectedLoanState.trackedBalance = 0;
      expectedLoanState.trackedTimestamp = calculateTimestampWithOffset(await getTxTimestamp(tx));

      await expect(tx).to.emit(market, EVENT_NAME_LOAN_REVOKED).withArgs(loanId);
      await expect(tx).to.changeTokenBalances(
        token,
        [borrower, liquidityPool],
        [borrowerBalanceChange, -borrowerBalanceChange]
      );
      const actualLoanState = await market.getLoanState(loanId);
      checkEquality(actualLoanState, expectedLoanState);

      // Check hook calls
      await expect(tx).to.emit(creditLine, EVENT_NAME_ON_AFTER_LOAN_REVOCATION).withArgs(loanId);
      await expect(tx).and.to.emit(liquidityPool, EVENT_NAME_ON_AFTER_LOAN_REVOCATION).withArgs(loanId);
    }

    describe("Executes as expected and emits correct event if", async () => {
      it("Is called by the borrower before the cooldown expiration and with no repayments", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoan);
        const timestamp = removeTimestampOffset(
          fixture.initialLoanState.startTimestamp + (COOLDOWN_IN_PERIODS - 1) * PERIOD_IN_SECONDS
        );
        await increaseBlockTimestampTo(timestamp);
        await revokeAndCheck(fixture, { currentLoanState: fixture.initialLoanState, revoker: borrower });
      });

      it("Is called by the lender with a repayment that is less than the borrow amount", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoan);

        const loanState = { ...fixture.initialLoanState };
        const repaymentAmount = Number(roundMath(fixture.initialLoanState.borrowAmount / 2, ACCURACY_FACTOR));
        const tx = await proveTx(connect(fixture.market, borrower).repayLoan(fixture.loanId, repaymentAmount));
        processRepayment(loanState, { repaymentAmount, repaymentTimestamp: await getBlockTimestamp(tx.blockNumber) });

        const timestamp = removeTimestampOffset(
          fixture.initialLoanState.startTimestamp + (COOLDOWN_IN_PERIODS) * PERIOD_IN_SECONDS + 1
        );
        await increaseBlockTimestampTo(timestamp);

        await revokeAndCheck(fixture, { currentLoanState: loanState, revoker: lender });
      });

      it("Is called by the lender with a repayment that equals the borrow amount", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoan);

        const loanState = { ...fixture.initialLoanState };
        const repaymentAmount = fixture.initialLoanState.borrowAmount;
        const tx = await proveTx(connect(fixture.market, borrower).repayLoan(fixture.loanId, repaymentAmount));
        processRepayment(loanState, { repaymentAmount, repaymentTimestamp: await getBlockTimestamp(tx.blockNumber) });

        const timestamp = removeTimestampOffset(fixture.initialLoanState.startTimestamp + PERIOD_IN_SECONDS / 2);
        await increaseBlockTimestampTo(timestamp);

        await revokeAndCheck(fixture, { currentLoanState: loanState, revoker: lender });
      });

      it("Is called by the lender with a repayment that is greater than the borrow amount", async () => {
        const fixture = await setUpFixture(deployLendingMarketAndTakeLoan);

        const loanState = { ...fixture.initialLoanState };
        const repaymentAmount = fixture.initialLoanState.borrowAmount + ACCURACY_FACTOR;
        const tx = await proveTx(connect(fixture.market, borrower).repayLoan(fixture.loanId, repaymentAmount));
        processRepayment(loanState, { repaymentAmount, repaymentTimestamp: await getBlockTimestamp(tx.blockNumber) });

        const timestamp = removeTimestampOffset(
          fixture.initialLoanState.startTimestamp + (COOLDOWN_IN_PERIODS) * PERIOD_IN_SECONDS
        );
        await increaseBlockTimestampTo(timestamp);

        await revokeAndCheck(fixture, { currentLoanState: loanState, revoker: lender });
      });
    });

    describe("Is reverted if", async () => {
      it("The contract is paused", async () => {
        const { market, marketUnderLender, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);
        await proveTx(market.pause());

        await expect(marketUnderLender.revokeLoan(loanId))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
      });

      it("The loan does not exist", async () => {
        const { market, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);

        await expect(market.revokeLoan(loanId + 1))
          .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_NOT_EXIST);
      });

      it("The loan is already repaid", async () => {
        const { market, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);
        await proveTx(connect(market, borrower).repayLoan(loanId, FULL_REPAYMENT_AMOUNT));

        await expect(market.revokeLoan(loanId))
          .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_ALREADY_REPAID);
      });

      it("The cooldown period has passed when it is called by the borrower", async () => {
        const { market, initialLoanState, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);
        const timestampAfterCooldown =
          removeTimestampOffset(initialLoanState.startTimestamp) + COOLDOWN_IN_PERIODS * PERIOD_IN_SECONDS;
        await increaseBlockTimestampTo(timestampAfterCooldown);

        await expect(connect(market, borrower).revokeLoan(loanId))
          .to.be.revertedWithCustomError(market, ERROR_NAME_COOLDOWN_PERIOD_PASSED);
      });

      it("The caller is not the lender, the borrower, and an alias", async () => {
        const { market, loanId } = await setUpFixture(deployLendingMarketAndTakeLoan);

        await expect(connect(market, attacker).revokeLoan(loanId))
          .to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED);
      });
    });
  });

  describe("Pure functions", async () => {
    it("Function 'calculateOutstandingBalance()' executes as expected", async () => {
      const { market } = await setUpFixture(deployLendingMarketAndTakeLoan);
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
      const { market, initialLoanState } = await setUpFixture(deployLendingMarketAndTakeLoan);
      const timestamp = initialLoanState.startTimestamp;

      const actualPeriodIndex = await market.calculatePeriodIndex(timestamp, PERIOD_IN_SECONDS);
      const expectedPeriodIndex = calculatePeriodIndex(timestamp);

      expect(actualPeriodIndex).to.eq(expectedPeriodIndex);
    });
  });
});
