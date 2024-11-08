import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory, TransactionResponse } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { connect, getAddress, proveTx } from "../../test-utils/eth";
import { checkEquality, setUpFixture } from "../../test-utils/common";

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

interface Version {
  major: number;
  minor: number;
  patch: number;

  [key: string]: number; // Indexing signature to ensure that fields are iterated over in a key-value style
}

const ERROR_NAME_ALREADY_INITIALIZED = "InvalidInitialization";
const ERROR_NAME_ARRAY_LENGTH_MISMATCH = "ArrayLengthMismatch";
const ERROR_NAME_ENFORCED_PAUSED = "EnforcedPause";
const ERROR_NAME_INSUFFICIENT_BALANCE = "InsufficientBalance";
const ERROR_NAME_INVALID_AMOUNT = "InvalidAmount";
const ERROR_NAME_NOT_PAUSED = "ExpectedPause";
const ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED = "AccessControlUnauthorizedAccount";
const ERROR_NAME_UNAUTHORIZED = "Unauthorized";
const ERROR_NAME_ZERO_ADDRESS = "ZeroAddress";
const ERROR_NAME_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST = "SafeCastOverflowedUintDowncast";

const EVENT_NAME_APPROVAL = "Approval";
const EVENT_NAME_AUTO_REPAYMENT = "AutoRepayment";
const EVENT_NAME_DEPOSIT = "Deposit";
const EVENT_NAME_HOOK_CALL_RESULT = "HookCallResult";
const EVENT_NAME_PAUSED = "Paused";
const EVENT_NAME_REPAY_LOAN_CALLED = "RepayLoanCalled";
const EVENT_NAME_UNPAUSED = "Unpaused";
const EVENT_NAME_WITHDRAWAL = "Withdrawal";
const EVENT_NAME_RESCUE = "Rescue";

const OWNER_ROLE = ethers.id("OWNER_ROLE");
const PAUSER_ROLE = ethers.id("PAUSER_ROLE");
const ADMIN_ROLE = ethers.id("ADMIN_ROLE");

const ZERO_ADDRESS = ethers.ZeroAddress;
const MINT_AMOUNT = 1000000;
const DEPOSIT_AMOUNT = 10000;
const DEFAULT_LOAN_ID = 123;
const DEFAULT_ADDON_AMOUNT = 10;
const DEFAULT_REPAY_AMOUNT = 322;
const AUTO_REPAY_LOAN_IDS = [1, 2, 3];
const AUTO_REPAY_AMOUNTS = [4, 5, 6];
const EXPECTED_VERSION: Version = {
  major: 1,
  minor: 0,
  patch: 0
};

describe("Contract 'LiquidityPoolAccountable'", async () => {
  let liquidityPoolFactory: ContractFactory;
  let tokenFactory: ContractFactory;
  let marketFactory: ContractFactory;

  let market: Contract;
  let token: Contract;

  let deployer: HardhatEthersSigner;
  let lender: HardhatEthersSigner;
  let admin: HardhatEthersSigner;
  let attacker: HardhatEthersSigner;

  let tokenAddress: string;
  let marketAddress: string;

  before(async () => {
    [deployer, lender, admin, attacker] = await ethers.getSigners();

    // Factories with an explicitly specified deployer account
    liquidityPoolFactory = await ethers.getContractFactory("LiquidityPoolAccountable");
    liquidityPoolFactory = liquidityPoolFactory.connect(deployer);
    tokenFactory = await ethers.getContractFactory("ERC20Mock");
    tokenFactory = tokenFactory.connect(deployer);
    marketFactory = await ethers.getContractFactory("LendingMarketMock");
    marketFactory = marketFactory.connect(deployer);

    market = await marketFactory.deploy() as Contract;
    await market.waitForDeployment();
    market = connect(market, deployer); // Explicitly specifying the initial account
    marketAddress = getAddress(market);

    token = await tokenFactory.deploy() as Contract;
    await token.waitForDeployment();
    token = connect(token, deployer); // Explicitly specifying the initial account
    tokenAddress = getAddress(token);
    await token.mint(lender.address, MINT_AMOUNT);
  });

  async function deployLiquidityPool(): Promise<{ liquidityPool: Contract }> {
    let liquidityPool = await upgrades.deployProxy(liquidityPoolFactory, [
      lender.address,
      marketAddress,
      tokenAddress
    ]);

    await liquidityPool.waitForDeployment();
    liquidityPool = connect(liquidityPool, lender); // Explicitly specifying the initial account

    await proveTx(connect(token, lender).approve(getAddress(liquidityPool), ethers.MaxUint256));
    await proveTx(liquidityPool.grantRole(PAUSER_ROLE, lender.address));
    return { liquidityPool };
  }

  async function prepareLoan(
    liquidityPool: Contract,
    loanProps: {
      borrowAmount: number;
      loanId: number;
      addonAmount: number;
      repaidAmount?: number;
    }
  ) {
    await proveTx(liquidityPool.deposit(loanProps.borrowAmount));
    const loanState: LoanState = {
      programId: 0,
      borrowAmount: loanProps.borrowAmount,
      addonAmount: loanProps.addonAmount,
      startTimestamp: 0,
      durationInPeriods: 0,
      token: ZERO_ADDRESS,
      borrower: ZERO_ADDRESS,
      interestRatePrimary: 0,
      interestRateSecondary: 0,
      repaidAmount: loanProps.repaidAmount || 0,
      trackedBalance: 0,
      trackedTimestamp: 0,
      freezeTimestamp: 0
    };
    await proveTx(market.mockLoanState(loanProps.loanId, loanState));
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);
      expect(await liquidityPool.hasRole(OWNER_ROLE, lender.address)).to.eq(true);
      expect(await liquidityPool.isAdmin(lender.address)).to.eq(false);
      expect(await liquidityPool.market()).to.eq(marketAddress);
      expect(await liquidityPool.token()).to.eq(tokenAddress);
      expect(await liquidityPool.paused()).to.eq(false);
    });

    it("Is reverted if the market address is zero", async () => {
      await expect(upgrades.deployProxy(liquidityPoolFactory, [
        ZERO_ADDRESS, // market
        lender.address,
        tokenAddress
      ])).to.be.revertedWithCustomError(liquidityPoolFactory, ERROR_NAME_ZERO_ADDRESS);
    });

    it("Is reverted if the lender address is zero", async () => {
      await expect(upgrades.deployProxy(liquidityPoolFactory, [
        marketAddress,
        ZERO_ADDRESS, // lender
        tokenAddress
      ])).to.be.revertedWithCustomError(liquidityPoolFactory, ERROR_NAME_ZERO_ADDRESS);
    });

    it("Is reverted if the token address is zero", async () => {
      await expect(upgrades.deployProxy(liquidityPoolFactory, [
        marketAddress,
        lender.address,
        ZERO_ADDRESS // token
      ])).to.be.revertedWithCustomError(liquidityPoolFactory, ERROR_NAME_ZERO_ADDRESS);
    });

    it("Is reverted if called a second time", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await expect(liquidityPool.initialize(marketAddress, lender.address, tokenAddress))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ALREADY_INITIALIZED);
    });
  });

  describe("Function '$__VERSION()'", async () => {
    it("Returns expected values", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);
      const liquidityPoolVersion = await liquidityPool.$__VERSION();
      checkEquality(liquidityPoolVersion, EXPECTED_VERSION);
    });
  });

  describe("Function 'pause()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await expect(liquidityPool.pause())
        .to.emit(liquidityPool, EVENT_NAME_PAUSED)
        .withArgs(lender.address);
      expect(await liquidityPool.paused()).to.eq(true);
    });

    it("Is reverted if the caller is not the pauser", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await expect(connect(liquidityPool, attacker).pause())
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(attacker.address, PAUSER_ROLE);
    });

    it("Is reverted if the contract is already paused", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await proveTx(liquidityPool.pause());
      await expect(liquidityPool.pause())
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ENFORCED_PAUSED);
    });
  });

  describe("Function 'unpause()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await proveTx(liquidityPool.pause());
      expect(await liquidityPool.paused()).to.eq(true);

      await expect(liquidityPool.unpause())
        .to.emit(liquidityPool, EVENT_NAME_UNPAUSED)
        .withArgs(lender.address);

      expect(await liquidityPool.paused()).to.eq(false);
    });

    it("Is reverted if the caller is not the pauser", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await expect(connect(liquidityPool, attacker).unpause())
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(attacker.address, PAUSER_ROLE);
    });

    it("Is reverted if the contract is not paused yet", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await expect(liquidityPool.unpause())
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_NOT_PAUSED);
    });
  });

  describe("Function 'deposit()'", async () => {
    async function depositAndCheck(liquidityPool: Contract): Promise<TransactionResponse> {
      const balanceBefore = await liquidityPool.getBalances();

      const tx: Promise<TransactionResponse> = liquidityPool.deposit(DEPOSIT_AMOUNT);

      await expect(tx).to.changeTokenBalances(
        token,
        [lender.address, getAddress(liquidityPool)],
        [-DEPOSIT_AMOUNT, +DEPOSIT_AMOUNT]
      );

      await expect(tx)
        .to.emit(liquidityPool, EVENT_NAME_DEPOSIT)
        .withArgs(DEPOSIT_AMOUNT);

      const balanceAfter = await liquidityPool.getBalances();

      expect(balanceAfter[0] - BigInt(DEPOSIT_AMOUNT)).to.eq(balanceBefore[0]);

      return tx;
    }

    it("Executes as expected and emits the correct events", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      // First deposit must change the allowance from the liquidity pool to the market

      const allowanceBefore = await token.allowance(getAddress(liquidityPool), getAddress(market));
      expect(allowanceBefore).to.eq(0);

      const tx1: Promise<TransactionResponse> = depositAndCheck(liquidityPool);
      await expect(tx1).to.emit(token, EVENT_NAME_APPROVAL);

      const allowanceAfter = await token.allowance(getAddress(liquidityPool), getAddress(market));
      expect(allowanceAfter).to.eq(ethers.MaxUint256);

      // Second deposit must not change the allowance from the liquidity pool to the market
      const tx2: Promise<TransactionResponse> = depositAndCheck(liquidityPool);
      await expect(tx2).not.to.emit(token, EVENT_NAME_APPROVAL);
    });

    it("Is reverted if the caller is not the owner", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await expect(connect(liquidityPool, attacker).deposit(DEPOSIT_AMOUNT))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(attacker.address, OWNER_ROLE);
    });

    it("Is reverted if the deposit amount is zero", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await expect(liquidityPool.deposit(0))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_INVALID_AMOUNT);
    });

    it("Is reverted if the deposit amount is greater than 64-bit unsigned integer", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);
      const amount = BigInt(2) ** 64n + 1n;

      await expect(liquidityPool.deposit(amount))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST)
        .withArgs(64, amount);
    });
  });

  describe("Function 'withdraw()'", async () => {
    async function withdrawAndCheck(liquidityPool: Contract, borrowableAmount: number, addonAmount: number) {
      const tx: Promise<TransactionResponse> = liquidityPool.withdraw(borrowableAmount, addonAmount);

      await expect(tx).to.changeTokenBalances(
        token,
        [lender.address, getAddress(liquidityPool)],
        [+(borrowableAmount + addonAmount), -(borrowableAmount + addonAmount)]
      );

      await expect(tx)
        .to.emit(liquidityPool, EVENT_NAME_WITHDRAWAL)
        .withArgs(borrowableAmount, addonAmount);
    }

    it("Executes as expected and emits correct event if withdrawing borrowable balance", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);
      await proveTx(liquidityPool.deposit(DEPOSIT_AMOUNT));
      await withdrawAndCheck(liquidityPool, DEPOSIT_AMOUNT, 0);
    });

    it("Executes as expected and emits correct event if withdrawing addon balance", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);
      await prepareLoan(liquidityPool, {
        borrowAmount: DEPOSIT_AMOUNT,
        loanId: DEFAULT_LOAN_ID,
        addonAmount: DEFAULT_ADDON_AMOUNT
      });
      await proveTx(liquidityPool.deposit(DEPOSIT_AMOUNT));
      await proveTx(market.callOnBeforeLoanTakenLiquidityPool(getAddress(liquidityPool), DEFAULT_LOAN_ID));
      await withdrawAndCheck(liquidityPool, 0, DEFAULT_ADDON_AMOUNT);
    });

    it("Is reverted if the caller is not the owner", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await expect(connect(liquidityPool, attacker).withdraw(DEPOSIT_AMOUNT, 0))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(attacker.address, OWNER_ROLE);
    });

    it("Is reverted if both amounts are zero", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await expect(liquidityPool.withdraw(0, 0))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_INVALID_AMOUNT);
    });

    it("Is reverted if a borrowable balance is withdrawn with a greater amount", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);
      await proveTx(liquidityPool.deposit(DEPOSIT_AMOUNT));

      await expect(liquidityPool.withdraw(0, DEFAULT_ADDON_AMOUNT + 1))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_INSUFFICIENT_BALANCE);
    });

    it("Is reverted if the credit line balance is zero", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);
      // Make the pool token balance enough for the withdrawal
      await proveTx(token.mint(getAddress(liquidityPool), DEPOSIT_AMOUNT));

      await expect(liquidityPool.withdraw(DEPOSIT_AMOUNT, 0))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_INSUFFICIENT_BALANCE);
    });
  });

  describe("Function 'rescue()'", async () => {
    it("Executes as expected and emits correct event", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);
      await proveTx(token.mint(getAddress(liquidityPool), DEPOSIT_AMOUNT));

      const tx: Promise<TransactionResponse> = liquidityPool.rescue(tokenAddress, DEPOSIT_AMOUNT);

      await expect(tx).to.changeTokenBalances(
        token,
        [lender.address, getAddress(liquidityPool)],
        [+(DEPOSIT_AMOUNT), -(DEPOSIT_AMOUNT)]
      );

      await expect(tx)
        .to.emit(liquidityPool, EVENT_NAME_RESCUE)
        .withArgs(tokenAddress, DEPOSIT_AMOUNT);
    });

    it("Is reverted if token address is zero", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await expect(liquidityPool.rescue(ZERO_ADDRESS, DEPOSIT_AMOUNT))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ZERO_ADDRESS);
    });

    it("Is reverted if rescue amount is zero", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await expect(liquidityPool.rescue(tokenAddress, 0))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_INVALID_AMOUNT);
    });

    it("Is reverted if caller is not the owner", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await expect(connect(liquidityPool, attacker).rescue(tokenAddress, DEPOSIT_AMOUNT))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(attacker.address, OWNER_ROLE);
    });
  });

  describe("Function 'autoRepay()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);
      await proveTx(liquidityPool.grantRole(ADMIN_ROLE, admin.address));

      const tx: Promise<TransactionResponse> =
        connect(liquidityPool, admin).autoRepay(AUTO_REPAY_LOAN_IDS, AUTO_REPAY_AMOUNTS);
      await expect(tx)
        .to.emit(liquidityPool, EVENT_NAME_AUTO_REPAYMENT)
        .withArgs(AUTO_REPAY_LOAN_IDS.length);

      for (let i = 0; i < AUTO_REPAY_LOAN_IDS.length; i++) {
        await expect(tx)
          .to.emit(market, EVENT_NAME_REPAY_LOAN_CALLED)
          .withArgs(AUTO_REPAY_LOAN_IDS[i], AUTO_REPAY_AMOUNTS[i]);
      }
    });

    it("Is reverted if the caller is not an admin", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await expect(connect(liquidityPool, attacker).autoRepay(AUTO_REPAY_LOAN_IDS, AUTO_REPAY_AMOUNTS))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(attacker.address, ADMIN_ROLE);

      // Even the lender cannot execute the auto repayments
      await expect(connect(liquidityPool, lender).autoRepay(AUTO_REPAY_LOAN_IDS, AUTO_REPAY_AMOUNTS))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(lender.address, ADMIN_ROLE);
    });

    it("Is reverted if the lengths of the arrays do not match", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);
      await proveTx(liquidityPool.grantRole(ADMIN_ROLE, admin.address));

      AUTO_REPAY_LOAN_IDS.pop();

      await expect(connect(liquidityPool, admin).autoRepay(AUTO_REPAY_LOAN_IDS, AUTO_REPAY_AMOUNTS))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ARRAY_LENGTH_MISMATCH);
    });
  });

  describe("Function 'onBeforeLoanTaken()'", async () => {
    it("Executes as expected", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await prepareLoan(liquidityPool, {
        borrowAmount: DEPOSIT_AMOUNT,
        loanId: DEFAULT_LOAN_ID,
        addonAmount: DEFAULT_ADDON_AMOUNT
      });

      await proveTx(liquidityPool.deposit(DEPOSIT_AMOUNT));

      const balanceBefore = await liquidityPool.getBalances();

      await expect(market.callOnBeforeLoanTakenLiquidityPool(getAddress(liquidityPool), DEFAULT_LOAN_ID))
        .to.emit(market, EVENT_NAME_HOOK_CALL_RESULT)
        .withArgs(true);

      const balanceAfter = await liquidityPool.getBalances();

      expect(balanceAfter[0]).to.eq(balanceBefore[0] - BigInt(DEPOSIT_AMOUNT + DEFAULT_ADDON_AMOUNT));
      expect(balanceAfter[1]).to.eq(balanceBefore[1] + BigInt(DEFAULT_ADDON_AMOUNT));
    });

    it("Is reverted if the contract is paused", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);
      await proveTx(liquidityPool.pause());

      await expect(market.callOnBeforeLoanTakenLiquidityPool(getAddress(liquidityPool), DEFAULT_LOAN_ID))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the caller is not the market", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await expect(liquidityPool.onBeforeLoanTaken(DEFAULT_LOAN_ID))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_UNAUTHORIZED);
    });
  });

  describe("Function 'onAfterLoanPayment()'", async () => {
    it("Executes as expected and changes borrowable balance", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await prepareLoan(liquidityPool, {
        borrowAmount: DEPOSIT_AMOUNT,
        loanId: DEFAULT_LOAN_ID,
        addonAmount: DEFAULT_ADDON_AMOUNT
      });

      const balanceBefore = await liquidityPool.getBalances();

      await expect(market.callOnAfterLoanPaymentLiquidityPool(
        getAddress(liquidityPool),
        DEFAULT_LOAN_ID,
        DEFAULT_REPAY_AMOUNT
      )).to.emit(
        market,
        EVENT_NAME_HOOK_CALL_RESULT
      ).withArgs(true);

      const balanceAfter = await liquidityPool.getBalances();

      expect(balanceAfter[0]).to.eq(balanceBefore[0] + BigInt(DEFAULT_REPAY_AMOUNT));
    });

    it("Is reverted if the contract is paused", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);
      await proveTx(liquidityPool.pause());

      await expect(
        market.callOnAfterLoanPaymentLiquidityPool(getAddress(liquidityPool), DEFAULT_LOAN_ID, DEFAULT_REPAY_AMOUNT)
      ).to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the caller is not the market", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await expect(liquidityPool.onAfterLoanPayment(DEFAULT_LOAN_ID, DEFAULT_REPAY_AMOUNT))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_UNAUTHORIZED);
    });
  });

  describe("Function 'onAfterLoanRevocation()'", async () => {
    it("Executes as expected if borrow amount is bigger than repaid amount", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await proveTx(liquidityPool.deposit(DEPOSIT_AMOUNT));

      await prepareLoan(liquidityPool, {
        borrowAmount: DEPOSIT_AMOUNT,
        loanId: DEFAULT_LOAN_ID,
        addonAmount: DEFAULT_ADDON_AMOUNT
      });

      await proveTx(market.callOnBeforeLoanTakenLiquidityPool(getAddress(liquidityPool), DEFAULT_LOAN_ID));

      await expect(market.callOnAfterLoanRevocationLiquidityPool(getAddress(liquidityPool), DEFAULT_LOAN_ID))
        .to.emit(market, EVENT_NAME_HOOK_CALL_RESULT)
        .withArgs(true);
    });

    it("Executes as expected if borrow amount is bigger than repaid amount", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await proveTx(liquidityPool.deposit(DEPOSIT_AMOUNT));

      await prepareLoan(liquidityPool, {
        borrowAmount: DEPOSIT_AMOUNT,
        loanId: DEFAULT_LOAN_ID,
        addonAmount: DEFAULT_ADDON_AMOUNT,
        repaidAmount: DEPOSIT_AMOUNT + 1
      });

      await proveTx(market.callOnBeforeLoanTakenLiquidityPool(getAddress(liquidityPool), DEFAULT_LOAN_ID));
      await proveTx(market.callOnAfterLoanPaymentLiquidityPool(
        getAddress(liquidityPool),
        DEFAULT_LOAN_ID,
        DEFAULT_REPAY_AMOUNT
      ));

      await expect(market.callOnAfterLoanRevocationLiquidityPool(getAddress(liquidityPool), DEFAULT_LOAN_ID))
        .to.emit(market, EVENT_NAME_HOOK_CALL_RESULT)
        .withArgs(true);
    });
  });
});
