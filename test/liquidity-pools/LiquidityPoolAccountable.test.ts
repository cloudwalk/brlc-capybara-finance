import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory, TransactionResponse } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { connect, getAddress, proveTx } from "../../test-utils/eth";
import { checkEquality, maxUintForBits, setUpFixture } from "../../test-utils/common";

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

const ERROR_NAME_ADDON_TREASURY_ADDRESS_ZEROING_PROHIBITED = "AddonTreasuryAddressZeroingProhibited";
const ERROR_NAME_ADDON_TREASURY_ZERO_ALLOWANCE = "AddonTreasuryZeroAllowance";
const ERROR_NAME_ALREADY_CONFIGURED = "AlreadyConfigured";
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
const EVENT_NAME_ADDON_TREASURY_CHANGED = "AddonTreasuryChanged";
const EVENT_NAME_AUTO_REPAYMENT = "AutoRepayment";
const EVENT_NAME_DEPOSIT = "Deposit";
const EVENT_NAME_HOOK_CALL_RESULT = "HookCallResult";
const EVENT_NAME_PAUSED = "Paused";
const EVENT_NAME_REPAY_LOAN_CALLED = "RepayLoanCalled";
const EVENT_NAME_RESCUE = "Rescue";
const EVENT_NAME_UNPAUSED = "Unpaused";
const EVENT_NAME_WITHDRAWAL = "Withdrawal";

const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
const OWNER_ROLE = ethers.id("OWNER_ROLE");
const PAUSER_ROLE = ethers.id("PAUSER_ROLE");
const ADMIN_ROLE = ethers.id("ADMIN_ROLE");

const ZERO_ADDRESS = ethers.ZeroAddress;
const MAX_ALLOWANCE = ethers.MaxUint256;
const ZERO_ALLOWANCE = 0;
const MINT_AMOUNT = 1000_000_000_000n;
const DEPOSIT_AMOUNT = MINT_AMOUNT / 10n;
const BORROW_AMOUNT = DEPOSIT_AMOUNT / 10n;
const ADDON_AMOUNT = BORROW_AMOUNT / 10n;
const REPAY_AMOUNT = BORROW_AMOUNT / 5n;
const LOAN_ID = 123n;
const AUTO_REPAY_LOAN_IDS = [123n, 234n, 345n, 123n];
const AUTO_REPAY_AMOUNTS = [10_123_456n, 1n, maxUintForBits(256), 0n];
const EXPECTED_VERSION: Version = {
  major: 1,
  minor: 3,
  patch: 0
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
  let addonTreasury: HardhatEthersSigner;

  let tokenAddress: string;
  let marketAddress: string;

  before(async () => {
    [deployer, lender, admin, attacker, addonTreasury] = await ethers.getSigners();

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
    await token.mint(addonTreasury.address, MINT_AMOUNT);
  });

  async function deployLiquidityPool(): Promise<{ liquidityPool: Contract }> {
    let liquidityPool = await upgrades.deployProxy(liquidityPoolFactory, [
      lender.address,
      marketAddress,
      tokenAddress
    ]);

    await liquidityPool.waitForDeployment();
    liquidityPool = connect(liquidityPool, lender); // Explicitly specifying the initial account

    await proveTx(connect(token, lender).approve(getAddress(liquidityPool), MAX_ALLOWANCE));
    await proveTx(connect(token, addonTreasury).approve(getAddress(liquidityPool), MAX_ALLOWANCE));
    return { liquidityPool };
  }

  async function deployAndConfigureLiquidityPool(): Promise<{ liquidityPool: Contract }> {
    const { liquidityPool } = await deployLiquidityPool();
    await proveTx(liquidityPool.grantRole(PAUSER_ROLE, lender.address));
    return { liquidityPool };
  }

  async function prepareLoan(
    loanProps: {
      loanId: bigint;
      borrowAmount: bigint;
      addonAmount: bigint;
      repaidAmount?: bigint;
    }
  ) {
    const loanState: LoanState = {
      ...defaultLoanState,
      borrowAmount: loanProps.borrowAmount,
      addonAmount: loanProps.addonAmount,
      repaidAmount: loanProps.repaidAmount || 0n
    };
    await proveTx(market.mockLoanState(loanProps.loanId, loanState));
  }

  async function prepareCertainBalances(liquidityPool: Contract, props: {
    borrowableBalance: bigint;
    addonBalance: bigint;
  }) {
    const addonAmount = props.addonBalance;
    const depositAmount = props.borrowableBalance + BORROW_AMOUNT + props.addonBalance;
    await proveTx(liquidityPool.deposit(depositAmount));
    await prepareLoan({ borrowAmount: BORROW_AMOUNT, loanId: LOAN_ID, addonAmount });
    await proveTx(market.callOnBeforeLoanTakenLiquidityPool(getAddress(liquidityPool), LOAN_ID));
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);
      // Role hashes
      expect(await liquidityPool.OWNER_ROLE()).to.equal(OWNER_ROLE);
      expect(await liquidityPool.ADMIN_ROLE()).to.equal(ADMIN_ROLE);
      expect(await liquidityPool.PAUSER_ROLE()).to.equal(PAUSER_ROLE);

      // The role admins
      expect(await liquidityPool.getRoleAdmin(OWNER_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await liquidityPool.getRoleAdmin(ADMIN_ROLE)).to.equal(OWNER_ROLE);
      expect(await liquidityPool.getRoleAdmin(PAUSER_ROLE)).to.equal(OWNER_ROLE);

      // The lender should have the owner role, but not the other roles
      expect(await liquidityPool.hasRole(OWNER_ROLE, lender.address)).to.equal(true);
      expect(await liquidityPool.hasRole(ADMIN_ROLE, lender.address)).to.equal(false);
      expect(await liquidityPool.hasRole(PAUSER_ROLE, lender.address)).to.equal(false);

      // The initial contract state is unpaused
      expect(await liquidityPool.paused()).to.equal(false);

      // Other important parameters and storage variables
      expect(await liquidityPool.getBalances()).to.deep.eq([0n, 0n]);
      expect(await liquidityPool.isAdmin(lender.address)).to.eq(false);
      expect(await liquidityPool.market()).to.eq(marketAddress);
      expect(await liquidityPool.token()).to.eq(tokenAddress);
      expect(await liquidityPool.addonTreasury()).to.eq(ZERO_ADDRESS);
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
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

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

  describe("Function 'setAddonTreasury()", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);
      const allowance = 1; // This allowance should be enough
      await proveTx(connect(token, addonTreasury).approve(getAddress(liquidityPool), allowance));

      await expect(liquidityPool.setAddonTreasury(addonTreasury.address))
        .to.emit(liquidityPool, EVENT_NAME_ADDON_TREASURY_CHANGED)
        .withArgs(addonTreasury.address, ZERO_ADDRESS);

      expect(await liquidityPool.addonTreasury()).to.eq(addonTreasury.address);
    });

    it("Is reverted if caller does not have the owner role", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await expect(connect(liquidityPool, attacker).setAddonTreasury(addonTreasury.address))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(attacker.address, OWNER_ROLE);
    });

    it("Is reverted if caller does not have the owner role", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await expect(connect(liquidityPool, attacker).setAddonTreasury(addonTreasury.address))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(attacker.address, OWNER_ROLE);
    });

    it("Is reverted if the new addon treasury address is the same as the previous one", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await expect(liquidityPool.setAddonTreasury(ZERO_ADDRESS))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ALREADY_CONFIGURED);

      await proveTx(liquidityPool.setAddonTreasury(addonTreasury.address));

      await expect(liquidityPool.setAddonTreasury(addonTreasury.address))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ALREADY_CONFIGURED);
    });

    it("Is reverted if the addon treasury address is zeroed", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);
      await proveTx(liquidityPool.setAddonTreasury(addonTreasury.address));

      await expect(liquidityPool.setAddonTreasury(ZERO_ADDRESS))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ADDON_TREASURY_ADDRESS_ZEROING_PROHIBITED);
    });

    it("Is reverted if the addon treasury has not provided an allowance for the pool", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);
      await proveTx(connect(token, addonTreasury).approve(getAddress(liquidityPool), ZERO_ALLOWANCE));

      await expect(liquidityPool.setAddonTreasury(addonTreasury.address))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ADDON_TREASURY_ZERO_ALLOWANCE);
    });
  });

  describe("Function 'pause()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await expect(liquidityPool.pause())
        .to.emit(liquidityPool, EVENT_NAME_PAUSED)
        .withArgs(lender.address);
      expect(await liquidityPool.paused()).to.eq(true);
    });

    it("Is reverted if the caller does not have the pauser role", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await expect(connect(liquidityPool, attacker).pause())
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(attacker.address, PAUSER_ROLE);
    });

    it("Is reverted if the contract is already paused", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await proveTx(liquidityPool.pause());
      await expect(liquidityPool.pause())
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ENFORCED_PAUSED);
    });
  });

  describe("Function 'unpause()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await proveTx(liquidityPool.pause());
      expect(await liquidityPool.paused()).to.eq(true);

      await expect(liquidityPool.unpause())
        .to.emit(liquidityPool, EVENT_NAME_UNPAUSED)
        .withArgs(lender.address);

      expect(await liquidityPool.paused()).to.eq(false);
    });

    it("Is reverted if the caller does not have the pauser role", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await expect(connect(liquidityPool, attacker).unpause())
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(attacker.address, PAUSER_ROLE);
    });

    it("Is reverted if the contract is not paused yet", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await expect(liquidityPool.unpause())
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_NOT_PAUSED);
    });
  });

  describe("Function 'deposit()'", async () => {
    async function depositAndCheck(
      liquidityPool: Contract,
      depositAmount: bigint
    ): Promise<TransactionResponse> {
      const balancesBefore = await liquidityPool.getBalances();

      const tx: Promise<TransactionResponse> = liquidityPool.deposit(depositAmount);

      await expect(tx).to.changeTokenBalances(
        token,
        [lender.address, getAddress(liquidityPool)],
        [-depositAmount, depositAmount]
      );

      await expect(tx)
        .to.emit(liquidityPool, EVENT_NAME_DEPOSIT)
        .withArgs(depositAmount);

      const balancesAfter = await liquidityPool.getBalances();

      expect(balancesAfter[0]).to.eq(balancesBefore[0] + depositAmount);
      expect(balancesAfter[1]).to.eq(0n);

      return tx;
    }

    it("Executes as expected and emits the correct event", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      // First deposit must change the allowance from the liquidity pool to the market

      const allowanceBefore = await token.allowance(getAddress(liquidityPool), getAddress(market));
      expect(allowanceBefore).to.eq(0);

      const tx1: Promise<TransactionResponse> = depositAndCheck(liquidityPool, DEPOSIT_AMOUNT);
      await expect(tx1).to.emit(token, EVENT_NAME_APPROVAL);

      const allowanceAfter = await token.allowance(getAddress(liquidityPool), getAddress(market));
      expect(allowanceAfter).to.eq(MAX_ALLOWANCE);

      // Second deposit must not change the allowance from the liquidity pool to the market
      const tx2: Promise<TransactionResponse> = depositAndCheck(liquidityPool, DEPOSIT_AMOUNT * 2n);
      await expect(tx2).not.to.emit(token, EVENT_NAME_APPROVAL);
    });

    it("Is reverted if the caller does not have the owner role", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await expect(connect(liquidityPool, attacker).deposit(DEPOSIT_AMOUNT))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(attacker.address, OWNER_ROLE);
    });

    it("Is reverted if the deposit amount is zero", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await expect(liquidityPool.deposit(0))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_INVALID_AMOUNT);
    });

    it("Is reverted if the deposit amount is greater than 64-bit unsigned integer", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const amount = maxUintForBits(64) + 1n;

      await expect(liquidityPool.deposit(amount))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST)
        .withArgs(64, amount);
    });
  });

  describe("Function 'withdraw()'", async () => {
    async function withdrawAndCheck(liquidityPool: Contract, props: {
      borrowableBalance: bigint;
      addonBalance: bigint;
      borrowableAmount: bigint;
      addonAmount: bigint;
    }) {
      const { borrowableAmount, addonAmount, borrowableBalance, addonBalance } = props;
      const tx: Promise<TransactionResponse> = liquidityPool.withdraw(borrowableAmount, addonAmount);

      await expect(tx).to.changeTokenBalances(
        token,
        [lender.address, getAddress(liquidityPool)],
        [(borrowableAmount + addonAmount), -(borrowableAmount + addonAmount)]
      );
      await expect(tx)
        .to.emit(liquidityPool, EVENT_NAME_WITHDRAWAL)
        .withArgs(borrowableAmount, addonAmount);

      const actualBalancesAfter: bigint[] = await liquidityPool.getBalances();
      expect(actualBalancesAfter[0]).to.eq(borrowableBalance - borrowableAmount);
      expect(actualBalancesAfter[1]).to.eq(addonBalance - addonAmount);
    }

    it("Executes as expected if only the borrowable balance is withdrawn", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const borrowableBalance = BORROW_AMOUNT * 2n;
      const addonBalance = ADDON_AMOUNT * 2n;
      await prepareCertainBalances(liquidityPool, { borrowableBalance, addonBalance });
      await withdrawAndCheck(liquidityPool, {
        borrowableBalance,
        addonBalance,
        borrowableAmount: BORROW_AMOUNT,
        addonAmount: 0n
      });
    });

    it("Executes as expected if only the addon balance is withdrawn", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const borrowableBalance = BORROW_AMOUNT * 2n;
      const addonBalance = ADDON_AMOUNT * 2n;
      await prepareCertainBalances(liquidityPool, { borrowableBalance, addonBalance });
      await withdrawAndCheck(liquidityPool, {
        borrowableBalance,
        addonBalance,
        borrowableAmount: 0n,
        addonAmount: ADDON_AMOUNT
      });
    });

    it("Executes as expected if both the balances are withdrawn", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const borrowableBalance = BORROW_AMOUNT * 2n;
      const addonBalance = ADDON_AMOUNT * 2n;
      await prepareCertainBalances(liquidityPool, { borrowableBalance, addonBalance });
      await withdrawAndCheck(liquidityPool, {
        borrowableBalance,
        addonBalance,
        borrowableAmount: borrowableBalance,
        addonAmount: addonBalance
      });
    });

    it("Is reverted if the caller does not have the owner role", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await expect(connect(liquidityPool, attacker).withdraw(0, 0))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(attacker.address, OWNER_ROLE);
    });

    it("Is reverted if the both amounts are zero", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await expect(liquidityPool.withdraw(0, 0))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_INVALID_AMOUNT);
    });

    it("Is reverted if the borrowable balance is withdrawn with a greater amount", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      await proveTx(liquidityPool.deposit(DEPOSIT_AMOUNT));

      await expect(liquidityPool.withdraw(DEPOSIT_AMOUNT + 1n, 0n))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_INSUFFICIENT_BALANCE);
    });

    it("Is reverted if the addon balance is withdrawn with a greater amount", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      await prepareCertainBalances(liquidityPool, { borrowableBalance: DEPOSIT_AMOUNT, addonBalance: ADDON_AMOUNT });

      await expect(liquidityPool.withdraw(0n, ADDON_AMOUNT + 1n))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_INSUFFICIENT_BALANCE);
    });

    it("Is reverted if the credit line balance is zero", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      // Make the pool token balance enough for the withdrawal
      await proveTx(token.mint(getAddress(liquidityPool), DEPOSIT_AMOUNT));

      await expect(liquidityPool.withdraw(DEPOSIT_AMOUNT, 0))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_INSUFFICIENT_BALANCE);
    });
  });

  describe("Function 'rescue()'", async () => {
    const balance = 123456789n;
    const rescuedAmount = 123456780n;

    it("Executes as expected and emits the correct event", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      await proveTx(token.mint(getAddress(liquidityPool), balance));

      const tx: Promise<TransactionResponse> = liquidityPool.rescue(tokenAddress, rescuedAmount);

      await expect(tx).to.changeTokenBalances(
        token,
        [lender.address, getAddress(liquidityPool)],
        [(rescuedAmount), -(rescuedAmount)]
      );

      await expect(tx)
        .to.emit(liquidityPool, EVENT_NAME_RESCUE)
        .withArgs(tokenAddress, rescuedAmount);
    });

    it("Is reverted if the provided token address is zero", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await expect(liquidityPool.rescue(ZERO_ADDRESS, rescuedAmount))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ZERO_ADDRESS);
    });

    it("Is reverted if provided rescued amount is zero", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await expect(liquidityPool.rescue(tokenAddress, 0))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_INVALID_AMOUNT);
    });

    it("Is reverted if caller does not have the owner role", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await expect(connect(liquidityPool, attacker).rescue(tokenAddress, rescuedAmount))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(attacker.address, OWNER_ROLE);
    });
  });

  describe("Function 'autoRepay()'", async () => {
    it("Executes as expected and emits the correct events", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      await proveTx(liquidityPool.grantRole(ADMIN_ROLE, admin.address));
      let repaymentCounter: bigint = await market.repaymentCounter();

      const tx = connect(liquidityPool, admin).autoRepay(AUTO_REPAY_LOAN_IDS, AUTO_REPAY_AMOUNTS);
      await expect(tx)
        .to.emit(liquidityPool, EVENT_NAME_AUTO_REPAYMENT)
        .withArgs(AUTO_REPAY_LOAN_IDS.length);

      for (let i = 0; i < AUTO_REPAY_LOAN_IDS.length; i++) {
        ++repaymentCounter;
        await expect(tx)
          .to.emit(market, EVENT_NAME_REPAY_LOAN_CALLED)
          .withArgs(AUTO_REPAY_LOAN_IDS[i], AUTO_REPAY_AMOUNTS[i], repaymentCounter);
      }
    });

    it("Is reverted if the contract is paused", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      await proveTx(liquidityPool.pause());

      await expect(connect(liquidityPool, admin).autoRepay(AUTO_REPAY_LOAN_IDS, AUTO_REPAY_AMOUNTS))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the caller is not an admin", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      // Even the lender cannot execute the auto repayments
      await expect(connect(liquidityPool, lender).autoRepay(AUTO_REPAY_LOAN_IDS, AUTO_REPAY_AMOUNTS))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED)
        .withArgs(lender.address, ADMIN_ROLE);
    });

    it("Is reverted if the provided arrays do not match in length", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      await proveTx(liquidityPool.grantRole(ADMIN_ROLE, admin.address));

      const wrongAutoRepayLoanIds: bigint[] = [...AUTO_REPAY_LOAN_IDS, AUTO_REPAY_LOAN_IDS[0]];

      await expect(connect(liquidityPool, admin).autoRepay(wrongAutoRepayLoanIds, AUTO_REPAY_AMOUNTS))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ARRAY_LENGTH_MISMATCH);
    });
  });

  describe("Function 'onBeforeLoanTaken()'", async () => {
    async function executeAndCheck(liquidityPool: Contract, addonTreasuryAddress: string) {
      if (addonTreasuryAddress !== ZERO_ADDRESS) {
        await proveTx(liquidityPool.setAddonTreasury(addonTreasuryAddress));
      }
      await prepareLoan({ loanId: LOAN_ID, borrowAmount: BORROW_AMOUNT, addonAmount: ADDON_AMOUNT });
      await proveTx(liquidityPool.deposit(DEPOSIT_AMOUNT));

      const tx = market.callOnBeforeLoanTakenLiquidityPool(getAddress(liquidityPool), LOAN_ID);

      await expect(tx)
        .to.emit(market, EVENT_NAME_HOOK_CALL_RESULT)
        .withArgs(true);

      const actualBalances = await liquidityPool.getBalances();

      expect(actualBalances[0]).to.eq(DEPOSIT_AMOUNT - BORROW_AMOUNT - ADDON_AMOUNT);
      if (addonTreasuryAddress === ZERO_ADDRESS) {
        expect(actualBalances[1]).to.eq(ADDON_AMOUNT);
        await expect(tx).to.changeTokenBalances(
          token,
          [liquidityPool, addonTreasury],
          [0, 0]
        );
      } else {
        expect(actualBalances[1]).to.eq(0);
        await expect(tx).to.changeTokenBalances(
          token,
          [liquidityPool, addonTreasury],
          [-ADDON_AMOUNT, ADDON_AMOUNT]
        );
      }
    }

    it("Executes as expected if the addon treasury address is zero", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const addonTreasuryAddress = (ZERO_ADDRESS);
      await executeAndCheck(liquidityPool, addonTreasuryAddress);
    });

    it("Executes as expected if the addon treasury address is non-zero", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const addonTreasuryAddress = (addonTreasury.address);
      await executeAndCheck(liquidityPool, addonTreasuryAddress);
    });

    it("Is reverted if the contract is paused", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      await proveTx(liquidityPool.pause());

      await expect(market.callOnBeforeLoanTakenLiquidityPool(getAddress(liquidityPool), LOAN_ID))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the caller is not the market", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await expect(liquidityPool.onBeforeLoanTaken(LOAN_ID))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_UNAUTHORIZED);
    });

    it("Is reverted if there is not enough borrowable balance", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      await prepareLoan({ loanId: LOAN_ID, borrowAmount: DEPOSIT_AMOUNT + 1n, addonAmount: 0n });
      await proveTx(liquidityPool.deposit(DEPOSIT_AMOUNT));

      await expect(market.callOnBeforeLoanTakenLiquidityPool(getAddress(liquidityPool), LOAN_ID))
        .to.be.revertedWithPanic(0x11);
    });
  });

  describe("Function 'onAfterLoanPayment()'", async () => {
    it("Executes as expected", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      await proveTx(liquidityPool.deposit(DEPOSIT_AMOUNT));

      await expect(market.callOnAfterLoanPaymentLiquidityPool(
        getAddress(liquidityPool),
        LOAN_ID,
        REPAY_AMOUNT
      )).to.emit(
        market,
        EVENT_NAME_HOOK_CALL_RESULT
      ).withArgs(true);

      const actualBalances = await liquidityPool.getBalances();

      expect(actualBalances[0]).to.eq(DEPOSIT_AMOUNT + REPAY_AMOUNT);
      expect(actualBalances[1]).to.eq(0n);
    });

    it("Is reverted if the contract is paused", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      await proveTx(liquidityPool.pause());

      await expect(
        market.callOnAfterLoanPaymentLiquidityPool(getAddress(liquidityPool), LOAN_ID, REPAY_AMOUNT)
      ).to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the caller is not the market", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await expect(liquidityPool.onAfterLoanPayment(LOAN_ID, REPAY_AMOUNT))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_UNAUTHORIZED);
    });

    it("Is reverted if there is an overflow in the borrowable balance", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const depositAmount = maxUintForBits(64);
      const repaymentAmount = 1n;
      await proveTx(token.mint(lender.address, depositAmount));
      await proveTx(liquidityPool.deposit(depositAmount));

      await expect(market.callOnAfterLoanPaymentLiquidityPool(
        getAddress(liquidityPool),
        LOAN_ID,
        repaymentAmount
      )).to.revertedWithPanic(0x11);
    });
  });

  describe("Function 'onAfterLoanRevocation()'", async () => {
    async function executeAndCheck(liquidityPool: Contract, props: {
      repaidAmount: bigint;
      addonTreasuryAddress: string;
    }) {
      const { repaidAmount, addonTreasuryAddress } = props;
      const poolAddress = getAddress(liquidityPool);
      await proveTx(liquidityPool.deposit(DEPOSIT_AMOUNT));
      await prepareLoan({ loanId: LOAN_ID, borrowAmount: BORROW_AMOUNT, addonAmount: ADDON_AMOUNT, repaidAmount });
      await proveTx(market.callOnBeforeLoanTakenLiquidityPool(poolAddress, LOAN_ID));
      await proveTx(market.callOnAfterLoanPaymentLiquidityPool(poolAddress, LOAN_ID, repaidAmount));

      if (addonTreasuryAddress !== ZERO_ADDRESS) {
        await proveTx(liquidityPool.setAddonTreasury(addonTreasuryAddress));
      }

      const actualBalancesBefore: bigint[] = await liquidityPool.getBalances();
      expect(actualBalancesBefore[0]).to.eq(DEPOSIT_AMOUNT - BORROW_AMOUNT - ADDON_AMOUNT + repaidAmount);
      expect(actualBalancesBefore[1]).to.eq(ADDON_AMOUNT);

      const tx = market.callOnAfterLoanRevocationLiquidityPool(poolAddress, LOAN_ID);

      await expect(tx)
        .to.emit(market, EVENT_NAME_HOOK_CALL_RESULT)
        .withArgs(true);

      const actualBalancesAfter: bigint[] = await liquidityPool.getBalances();

      if (addonTreasuryAddress === ZERO_ADDRESS) {
        await expect(tx).to.changeTokenBalances(
          token,
          [liquidityPool, addonTreasury],
          [0, 0]
        );
        expect(actualBalancesAfter[0]).to.eq(DEPOSIT_AMOUNT);
        expect(actualBalancesAfter[1]).to.eq(0n);
      } else {
        await expect(tx).to.changeTokenBalances(
          token,
          [liquidityPool, addonTreasury],
          [ADDON_AMOUNT, -ADDON_AMOUNT]
        );
        expect(actualBalancesAfter[0]).to.eq(DEPOSIT_AMOUNT);
        expect(actualBalancesAfter[1]).to.eq(actualBalancesBefore[1]);
      }
    }

    describe("Executes as expected if the addon treasure address is zero and", async () => {
      it("The addon treasure address is zero and the repaid amount is less than the borrow amount", async () => {
        const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
        await executeAndCheck(liquidityPool, { repaidAmount: BORROW_AMOUNT / 3n, addonTreasuryAddress: ZERO_ADDRESS });
      });

      it("The repaid amount is greater than the borrow amount", async () => {
        const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
        await executeAndCheck(liquidityPool, { repaidAmount: BORROW_AMOUNT * 3n, addonTreasuryAddress: ZERO_ADDRESS });
      });

      it("The repaid amount equals the borrow amount", async () => {
        const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
        await executeAndCheck(liquidityPool, { repaidAmount: BORROW_AMOUNT, addonTreasuryAddress: ZERO_ADDRESS });
      });
    });

    describe("Executes as expected if the addon treasure address is non-zero and", async () => {
      it("The addon treasure address is zero and the repaid amount is less than the borrow amount", async () => {
        const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
        const addonTreasuryAddress = addonTreasury.address;
        await executeAndCheck(liquidityPool, { repaidAmount: BORROW_AMOUNT / 3n, addonTreasuryAddress });
      });

      it("The repaid amount is greater than the borrow amount", async () => {
        const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
        const addonTreasuryAddress = addonTreasury.address;
        await executeAndCheck(liquidityPool, { repaidAmount: BORROW_AMOUNT * 3n, addonTreasuryAddress });
      });

      it("The repaid amount equals the borrow amount", async () => {
        const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
        const addonTreasuryAddress = addonTreasury.address;
        await executeAndCheck(liquidityPool, { repaidAmount: BORROW_AMOUNT, addonTreasuryAddress });
      });
    });

    describe("Is reverted if", async () => {
      it("The contract is paused", async () => {
        const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
        await proveTx(liquidityPool.pause());

        await expect(
          market.callOnAfterLoanRevocationLiquidityPool(getAddress(liquidityPool), LOAN_ID)
        ).to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ENFORCED_PAUSED);
      });

      it("The caller is not the market", async () => {
        const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

        await expect(liquidityPool.onAfterLoanRevocation(LOAN_ID))
          .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_UNAUTHORIZED);
      });
    });
  });
});
