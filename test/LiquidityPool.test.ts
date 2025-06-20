import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory, TransactionResponse } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  checkContractUupsUpgrading,
  connect,
  deployAndConnectContract,
  getAddress,
  getNumberOfEvents,
  proveTx
} from "../test-utils/eth";
import { checkEquality, maxUintForBits, setUpFixture } from "../test-utils/common";
import { EXPECTED_VERSION } from "../test-utils/specific";

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

// Events of the library contracts
const EVENT_NAME_APPROVAL = "Approval";
const EVENT_NAME_TRANSFER = "Transfer";

// Events of the contracts under test
const EVENT_NAME_ADDON_TREASURY_CHANGED = "AddonTreasuryChanged";
const EVENT_NAME_DEPOSIT = "Deposit";
const EVENT_NAME_MOCK_BURNING_TO_RESERVE = "MockBurningToReserve";
const EVENT_NAME_MOCK_MINTING_FROM_RESERVE = "MockMintingFromReserve";
const EVENT_NAME_OPERATIONAL_TREASURY_CHANGED = "OperationalTreasuryChanged";
const EVENT_NAME_RESCUE = "Rescue";
const EVENT_NAME_WITHDRAWAL = "Withdrawal";

// Errors of the library contracts
const ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT = "AccessControlUnauthorizedAccount";
const ERROR_NAME_ENFORCED_PAUSED = "EnforcedPause";
const ERROR_NAME_INVALID_INITIALIZATION = "InvalidInitialization";

// Errors of the contracts under test
const ERROR_NAME_ADDON_TREASURY_ADDRESS_ZEROING_PROHIBITED = "AddonTreasuryAddressZeroingProhibited";
const ERROR_NAME_ADDON_TREASURY_ZERO_ALLOWANCE_FOR_MARKET = "AddonTreasuryZeroAllowanceForMarket";
const ERROR_NAME_ALREADY_CONFIGURED = "AlreadyConfigured";
const ERROR_NAME_CONTRACT_ADDRESS_INVALID = "ContractAddressInvalid";
const ERROR_NAME_INSUFFICIENT_BALANCE = "InsufficientBalance";
const ERROR_NAME_INVALID_AMOUNT = "InvalidAmount";
const ERROR_NAME_IMPLEMENTATION_ADDRESS_INVALID = "ImplementationAddressInvalid";
const ERROR_NAME_OPERATIONAL_TREASURY_ADDRESS_ZERO = "OperationalTreasuryAddressZero";
const ERROR_NAME_OPERATIONAL_TREASURY_ZERO_ALLOWANCE_FOR_POOL = "OperationalTreasuryZeroAllowanceForPool";
const ERROR_NAME_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST = "SafeCastOverflowedUintDowncast";
const ERROR_NAME_UNAUTHORIZED = "Unauthorized";
const ERROR_NAME_ZERO_ADDRESS = "ZeroAddress";

const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
const GRANTOR_ROLE = ethers.id("GRANTOR_ROLE");
const OWNER_ROLE = ethers.id("OWNER_ROLE");
const PAUSER_ROLE = ethers.id("PAUSER_ROLE");
const ADMIN_ROLE = ethers.id("ADMIN_ROLE");

const FUNC_SIGNATURE_DEPOSIT = "deposit(uint256)";
const FUNC_SIGNATURE_DEPOSIT_FROM_OPERATIONAL_TREASURY = "depositFromOperationalTreasury(uint256)";
const FUNC_SIGNATURE_DEPOSIT_FROM_RESERVE = "depositFromReserve(uint256)";
const FUNC_SIGNATURE_WITHDRAW = "withdraw(uint256,uint256)";
const FUNC_SIGNATURE_WITHDRAW_TO_OPERATIONAL_TREASURY = "withdrawToOperationalTreasury(uint256)";
const FUNC_SIGNATURE_WITHDRAW_TO_RESERVE = "withdrawToReserve(uint256)";

const ZERO_ADDRESS = ethers.ZeroAddress;
const MAX_ALLOWANCE = ethers.MaxUint256;
const ZERO_ALLOWANCE = 0;
const MINT_AMOUNT = 1000_000_000_000n;
const DEPOSIT_AMOUNT = MINT_AMOUNT / 10n;
const WITHDRAWAL_AMOUNT = MINT_AMOUNT / 20n;
const BORROWED_AMOUNT = DEPOSIT_AMOUNT / 10n;
const ADDON_AMOUNT = BORROWED_AMOUNT / 10n;
const REPAYMENT_AMOUNT = BORROWED_AMOUNT / 5n;
const LOAN_ID = 123n;

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

describe("Contract 'LiquidityPool'", async () => {
  let liquidityPoolFactory: ContractFactory;
  let tokenFactory: ContractFactory;
  let marketFactory: ContractFactory;

  let market: Contract;
  let token: Contract;

  let deployer: HardhatEthersSigner;
  let owner: HardhatEthersSigner;
  let admin: HardhatEthersSigner;
  let attacker: HardhatEthersSigner;
  let addonTreasury: HardhatEthersSigner;
  let operationalTreasury: HardhatEthersSigner;

  let tokenAddress: string;
  let marketAddress: string;

  before(async () => {
    [deployer, owner, admin, attacker, addonTreasury, operationalTreasury] = await ethers.getSigners();

    // Factories with an explicitly specified deployer account
    liquidityPoolFactory = await ethers.getContractFactory("LiquidityPool");
    liquidityPoolFactory = liquidityPoolFactory.connect(deployer);
    tokenFactory = await ethers.getContractFactory("ERC20Mock");
    tokenFactory = tokenFactory.connect(deployer);
    marketFactory = await ethers.getContractFactory("LendingMarketMock");
    marketFactory = marketFactory.connect(deployer);

    market = await deployAndConnectContract(marketFactory, deployer);
    marketAddress = getAddress(market);

    token = await deployAndConnectContract(tokenFactory, deployer);
    tokenAddress = getAddress(token);

    await token.mint(owner.address, MINT_AMOUNT);
    await token.mint(addonTreasury.address, MINT_AMOUNT);
    await token.mint(operationalTreasury.address, MINT_AMOUNT);
  });

  async function deployLiquidityPool(): Promise<{ liquidityPool: Contract }> {
    let liquidityPool = await upgrades.deployProxy(
      liquidityPoolFactory,
      [
        owner.address,
        marketAddress,
        tokenAddress
      ],
      { kind: "uups" }
    ) as Contract;

    await liquidityPool.waitForDeployment();
    liquidityPool = connect(liquidityPool, owner); // Explicitly specifying the initial account

    await proveTx(connect(token, owner).approve(getAddress(liquidityPool), MAX_ALLOWANCE));
    return { liquidityPool };
  }

  async function deployAndConfigureLiquidityPool(): Promise<{ liquidityPool: Contract }> {
    const { liquidityPool } = await deployLiquidityPool();
    await proveTx(liquidityPool.grantRole(GRANTOR_ROLE, owner.address));
    await proveTx(liquidityPool.grantRole(PAUSER_ROLE, owner.address));
    await proveTx(liquidityPool.grantRole(ADMIN_ROLE, admin.address));
    await proveTx(connect(token, addonTreasury).approve(getAddress(market), MAX_ALLOWANCE));
    await proveTx(connect(token, operationalTreasury).approve(getAddress(liquidityPool), MAX_ALLOWANCE));
    await proveTx(liquidityPool.setOperationalTreasury(operationalTreasury.address));
    return { liquidityPool };
  }

  async function prepareLoan(
    loanProps: {
      loanId: bigint;
      borrowedAmount: bigint;
      addonAmount: bigint;
      repaidAmount?: bigint;
    }
  ) {
    const loanState: LoanState = {
      ...defaultLoanState,
      borrowedAmount: loanProps.borrowedAmount,
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
    const depositAmount = props.borrowableBalance + BORROWED_AMOUNT + props.addonBalance;
    await proveTx(liquidityPool.deposit(depositAmount));
    await prepareLoan({ borrowedAmount: BORROWED_AMOUNT, loanId: LOAN_ID, addonAmount });
    await proveTx(market.callOnBeforeLoanTakenLiquidityPool(getAddress(liquidityPool), LOAN_ID));
  }

  async function depositAndCheck(
    liquidityPool: Contract,
    depositAmount: bigint,
    functionSignature: string = FUNC_SIGNATURE_DEPOSIT
  ): Promise<TransactionResponse> {
    const balancesBefore = await liquidityPool.getBalances();

    let tx: Promise<TransactionResponse>;

    switch (functionSignature) {
      case FUNC_SIGNATURE_DEPOSIT: {
        tx = liquidityPool[functionSignature](depositAmount);
        await expect(tx).to.changeTokenBalances(
          token,
          [liquidityPool, owner, admin, operationalTreasury],
          [depositAmount, -depositAmount, 0, 0]
        );
        break;
      }
      case FUNC_SIGNATURE_DEPOSIT_FROM_OPERATIONAL_TREASURY: {
        tx = connect(liquidityPool, admin)[functionSignature](depositAmount);
        await expect(tx).to.changeTokenBalances(
          token,
          [liquidityPool, owner, admin, operationalTreasury],
          [depositAmount, 0, 0, -depositAmount]
        );
        break;
      }
      case FUNC_SIGNATURE_DEPOSIT_FROM_RESERVE: {
        tx = connect(liquidityPool, admin)[functionSignature](depositAmount);
        await expect(tx).to.changeTokenBalances(
          token,
          [liquidityPool, owner, admin, operationalTreasury],
          [depositAmount, 0, 0, 0]
        );
        break;
      }
      default: {
        throw new Error(`Unknown function signature: '${functionSignature}'`);
      }
    }

    await expect(tx)
      .to.emit(liquidityPool, EVENT_NAME_DEPOSIT)
      .withArgs(depositAmount);

    const balancesAfter = await liquidityPool.getBalances();

    expect(balancesAfter[0]).to.eq(balancesBefore[0] + depositAmount);
    expect(balancesAfter[1]).to.eq(0n);

    return tx;
  }

  async function withdrawAndCheck(
    liquidityPool: Contract,
    withdrawalAmount: bigint,
    functionSignature: string = FUNC_SIGNATURE_WITHDRAW
  ): Promise<TransactionResponse> {
    const borrowableBalance = withdrawalAmount * 2n;
    const addonBalance = ADDON_AMOUNT * 2n;
    const borrowableAmount = (withdrawalAmount);
    const addonAmount = 0n;
    await prepareCertainBalances(liquidityPool, { borrowableBalance, addonBalance });

    let tx: Promise<TransactionResponse>;

    switch (functionSignature) {
      case FUNC_SIGNATURE_WITHDRAW: {
        tx = liquidityPool[functionSignature](borrowableAmount, addonAmount);
        await expect(tx).to.changeTokenBalances(
          token,
          [liquidityPool, owner, admin, operationalTreasury],
          [-borrowableAmount, borrowableAmount, 0, 0]
        );
        break;
      }
      case FUNC_SIGNATURE_WITHDRAW_TO_OPERATIONAL_TREASURY: {
        tx = connect(liquidityPool, admin)[functionSignature](borrowableAmount);
        await expect(tx).to.changeTokenBalances(
          token,
          [liquidityPool, owner, admin, operationalTreasury],
          [-borrowableAmount, 0, 0, borrowableAmount]
        );
        break;
      }
      case FUNC_SIGNATURE_WITHDRAW_TO_RESERVE: {
        tx = connect(liquidityPool, admin)[functionSignature](borrowableAmount);
        await expect(tx).to.changeTokenBalances(
          token,
          [liquidityPool, owner, admin, operationalTreasury],
          [-borrowableAmount, 0, 0, 0]
        );
        break;
      }
      default: {
        throw new Error(`Unknown function signature: '${functionSignature}'`);
      }
    }

    await expect(tx)
      .to.emit(liquidityPool, EVENT_NAME_WITHDRAWAL)
      .withArgs(borrowableAmount, addonAmount);

    const actualBalancesAfter = await liquidityPool.getBalances();

    expect(actualBalancesAfter[0]).to.eq(borrowableBalance - borrowableAmount);
    expect(actualBalancesAfter[1]).to.eq(0n);

    return tx;
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);
      // Role hashes
      expect(await liquidityPool.OWNER_ROLE()).to.equal(OWNER_ROLE);
      expect(await liquidityPool.GRANTOR_ROLE()).to.equal(GRANTOR_ROLE);
      expect(await liquidityPool.ADMIN_ROLE()).to.equal(ADMIN_ROLE);
      expect(await liquidityPool.PAUSER_ROLE()).to.equal(PAUSER_ROLE);

      // The role admins
      expect(await liquidityPool.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE);
      expect(await liquidityPool.getRoleAdmin(GRANTOR_ROLE)).to.equal(OWNER_ROLE);
      expect(await liquidityPool.getRoleAdmin(ADMIN_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await liquidityPool.getRoleAdmin(PAUSER_ROLE)).to.equal(GRANTOR_ROLE);

      // Roles
      expect(await liquidityPool.hasRole(OWNER_ROLE, deployer.address)).to.equal(false);
      expect(await liquidityPool.hasRole(GRANTOR_ROLE, deployer.address)).to.equal(false);
      expect(await liquidityPool.hasRole(ADMIN_ROLE, deployer.address)).to.equal(false);
      expect(await liquidityPool.hasRole(PAUSER_ROLE, deployer.address)).to.equal(false);
      expect(await liquidityPool.hasRole(OWNER_ROLE, owner.address)).to.equal(true); // !!!
      expect(await liquidityPool.hasRole(GRANTOR_ROLE, owner.address)).to.equal(false);
      expect(await liquidityPool.hasRole(ADMIN_ROLE, owner.address)).to.equal(false);
      expect(await liquidityPool.hasRole(PAUSER_ROLE, owner.address)).to.equal(false);

      // The initial contract state is unpaused
      expect(await liquidityPool.paused()).to.equal(false);

      // Other important parameters and storage variables
      expect(await liquidityPool.getBalances()).to.deep.eq([0n, 0n]);
      expect(await liquidityPool.market()).to.eq(marketAddress);
      expect(await liquidityPool.token()).to.eq(tokenAddress);
      expect(await liquidityPool.addonTreasury()).to.eq(ZERO_ADDRESS);
    });

    it("Is reverted if the owner address is zero", async () => {
      const wrongOwnerAddress = (ZERO_ADDRESS);
      await expect(upgrades.deployProxy(liquidityPoolFactory, [
        wrongOwnerAddress,
        marketAddress,
        tokenAddress
      ])).to.be.revertedWithCustomError(liquidityPoolFactory, ERROR_NAME_ZERO_ADDRESS);
    });

    it("Is reverted if the market address is zero", async () => {
      const wrongMarketAddress = (ZERO_ADDRESS);
      await expect(upgrades.deployProxy(liquidityPoolFactory, [
        owner.address,
        wrongMarketAddress,
        tokenAddress
      ])).to.be.revertedWithCustomError(liquidityPoolFactory, ERROR_NAME_ZERO_ADDRESS);
    });

    it("Is reverted if the market address is not a contract address", async () => {
      const wrongMarketAddress = deployer.address;
      await expect(upgrades.deployProxy(liquidityPoolFactory, [
        owner.address,
        wrongMarketAddress,
        tokenAddress
      ])).to.be.revertedWithCustomError(liquidityPoolFactory, ERROR_NAME_CONTRACT_ADDRESS_INVALID);
    });

    it("Is reverted if the market address does not belong to a lending market contract", async () => {
      const wrongMarketAddress = (tokenAddress);
      await expect(upgrades.deployProxy(liquidityPoolFactory, [
        owner.address,
        wrongMarketAddress,
        tokenAddress
      ])).to.be.revertedWithCustomError(liquidityPoolFactory, ERROR_NAME_CONTRACT_ADDRESS_INVALID);
    });

    it("Is reverted if the token address is zero", async () => {
      const wrongTokenAddress = (ZERO_ADDRESS);
      await expect(upgrades.deployProxy(liquidityPoolFactory, [
        owner.address,
        marketAddress,
        wrongTokenAddress
      ])).to.be.revertedWithCustomError(liquidityPoolFactory, ERROR_NAME_ZERO_ADDRESS);
    });

    it("Is reverted if the token address is not a contract address", async () => {
      const wrongTokenAddress = deployer.address;
      await expect(upgrades.deployProxy(liquidityPoolFactory, [
        owner.address,
        marketAddress,
        wrongTokenAddress
      ])).to.be.revertedWithCustomError(liquidityPoolFactory, ERROR_NAME_CONTRACT_ADDRESS_INVALID);
    });

    it("Is reverted if the token address does not belong to a token contract", async () => {
      const wrongTokenAddress = (marketAddress);
      await expect(upgrades.deployProxy(liquidityPoolFactory, [
        owner.address,
        marketAddress,
        wrongTokenAddress
      ])).to.be.revertedWithCustomError(liquidityPoolFactory, ERROR_NAME_CONTRACT_ADDRESS_INVALID);
    });

    it("Is reverted if called a second time", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await expect(liquidityPool.initialize(marketAddress, owner.address, tokenAddress))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_INVALID_INITIALIZATION);
    });

    it("Is reverted for the contract implementation if it is called even for the first time", async () => {
      const liquidityPoolImplementation = await liquidityPoolFactory.deploy() as Contract;
      await liquidityPoolImplementation.waitForDeployment();

      await expect(liquidityPoolImplementation.initialize(marketAddress, owner.address, tokenAddress))
        .to.be.revertedWithCustomError(liquidityPoolImplementation, ERROR_NAME_INVALID_INITIALIZATION);
    });
  });

  describe("Function '$__VERSION()'", async () => {
    it("Returns expected values", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);
      const liquidityPoolVersion = await liquidityPool.$__VERSION();
      checkEquality(liquidityPoolVersion, EXPECTED_VERSION);
    });
  });

  describe("Function 'upgradeToAndCall()'", async () => {
    it("Executes as expected", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);
      await checkContractUupsUpgrading(liquidityPool, liquidityPoolFactory);
    });

    it("Is reverted if the caller does not have the owner role", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await expect(connect(liquidityPool, attacker).upgradeToAndCall(liquidityPool, "0x"))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(attacker.address, OWNER_ROLE);
    });

    it("Is reverted if the provided implementation address is not a liquidity pool contract", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);
      const mockContractFactory = await ethers.getContractFactory("UUPSExtUpgradeableMock");
      const mockContract = await mockContractFactory.deploy() as Contract;
      await mockContract.waitForDeployment();

      await expect(liquidityPool.upgradeToAndCall(mockContract, "0x"))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_IMPLEMENTATION_ADDRESS_INVALID);
    });
  });

  describe("Function 'setAddonTreasury()", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);
      const allowance = 1; // This allowance should be enough
      await proveTx(connect(token, addonTreasury).approve(getAddress(market), allowance));

      await expect(liquidityPool.setAddonTreasury(addonTreasury.address))
        .to.emit(liquidityPool, EVENT_NAME_ADDON_TREASURY_CHANGED)
        .withArgs(addonTreasury.address, ZERO_ADDRESS);

      expect(await liquidityPool.addonTreasury()).to.eq(addonTreasury.address);
    });

    it("Is reverted if caller does not have the owner role", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await expect(connect(liquidityPool, attacker).setAddonTreasury(addonTreasury.address))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(attacker.address, OWNER_ROLE);
    });

    it("Is reverted if the new addon treasury address is the same as the previous one", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await expect(liquidityPool.setAddonTreasury(ZERO_ADDRESS))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ALREADY_CONFIGURED);

      await proveTx(connect(token, addonTreasury).approve(getAddress(market), MAX_ALLOWANCE));
      await proveTx(liquidityPool.setAddonTreasury(addonTreasury.address));

      await expect(liquidityPool.setAddonTreasury(addonTreasury.address))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ALREADY_CONFIGURED);
    });

    it("Is reverted if the addon treasury address is zeroed", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);
      await proveTx(connect(token, addonTreasury).approve(getAddress(market), MAX_ALLOWANCE));
      await proveTx(liquidityPool.setAddonTreasury(addonTreasury.address));

      await expect(liquidityPool.setAddonTreasury(ZERO_ADDRESS))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ADDON_TREASURY_ADDRESS_ZEROING_PROHIBITED);
    });

    it("Is reverted if the addon treasury has not provided an allowance for the pool", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);
      await proveTx(connect(token, addonTreasury).approve(getAddress(market), ZERO_ALLOWANCE));

      await expect(liquidityPool.setAddonTreasury(addonTreasury.address))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ADDON_TREASURY_ZERO_ALLOWANCE_FOR_MARKET);
    });
  });

  describe("Function 'setOperationalTreasury()", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);
      const allowance = 1; // This allowance should be enough
      await proveTx(connect(token, operationalTreasury).approve(getAddress(liquidityPool), allowance));

      await expect(liquidityPool.setOperationalTreasury(operationalTreasury.address))
        .to.emit(liquidityPool, EVENT_NAME_OPERATIONAL_TREASURY_CHANGED)
        .withArgs(operationalTreasury.address, ZERO_ADDRESS);

      expect(await liquidityPool.operationalTreasury()).to.eq(operationalTreasury.address);

      // Zeroing the operational treasury address is allowed
      await expect(liquidityPool.setOperationalTreasury(ZERO_ADDRESS))
        .to.emit(liquidityPool, EVENT_NAME_OPERATIONAL_TREASURY_CHANGED)
        .withArgs(ZERO_ADDRESS, operationalTreasury.address);

      expect(await liquidityPool.operationalTreasury()).to.eq(ZERO_ADDRESS);
    });

    it("Is reverted if caller does not have the owner role", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await expect(connect(liquidityPool, attacker).setOperationalTreasury(operationalTreasury.address))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(attacker.address, OWNER_ROLE);
    });

    it("Is reverted if the new operational treasury address is the same as the previous one", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await expect(liquidityPool.setOperationalTreasury(ZERO_ADDRESS))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ALREADY_CONFIGURED);

      await proveTx(connect(token, operationalTreasury).approve(getAddress(liquidityPool), MAX_ALLOWANCE));
      await proveTx(liquidityPool.setOperationalTreasury(operationalTreasury.address));

      await expect(liquidityPool.setOperationalTreasury(operationalTreasury.address))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ALREADY_CONFIGURED);
    });

    it("Is reverted if the operational treasury has not provided an allowance for the pool", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await expect(liquidityPool.setOperationalTreasury(operationalTreasury.address))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_OPERATIONAL_TREASURY_ZERO_ALLOWANCE_FOR_POOL);
    });
  });

  describe("Function 'initAdminRole()", async () => {
    it("Executes as expected", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);
      await proveTx(liquidityPool.setRoleAdmin(ADMIN_ROLE, DEFAULT_ADMIN_ROLE));
      expect(await liquidityPool.getRoleAdmin(ADMIN_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);

      await proveTx(liquidityPool.initAdminRole());

      expect(await liquidityPool.getRoleAdmin(ADMIN_ROLE)).to.equal(OWNER_ROLE);
      expect(await liquidityPool.hasRole(ADMIN_ROLE, owner.address)).to.equal(true);
    });

    it("Is reverted if caller does not have the owner role", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await expect(connect(liquidityPool, attacker).initAdminRole())
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(attacker.address, OWNER_ROLE);
    });
  });

  describe("Function 'deposit()'", async () => {
    it("Executes as expected", async () => {
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
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
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

  describe("Function 'depositFromExternalTreasury()'", async () => {
    it("Executes as expected", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      // First deposit must change the allowance from the liquidity pool to the market

      const allowanceBefore = await token.allowance(getAddress(liquidityPool), getAddress(market));
      expect(allowanceBefore).to.eq(0);

      const tx1: Promise<TransactionResponse> =
        depositAndCheck(liquidityPool, DEPOSIT_AMOUNT, FUNC_SIGNATURE_DEPOSIT_FROM_OPERATIONAL_TREASURY);
      await expect(tx1).to.emit(token, EVENT_NAME_APPROVAL);

      const allowanceAfter = await token.allowance(getAddress(liquidityPool), getAddress(market));
      expect(allowanceAfter).to.eq(MAX_ALLOWANCE);

      // Second deposit must not change the allowance from the liquidity pool to the market
      const tx2: Promise<TransactionResponse> =
        depositAndCheck(liquidityPool, DEPOSIT_AMOUNT, FUNC_SIGNATURE_DEPOSIT_FROM_OPERATIONAL_TREASURY);
      await expect(tx2).not.to.emit(token, EVENT_NAME_APPROVAL);
    });

    it("Is reverted if the caller does not have the admin role", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await expect(connect(liquidityPool, owner).depositFromOperationalTreasury(DEPOSIT_AMOUNT))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(owner.address, ADMIN_ROLE);
      await expect(connect(liquidityPool, attacker).depositFromOperationalTreasury(DEPOSIT_AMOUNT))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(attacker.address, ADMIN_ROLE);
    });

    it("Is reverted if the operational treasury is not set", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      await proveTx(liquidityPool.setOperationalTreasury(ZERO_ADDRESS));

      await expect(connect(liquidityPool, admin).depositFromOperationalTreasury(0))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_OPERATIONAL_TREASURY_ADDRESS_ZERO);
    });

    it("Is reverted if the deposit amount is zero", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await expect(connect(liquidityPool, admin).depositFromOperationalTreasury(0))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_INVALID_AMOUNT);
    });

    it("Is reverted if the deposit amount is greater than 64-bit unsigned integer", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const amount = maxUintForBits(64) + 1n;

      await expect(connect(liquidityPool, admin).depositFromOperationalTreasury(amount))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST)
        .withArgs(64, amount);
    });
  });

  describe("Function 'depositFromReserve()'", async () => {
    it("Executes as expected", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const liquidityPoolAddress = getAddress(liquidityPool);

      // First deposit must change the allowance from the liquidity pool to the market

      const allowanceBefore = await token.allowance(getAddress(liquidityPool), getAddress(market));
      expect(allowanceBefore).to.eq(0);

      const tx1: Promise<TransactionResponse> =
        depositAndCheck(liquidityPool, DEPOSIT_AMOUNT, FUNC_SIGNATURE_DEPOSIT_FROM_RESERVE);
      await expect(tx1).to.emit(token, EVENT_NAME_APPROVAL);
      await expect(tx1).to.emit(token, EVENT_NAME_MOCK_MINTING_FROM_RESERVE).withArgs(
        liquidityPoolAddress,
        liquidityPoolAddress,
        DEPOSIT_AMOUNT
      );
      expect(await getNumberOfEvents(tx1, token, EVENT_NAME_TRANSFER)).to.eq(1);

      const allowanceAfter = await token.allowance(getAddress(liquidityPool), getAddress(market));
      expect(allowanceAfter).to.eq(MAX_ALLOWANCE);

      // Second deposit must not change the allowance from the liquidity pool to the market
      const tx2: Promise<TransactionResponse> =
        depositAndCheck(liquidityPool, DEPOSIT_AMOUNT, FUNC_SIGNATURE_DEPOSIT_FROM_RESERVE);
      await expect(tx2).not.to.emit(token, EVENT_NAME_APPROVAL);
      await expect(tx2).to.emit(token, EVENT_NAME_MOCK_MINTING_FROM_RESERVE).withArgs(
        liquidityPoolAddress,
        liquidityPoolAddress,
        DEPOSIT_AMOUNT
      );
      expect(await getNumberOfEvents(tx2, token, EVENT_NAME_TRANSFER)).to.eq(1);
    });

    it("Is reverted if the caller does not have the admin role", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await expect(connect(liquidityPool, owner).depositFromReserve(DEPOSIT_AMOUNT))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(owner.address, ADMIN_ROLE);
      await expect(connect(liquidityPool, attacker).depositFromReserve(DEPOSIT_AMOUNT))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(attacker.address, ADMIN_ROLE);
    });

    it("Is reverted if the deposit amount is zero", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await expect(connect(liquidityPool, admin).depositFromReserve(0))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_INVALID_AMOUNT);
    });

    it("Is reverted if the deposit amount is greater than 64-bit unsigned integer", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const amount = maxUintForBits(64) + 1n;

      await expect(connect(liquidityPool, admin).depositFromReserve(amount))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST)
        .withArgs(64, amount);
    });
  });

  describe("Function 'withdraw()'", async () => {
    it("Executes as expected if only the borrowable balance is withdrawn", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      await withdrawAndCheck(liquidityPool, WITHDRAWAL_AMOUNT);
    });

    it("Is reverted if the caller does not have the owner role", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await expect(connect(liquidityPool, attacker).withdraw(WITHDRAWAL_AMOUNT, 0))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(attacker.address, OWNER_ROLE);
    });

    it("Is reverted if the both amounts are zero", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await expect(liquidityPool.withdraw(0, 0))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_INVALID_AMOUNT);
    });

    it("Is reverted if the addon balance is withdrawn with a non-zero amount", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      await prepareCertainBalances(liquidityPool, { borrowableBalance: DEPOSIT_AMOUNT, addonBalance: ADDON_AMOUNT });
      let borrowableAmount = 1n;

      await expect(liquidityPool.withdraw(borrowableAmount, 1n))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_INVALID_AMOUNT);

      borrowableAmount = 0n;
      await expect(liquidityPool.withdraw(borrowableAmount, 1n))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_INVALID_AMOUNT);
    });

    it("Is reverted if the liquidity pool balance is enough but borrowable balance is not", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      // Make the pool token balance enough for the withdrawal
      await proveTx(token.mint(getAddress(liquidityPool), WITHDRAWAL_AMOUNT));
      await proveTx(liquidityPool.deposit(WITHDRAWAL_AMOUNT - 1n));

      await expect(liquidityPool.withdraw(WITHDRAWAL_AMOUNT, 0))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_INSUFFICIENT_BALANCE);
    });
  });

  describe("Function 'withdrawToOperationalTreasury()'", async () => {
    it("Executes as expected", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      await withdrawAndCheck(liquidityPool, WITHDRAWAL_AMOUNT, FUNC_SIGNATURE_WITHDRAW_TO_OPERATIONAL_TREASURY);
    });

    it("Is reverted if the caller does not have the admin role", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await expect(connect(liquidityPool, owner).withdrawToOperationalTreasury(WITHDRAWAL_AMOUNT))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(owner.address, ADMIN_ROLE);

      await expect(connect(liquidityPool, attacker).withdrawToOperationalTreasury(WITHDRAWAL_AMOUNT))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(attacker.address, ADMIN_ROLE);
    });

    it("Is reverted if the operational treasury is not set", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      await proveTx(liquidityPool.setOperationalTreasury(ZERO_ADDRESS));

      await expect(connect(liquidityPool, admin).withdrawToOperationalTreasury(WITHDRAWAL_AMOUNT))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_OPERATIONAL_TREASURY_ADDRESS_ZERO);
    });

    it("Is reverted if the amount is zero", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await expect(connect(liquidityPool, admin).withdrawToOperationalTreasury(0))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_INVALID_AMOUNT);
    });

    it("Is reverted if the liquidity pool balance is enough but borrowable balance is not", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      // Make the pool token balance enough for the withdrawal
      await proveTx(token.mint(getAddress(liquidityPool), WITHDRAWAL_AMOUNT));
      await proveTx(liquidityPool.deposit(WITHDRAWAL_AMOUNT - 1n));

      await expect(connect(liquidityPool, admin).withdrawToOperationalTreasury(WITHDRAWAL_AMOUNT))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_INSUFFICIENT_BALANCE);
    });
  });

  describe("Function 'withdrawToReserve()'", async () => {
    it("Executes as expected", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const tx = withdrawAndCheck(liquidityPool, WITHDRAWAL_AMOUNT, FUNC_SIGNATURE_WITHDRAW_TO_RESERVE);
      await expect(tx).to.emit(token, EVENT_NAME_MOCK_BURNING_TO_RESERVE).withArgs(
        getAddress(liquidityPool),
        WITHDRAWAL_AMOUNT
      );
    });

    it("Is reverted if the caller does not have the admin role", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await expect(connect(liquidityPool, owner).withdrawToReserve(WITHDRAWAL_AMOUNT))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(owner.address, ADMIN_ROLE);

      await expect(connect(liquidityPool, attacker).withdrawToReserve(WITHDRAWAL_AMOUNT))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(attacker.address, ADMIN_ROLE);
    });

    it("Is reverted if the amount is zero", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await expect(connect(liquidityPool, admin).withdrawToReserve(0))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_INVALID_AMOUNT);
    });

    it("Is reverted if the liquidity pool balance is enough but borrowable balance is not", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      // Make the pool token balance enough for the withdrawal
      await proveTx(token.mint(getAddress(liquidityPool), WITHDRAWAL_AMOUNT));
      await proveTx(liquidityPool.deposit(WITHDRAWAL_AMOUNT - 1n));

      await expect(connect(liquidityPool, admin).withdrawToReserve(WITHDRAWAL_AMOUNT))
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
        [owner.address, getAddress(liquidityPool)],
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
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(attacker.address, OWNER_ROLE);
    });
  });

  describe("Function 'onBeforeLoanTaken()'", async () => {
    async function executeAndCheck(liquidityPool: Contract, addonTreasuryAddress: string) {
      if (addonTreasuryAddress !== ZERO_ADDRESS) {
        await proveTx(liquidityPool.setAddonTreasury(addonTreasuryAddress));
      }
      await prepareLoan({ loanId: LOAN_ID, borrowedAmount: BORROWED_AMOUNT, addonAmount: ADDON_AMOUNT });
      await proveTx(liquidityPool.deposit(DEPOSIT_AMOUNT));

      await proveTx(market.callOnBeforeLoanTakenLiquidityPool(getAddress(liquidityPool), LOAN_ID));

      const actualBalances = await liquidityPool.getBalances();

      expect(actualBalances[0]).to.eq(DEPOSIT_AMOUNT - BORROWED_AMOUNT - ADDON_AMOUNT);
      expect(actualBalances[1]).to.eq(0);
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
      await prepareLoan({ loanId: LOAN_ID, borrowedAmount: DEPOSIT_AMOUNT + 1n, addonAmount: 0n });
      await proveTx(liquidityPool.deposit(DEPOSIT_AMOUNT));

      await expect(market.callOnBeforeLoanTakenLiquidityPool(getAddress(liquidityPool), LOAN_ID))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_INSUFFICIENT_BALANCE);
    });
  });

  describe("Function 'onAfterLoanPayment()'", async () => {
    it("Executes as expected", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      await proveTx(liquidityPool.deposit(DEPOSIT_AMOUNT));

      await proveTx(market.callOnAfterLoanPaymentLiquidityPool(getAddress(liquidityPool), LOAN_ID, REPAYMENT_AMOUNT));

      const actualBalances = await liquidityPool.getBalances();
      expect(actualBalances[0]).to.eq(DEPOSIT_AMOUNT + REPAYMENT_AMOUNT);
      expect(actualBalances[1]).to.eq(0n);
    });

    it("Is reverted if the contract is paused", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      await proveTx(liquidityPool.pause());

      await expect(
        market.callOnAfterLoanPaymentLiquidityPool(getAddress(liquidityPool), LOAN_ID, REPAYMENT_AMOUNT)
      ).to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the caller is not the market", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await expect(liquidityPool.onAfterLoanPayment(LOAN_ID, REPAYMENT_AMOUNT))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_UNAUTHORIZED);
    });

    it("Is reverted if there is an overflow in the borrowable balance", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const depositAmount = maxUintForBits(64);
      const repaymentAmount = 1n;
      await proveTx(token.mint(owner.address, depositAmount));
      await proveTx(liquidityPool.deposit(depositAmount));

      await expect(market.callOnAfterLoanPaymentLiquidityPool(
        getAddress(liquidityPool),
        LOAN_ID,
        repaymentAmount
      )).to.revertedWithPanic(0x11);
    });
  });

  describe("Function 'onAfterLoanRepaymentUndoing()'", async () => {
    it("Executes as expected", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      await proveTx(liquidityPool.deposit(DEPOSIT_AMOUNT));

      await proveTx(
        market.callOnAfterLoanRepaymentUndoingLiquidityPool(getAddress(liquidityPool), LOAN_ID, REPAYMENT_AMOUNT)
      );

      const actualBalances = await liquidityPool.getBalances();
      expect(actualBalances[0]).to.eq(DEPOSIT_AMOUNT - REPAYMENT_AMOUNT);
      expect(actualBalances[1]).to.eq(0n);
    });

    it("Is reverted if the contract is paused", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      await proveTx(liquidityPool.pause());

      await expect(
        market.callOnAfterLoanRepaymentUndoingLiquidityPool(getAddress(liquidityPool), LOAN_ID, REPAYMENT_AMOUNT)
      ).to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the caller is not the market", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await expect(liquidityPool.onAfterLoanRepaymentUndoing(LOAN_ID, REPAYMENT_AMOUNT))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_UNAUTHORIZED);
    });

    it("Is reverted if there is an underflow in the borrowable balance", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const depositAmount = 1n;
      const repaymentAmount = 2n;
      await proveTx(token.mint(owner.address, depositAmount));
      await proveTx(liquidityPool.deposit(depositAmount));

      await expect(market.callOnAfterLoanRepaymentUndoingLiquidityPool(
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
      await prepareLoan({ loanId: LOAN_ID, borrowedAmount: BORROWED_AMOUNT, addonAmount: ADDON_AMOUNT, repaidAmount });
      await proveTx(market.callOnBeforeLoanTakenLiquidityPool(poolAddress, LOAN_ID));
      await proveTx(market.callOnAfterLoanPaymentLiquidityPool(poolAddress, LOAN_ID, repaidAmount));

      if (addonTreasuryAddress !== ZERO_ADDRESS) {
        await proveTx(liquidityPool.setAddonTreasury(addonTreasuryAddress));
      }

      const actualBalancesBefore: bigint[] = await liquidityPool.getBalances();
      expect(actualBalancesBefore[0]).to.eq(DEPOSIT_AMOUNT - BORROWED_AMOUNT - ADDON_AMOUNT + repaidAmount);
      expect(actualBalancesBefore[1]).to.eq(0n);

      await proveTx(market.callOnAfterLoanRevocationLiquidityPool(poolAddress, LOAN_ID));

      const actualBalancesAfter: bigint[] = await liquidityPool.getBalances();

      if (addonTreasuryAddress === ZERO_ADDRESS) {
        expect(actualBalancesAfter[0]).to.eq(DEPOSIT_AMOUNT);
        expect(actualBalancesAfter[1]).to.eq(0n);
      } else {
        expect(actualBalancesAfter[0]).to.eq(DEPOSIT_AMOUNT);
        expect(actualBalancesAfter[1]).to.eq(actualBalancesBefore[1]);
      }
    }

    describe("Executes as expected if the addon treasure address is zero and", async () => {
      it("The addon treasure address is zero and the repaid amount is less than the borrowed amount", async () => {
        const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
        await executeAndCheck(liquidityPool, {
          repaidAmount: BORROWED_AMOUNT / 3n,
          addonTreasuryAddress: ZERO_ADDRESS
        });
      });

      it("The repaid amount is greater than the borrowed amount", async () => {
        const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
        await executeAndCheck(liquidityPool, {
          repaidAmount: BORROWED_AMOUNT * 3n,
          addonTreasuryAddress: ZERO_ADDRESS
        });
      });

      it("The repaid amount equals the borrowed amount", async () => {
        const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
        await executeAndCheck(liquidityPool, { repaidAmount: BORROWED_AMOUNT, addonTreasuryAddress: ZERO_ADDRESS });
      });
    });

    describe("Executes as expected if the addon treasure address is non-zero and", async () => {
      it("The addon treasure address is zero and the repaid amount is less than the borrowed amount", async () => {
        const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
        const addonTreasuryAddress = addonTreasury.address;
        await executeAndCheck(liquidityPool, { repaidAmount: BORROWED_AMOUNT / 3n, addonTreasuryAddress });
      });

      it("The repaid amount is greater than the borrowed amount", async () => {
        const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
        const addonTreasuryAddress = addonTreasury.address;
        await executeAndCheck(liquidityPool, { repaidAmount: BORROWED_AMOUNT * 3n, addonTreasuryAddress });
      });

      it("The repaid amount equals the borrowed amount", async () => {
        const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
        const addonTreasuryAddress = addonTreasury.address;
        await executeAndCheck(liquidityPool, { repaidAmount: BORROWED_AMOUNT, addonTreasuryAddress });
      });
    });

    describe("Is reverted if", async () => {
      it("The contract is paused", async () => {
        const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
        await proveTx(liquidityPool.pause());

        await expect(market.callOnAfterLoanRevocationLiquidityPool(getAddress(liquidityPool), LOAN_ID))
          .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ENFORCED_PAUSED);
      });

      it("The caller is not the market", async () => {
        const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

        await expect(liquidityPool.onAfterLoanRevocation(LOAN_ID))
          .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_UNAUTHORIZED);
      });
    });
  });
});
