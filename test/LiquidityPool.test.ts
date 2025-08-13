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
const ERROR_NAME_ADDON_TREASURY_ADDRESS_ZEROING_PROHIBITED = "LiquidityPool_AddonTreasuryAddressZeroingProhibited";
const ERROR_NAME_ALREADY_CONFIGURED = "LiquidityPool_AlreadyConfigured";
const ERROR_NAME_CONTRACT_ADDRESS_INVALID = "LiquidityPool_ContractAddressInvalid";
const ERROR_NAME_BALANCE_EXCESS = "LiquidityPool_BalanceExcess";
const ERROR_NAME_BALANCE_INSUFFICIENT = "LiquidityPool_BalanceInsufficient";
const ERROR_NAME_INVALID_AMOUNT = "LiquidityPool_InvalidAmount";
const ERROR_NAME_IMPLEMENTATION_ADDRESS_INVALID = "LiquidityPool_ImplementationAddressInvalid";
const ERROR_NAME_OPERATIONAL_TREASURY_ADDRESS_ZERO = "LiquidityPool_OperationalTreasuryAddressZero";
const ERROR_NAME_OPERATIONAL_TREASURY_ZERO_ALLOWANCE_FOR_POOL = "LiquidityPool_OperationalTreasuryZeroAllowanceForPool";
const ERROR_NAME_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST = "SafeCastOverflowedUintDowncast";
const ERROR_NAME_OWNER_ADDRESS_ZERO = "LiquidityPool_OwnerAddressZero";
const ERROR_NAME_TOKEN_ADDRESS_ZERO = "LiquidityPool_TokenAddressZero";
const ERROR_NAME_SPENDER_ADDRESS_ZERO = "LiquidityPool_SpenderAddressZero";
const ERROR_NAME_RESCUE_TOKEN_ADDRESS_ZERO = "LiquidityPool_RescueTokenAddressZero";

const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
const GRANTOR_ROLE = ethers.id("GRANTOR_ROLE");
const OWNER_ROLE = ethers.id("OWNER_ROLE");
const PAUSER_ROLE = ethers.id("PAUSER_ROLE");
const ADMIN_ROLE = ethers.id("ADMIN_ROLE");
const LIQUIDITY_OPERATOR_ROLE = ethers.id("LIQUIDITY_OPERATOR_ROLE");

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
const REPAYMENT_AMOUNT = DEPOSIT_AMOUNT / 50n;

describe("Contract 'LiquidityPool'", async () => {
  let liquidityPoolFactory: ContractFactory;
  let tokenFactory: ContractFactory;

  let token: Contract;

  let deployer: HardhatEthersSigner;
  let owner: HardhatEthersSigner;
  let admin: HardhatEthersSigner;
  let liquidityOperator: HardhatEthersSigner;
  let attacker: HardhatEthersSigner;
  let addonTreasury: HardhatEthersSigner;
  let operationalTreasury: HardhatEthersSigner;

  let tokenAddress: string;

  before(async () => {
    [
      deployer,
      owner,
      admin,
      liquidityOperator,
      attacker,
      addonTreasury,
      operationalTreasury
    ] = await ethers.getSigners();

    // Factories with an explicitly specified deployer account
    liquidityPoolFactory = await ethers.getContractFactory("LiquidityPoolTestable");
    liquidityPoolFactory = liquidityPoolFactory.connect(deployer);
    tokenFactory = await ethers.getContractFactory("ERC20Mock");
    tokenFactory = tokenFactory.connect(deployer);

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
    await proveTx(liquidityPool.grantRole(LIQUIDITY_OPERATOR_ROLE, liquidityOperator.address));
    await proveTx(liquidityPool.approveSpender(liquidityOperator.address, MAX_ALLOWANCE));
    await proveTx(connect(token, operationalTreasury).approve(getAddress(liquidityPool), MAX_ALLOWANCE));
    await proveTx(liquidityPool.setOperationalTreasury(operationalTreasury.address));
    return { liquidityPool };
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
    const borrowableAmount = (withdrawalAmount);
    const addonAmount = 0n;
    await proveTx(liquidityPool.deposit(borrowableBalance));

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
      expect(await liquidityPool.LIQUIDITY_OPERATOR_ROLE()).to.equal(LIQUIDITY_OPERATOR_ROLE);
      expect(await liquidityPool.PAUSER_ROLE()).to.equal(PAUSER_ROLE);

      // The role admins
      expect(await liquidityPool.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE);
      expect(await liquidityPool.getRoleAdmin(GRANTOR_ROLE)).to.equal(OWNER_ROLE);
      expect(await liquidityPool.getRoleAdmin(ADMIN_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await liquidityPool.getRoleAdmin(LIQUIDITY_OPERATOR_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await liquidityPool.getRoleAdmin(PAUSER_ROLE)).to.equal(GRANTOR_ROLE);

      // Roles
      expect(await liquidityPool.hasRole(OWNER_ROLE, deployer.address)).to.equal(false);
      expect(await liquidityPool.hasRole(GRANTOR_ROLE, deployer.address)).to.equal(false);
      expect(await liquidityPool.hasRole(ADMIN_ROLE, deployer.address)).to.equal(false);
      expect(await liquidityPool.hasRole(LIQUIDITY_OPERATOR_ROLE, deployer.address)).to.equal(false);
      expect(await liquidityPool.hasRole(PAUSER_ROLE, deployer.address)).to.equal(false);
      expect(await liquidityPool.hasRole(OWNER_ROLE, owner.address)).to.equal(true); // !!!
      expect(await liquidityPool.hasRole(GRANTOR_ROLE, owner.address)).to.equal(false);
      expect(await liquidityPool.hasRole(ADMIN_ROLE, owner.address)).to.equal(false);
      expect(await liquidityPool.hasRole(LIQUIDITY_OPERATOR_ROLE, owner.address)).to.equal(false);
      expect(await liquidityPool.hasRole(PAUSER_ROLE, owner.address)).to.equal(false);

      // The initial contract state is unpaused
      expect(await liquidityPool.paused()).to.equal(false);

      // Other important parameters and storage variables
      expect(await liquidityPool.getBalances()).to.deep.eq([0n, 0n]);
      expect(await liquidityPool.token()).to.eq(tokenAddress);
      expect(await liquidityPool.addonTreasury()).to.eq(ZERO_ADDRESS);
    });

    it("Is reverted if the owner address is zero", async () => {
      const wrongOwnerAddress = (ZERO_ADDRESS);
      await expect(upgrades.deployProxy(liquidityPoolFactory, [
        wrongOwnerAddress,
        tokenAddress
      ])).to.be.revertedWithCustomError(liquidityPoolFactory, ERROR_NAME_OWNER_ADDRESS_ZERO);
    });

    it("Is reverted if the token address is zero", async () => {
      const wrongTokenAddress = (ZERO_ADDRESS);
      await expect(upgrades.deployProxy(liquidityPoolFactory, [
        owner.address,
        wrongTokenAddress
      ])).to.be.revertedWithCustomError(liquidityPoolFactory, ERROR_NAME_TOKEN_ADDRESS_ZERO);
    });

    it("Is reverted if the token address is not a contract address", async () => {
      const wrongTokenAddress = deployer.address;
      await expect(upgrades.deployProxy(liquidityPoolFactory, [
        owner.address,
        wrongTokenAddress
      ])).to.be.revertedWithCustomError(liquidityPoolFactory, ERROR_NAME_CONTRACT_ADDRESS_INVALID);
    });

    it("Is reverted if the token address does not belong to a token contract", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);
      const wrongTokenAddress = getAddress(liquidityPool);
      await expect(upgrades.deployProxy(liquidityPoolFactory, [
        owner.address,
        wrongTokenAddress
      ])).to.be.revertedWithCustomError(liquidityPoolFactory, ERROR_NAME_CONTRACT_ADDRESS_INVALID);
    });

    it("Is reverted if called a second time", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await expect(liquidityPool.initialize(owner.address, tokenAddress))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_INVALID_INITIALIZATION);
    });

    it("Is reverted for the contract implementation if it is called even for the first time", async () => {
      const liquidityPoolImplementation = await liquidityPoolFactory.deploy() as Contract;
      await liquidityPoolImplementation.waitForDeployment();

      await expect(liquidityPoolImplementation.initialize(owner.address, tokenAddress))
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

  describe("Function 'approveSpender()", async () => {
    it("Executes as expected", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);
      let expectedAllowance = 1;

      let actualAllowance = await token.allowance(getAddress(liquidityPool), liquidityOperator.address);
      expect(actualAllowance).to.eq(0);

      let tx = liquidityPool.approveSpender(liquidityOperator.address, expectedAllowance);
      await expect(tx)
        .to.emit(token, EVENT_NAME_APPROVAL)
        .withArgs(getAddress(liquidityPool), liquidityOperator.address, expectedAllowance);
      actualAllowance = await token.allowance(getAddress(liquidityPool), liquidityOperator.address);
      expect(actualAllowance).to.eq(expectedAllowance);

      expectedAllowance = ZERO_ALLOWANCE;
      tx = liquidityPool.approveSpender(liquidityOperator.address, expectedAllowance);
      await expect(tx)
        .to.emit(token, EVENT_NAME_APPROVAL)
        .withArgs(getAddress(liquidityPool), liquidityOperator.address, expectedAllowance);
      actualAllowance = await token.allowance(getAddress(liquidityPool), liquidityOperator.address);
      expect(actualAllowance).to.eq(expectedAllowance);
    });

    it("Is reverted if caller does not have the owner role", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await expect(connect(liquidityPool, attacker).approveSpender(attacker.address, MAX_ALLOWANCE))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(attacker.address, OWNER_ROLE);
    });

    it("Is reverted if the spender address is zero", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await expect(liquidityPool.approveSpender(ZERO_ADDRESS, MAX_ALLOWANCE))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_SPENDER_ADDRESS_ZERO);
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

      const tx = depositAndCheck(liquidityPool, DEPOSIT_AMOUNT);
      await expect(tx).not.to.emit(token, EVENT_NAME_APPROVAL); // No approval must happen within the deposit function
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
      const tx = depositAndCheck(liquidityPool, DEPOSIT_AMOUNT, FUNC_SIGNATURE_DEPOSIT_FROM_OPERATIONAL_TREASURY);
      await expect(tx).not.to.emit(token, EVENT_NAME_APPROVAL); // No approval must happen within the deposit function
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

      const tx = depositAndCheck(liquidityPool, DEPOSIT_AMOUNT, FUNC_SIGNATURE_DEPOSIT_FROM_RESERVE);
      await expect(tx).to.emit(token, EVENT_NAME_MOCK_MINTING_FROM_RESERVE).withArgs(
        liquidityPoolAddress,
        liquidityPoolAddress,
        DEPOSIT_AMOUNT
      );
      await expect(tx).not.to.emit(token, EVENT_NAME_APPROVAL); // No approval must happen within the deposit function
      expect(await getNumberOfEvents(tx, token, EVENT_NAME_TRANSFER)).to.eq(1);
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

    it("Is reverted if the addon balance is a non-zero amount", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      await liquidityPool.deposit(DEPOSIT_AMOUNT);
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
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_BALANCE_INSUFFICIENT);
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
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_BALANCE_INSUFFICIENT);
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
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_BALANCE_INSUFFICIENT);
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
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_RESCUE_TOKEN_ADDRESS_ZERO);
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

  describe("Function 'migrate()'", async () => {
    // In this section function `setMarket()` and `getMarket()` are called on the testable version of the contract.

    it("Executes as expected and clears the market address", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const mockMarketAddress = admin.address;
      await proveTx(liquidityPool.setMarket(mockMarketAddress));

      expect(await liquidityPool.getMarket()).to.eq(mockMarketAddress);
      await proveTx(liquidityPool.migrate());
      expect(await liquidityPool.getMarket()).to.eq(ZERO_ADDRESS);
    });

    it("Can be called multiple times without reverting", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await proveTx(liquidityPool.migrate());
      await proveTx(liquidityPool.migrate());

      expect(await liquidityPool.getMarket()).to.eq(ZERO_ADDRESS);
    });

    it("Can be called when contract is paused", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await proveTx(liquidityPool.pause());
      expect(await liquidityPool.paused()).to.equal(true);

      await proveTx(liquidityPool.migrate());
      expect(await liquidityPool.getMarket()).to.eq(ZERO_ADDRESS);
    });

    it("Can be called by any account (no access control)", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await proveTx(connect(liquidityPool, owner).migrate());
      await proveTx(connect(liquidityPool, admin).migrate());
      await proveTx(connect(liquidityPool, liquidityOperator).migrate());
      await proveTx(connect(liquidityPool, attacker).migrate());

      expect(await liquidityPool.getMarket()).to.eq(ZERO_ADDRESS);
    });
  });

  describe("Function 'onBeforeLiquidityIn()'", async () => {
    it("Executes as expected", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      await proveTx(liquidityPool.deposit(DEPOSIT_AMOUNT));

      await proveTx(connect(liquidityPool, liquidityOperator).onBeforeLiquidityIn(REPAYMENT_AMOUNT));

      const actualBalances = await liquidityPool.getBalances();
      expect(actualBalances[0]).to.eq(DEPOSIT_AMOUNT + REPAYMENT_AMOUNT);
      expect(actualBalances[1]).to.eq(0n);
    });

    it("Is reverted if the contract is paused", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      await proveTx(liquidityPool.pause());

      await expect(
        connect(liquidityPool, liquidityOperator).onBeforeLiquidityIn(REPAYMENT_AMOUNT)
      ).to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the caller does not have the liquidity operator role", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await expect(liquidityPool.onBeforeLiquidityIn(REPAYMENT_AMOUNT))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(owner.address, LIQUIDITY_OPERATOR_ROLE);
    });

    it("Is reverted if the input amount is greater than 64-bit unsigned integer", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const repaymentAmount = maxUintForBits(64) + 1n;

      await expect(connect(liquidityPool, liquidityOperator).onBeforeLiquidityIn(repaymentAmount))
        .to.revertedWithCustomError(liquidityPool, ERROR_NAME_BALANCE_EXCESS);
    });

    it("Is reverted if there is an overflow in the borrowable balance", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const depositAmount = maxUintForBits(64);
      const repaymentAmount = 1n;
      await proveTx(token.mint(owner.address, depositAmount));
      await proveTx(liquidityPool.deposit(depositAmount));

      await expect(connect(liquidityPool, liquidityOperator).onBeforeLiquidityIn(repaymentAmount))
        .to.revertedWithCustomError(liquidityPool, ERROR_NAME_BALANCE_EXCESS);
    });
  });

  describe("Function 'onBeforeLiquidityOut()'", async () => {
    it("Executes as expected", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      await proveTx(liquidityPool.deposit(DEPOSIT_AMOUNT));

      await proveTx(connect(liquidityPool, liquidityOperator).onBeforeLiquidityOut(REPAYMENT_AMOUNT));

      const actualBalances = await liquidityPool.getBalances();
      expect(actualBalances[0]).to.eq(DEPOSIT_AMOUNT - REPAYMENT_AMOUNT);
      expect(actualBalances[1]).to.eq(0n);
    });

    it("Is reverted if the contract is paused", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      await proveTx(liquidityPool.pause());

      await expect(
        connect(liquidityPool, liquidityOperator).onBeforeLiquidityOut(REPAYMENT_AMOUNT)
      ).to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ENFORCED_PAUSED);
    });

    it("Is reverted if the caller does not have the liquidity operator role", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await expect(liquidityPool.onBeforeLiquidityOut(REPAYMENT_AMOUNT))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(owner.address, LIQUIDITY_OPERATOR_ROLE);
    });

    it("Is reverted if there is an underflow in the borrowable balance", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const depositAmount = 1n;
      const repaymentAmount = 2n;
      await proveTx(token.mint(owner.address, depositAmount));
      await proveTx(liquidityPool.deposit(depositAmount));

      await expect(connect(liquidityPool, liquidityOperator).onBeforeLiquidityOut(repaymentAmount))
        .to.revertedWithCustomError(liquidityPool, ERROR_NAME_BALANCE_INSUFFICIENT);
    });
  });
});
