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
  proveTx,
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
const EVENT_NAME_WORKING_TREASURY_REGISTERED = "WorkingTreasuryRegistered";
const EVENT_NAME_WORKING_TREASURY_UNREGISTERED = "WorkingTreasuryUnregistered";

// Errors of the library contracts
const ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT = "AccessControlUnauthorizedAccount";
const ERROR_NAME_ENFORCED_PAUSED = "EnforcedPause";
const ERROR_NAME_INVALID_INITIALIZATION = "InvalidInitialization";

// Errors of the contracts under test
const ERROR_NAME_ADDON_TREASURY_ADDRESS_ZEROING_PROHIBITED = "LiquidityPool_AddonTreasuryAddressZeroingProhibited";
const ERROR_NAME_ALREADY_CONFIGURED = "LiquidityPool_AlreadyConfigured";
const ERROR_NAME_AMOUNT_INVALID = "LiquidityPool_AmountInvalid";
const ERROR_NAME_BALANCE_EXCESS = "LiquidityPool_BalanceExcess";
const ERROR_NAME_BALANCE_INSUFFICIENT = "LiquidityPool_BalanceInsufficient";
const ERROR_NAME_CONTRACT_ADDRESS_INVALID = "LiquidityPool_ContractAddressInvalid";
const ERROR_NAME_IMPLEMENTATION_ADDRESS_INVALID = "LiquidityPool_ImplementationAddressInvalid";
const ERROR_NAME_OPERATIONAL_TREASURY_ADDRESS_ZERO = "LiquidityPool_OperationalTreasuryAddressZero";
const ERROR_NAME_OPERATIONAL_TREASURY_ZERO_ALLOWANCE_FOR_POOL = "LiquidityPool_OperationalTreasuryZeroAllowanceForPool";
const ERROR_NAME_OWNER_ADDRESS_ZERO = "LiquidityPool_OwnerAddressZero";
const ERROR_NAME_RESCUE_TOKEN_ADDRESS_ZERO = "LiquidityPool_RescueTokenAddressZero";
const ERROR_NAME_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST = "SafeCastOverflowedUintDowncast";
const ERROR_NAME_SPENDER_ADDRESS_ZERO = "LiquidityPool_SpenderAddressZero";
const ERROR_NAME_TOKEN_ADDRESS_ZERO = "LiquidityPool_TokenAddressZero";
const ERROR_NAME_WORKING_TREASURY_ADDRESS_ZERO = "LiquidityPool_WorkingTreasuryAddressZero";
const ERROR_NAME_WORKING_TREASURY_UNREGISTERED = "LiquidityPool_WorkingTreasuryUnregistered";
const ERROR_NAME_WORKING_TREASURY_ZERO_ALLOWANCE_FOR_POOL = "LiquidityPool_WorkingTreasuryZeroAllowanceForPool";

const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
const GRANTOR_ROLE = ethers.id("GRANTOR_ROLE");
const OWNER_ROLE = ethers.id("OWNER_ROLE");
const PAUSER_ROLE = ethers.id("PAUSER_ROLE");
const ADMIN_ROLE = ethers.id("ADMIN_ROLE");
const LIQUIDITY_OPERATOR_ROLE = ethers.id("LIQUIDITY_OPERATOR_ROLE");

const ZERO_ADDRESS = ethers.ZeroAddress;
const MAX_ALLOWANCE = ethers.MaxUint256;
const ZERO_ALLOWANCE = 0;
const MINT_AMOUNT = 10_000_000_000_000n;
const DEPOSIT_AMOUNT = MINT_AMOUNT / 100n;
const WITHDRAWAL_AMOUNT = MINT_AMOUNT / 200n;
const REPAYMENT_AMOUNT = DEPOSIT_AMOUNT / 500n;
const ADDON_AMOUNT_ZERO = 0;

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
  let workingTreasuries: HardhatEthersSigner[];

  let tokenAddress: string;

  before(async () => {
    let otherAccounts: HardhatEthersSigner[];
    [
      deployer,
      owner,
      admin,
      liquidityOperator,
      attacker,
      addonTreasury,
      operationalTreasury,
      ...otherAccounts
    ] = await ethers.getSigners();

    workingTreasuries = otherAccounts.slice(0, 3);

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
    await token.mint(operationalTreasury.address, MINT_AMOUNT);
    for (const workingTreasury of workingTreasuries) {
      await token.mint(workingTreasury.address, MINT_AMOUNT);
    }
  });

  async function deployLiquidityPool(): Promise<{ liquidityPool: Contract }> {
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
    for (const workingTreasury of workingTreasuries) {
      await proveTx(connect(token, workingTreasury).approve(getAddress(liquidityPool), MAX_ALLOWANCE));
      await proveTx(liquidityPool.registerWorkingTreasury(workingTreasury.address));
    }
    return { liquidityPool };
  }

  async function checkDepositTx(
    liquidityPool: Contract,
    tx: Promise<TransactionResponse>,
    depositAmount: bigint,
    balancesBefore: bigint[],
  ) {
    await expect(tx)
      .to.emit(liquidityPool, EVENT_NAME_DEPOSIT)
      .withArgs(depositAmount);

    const balancesAfter = await liquidityPool.getBalances();

    expect(balancesAfter[0]).to.eq(balancesBefore[0] + depositAmount);
    expect(balancesAfter[1]).to.eq(0n);

    await expect(tx).not.to.emit(token, EVENT_NAME_APPROVAL); // No approval must happen within the deposit function
  }

  async function checkWithdrawalTx(
    liquidityPool: Contract,
    tx: Promise<TransactionResponse>,
    withdrawalAmount: bigint,
    balancesBefore: bigint[],
  ): Promise<TransactionResponse> {
    await expect(tx)
      .to.emit(liquidityPool, EVENT_NAME_WITHDRAWAL)
      .withArgs(withdrawalAmount, ADDON_AMOUNT_ZERO);

    const actualBalancesAfter = await liquidityPool.getBalances();

    expect(actualBalancesAfter[0]).to.eq(balancesBefore[0] - withdrawalAmount);
    expect(actualBalancesAfter[1]).to.eq(ADDON_AMOUNT_ZERO);

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
        tokenAddress,
      ])).to.be.revertedWithCustomError(liquidityPoolFactory, ERROR_NAME_OWNER_ADDRESS_ZERO);
    });

    it("Is reverted if the token address is zero", async () => {
      const wrongTokenAddress = (ZERO_ADDRESS);
      await expect(upgrades.deployProxy(liquidityPoolFactory, [
        owner.address,
        wrongTokenAddress,
      ])).to.be.revertedWithCustomError(liquidityPoolFactory, ERROR_NAME_TOKEN_ADDRESS_ZERO);
    });

    it("Is reverted if the token address is not a contract address", async () => {
      const wrongTokenAddress = deployer.address;
      await expect(upgrades.deployProxy(liquidityPoolFactory, [
        owner.address,
        wrongTokenAddress,
      ])).to.be.revertedWithCustomError(liquidityPoolFactory, ERROR_NAME_CONTRACT_ADDRESS_INVALID);
    });

    it("Is reverted if the token address does not belong to a token contract", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);
      const wrongTokenAddress = getAddress(liquidityPool);
      await expect(upgrades.deployProxy(liquidityPoolFactory, [
        owner.address,
        wrongTokenAddress,
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
      const mockContractFactory: ContractFactory = await ethers.getContractFactory("UUPSExtUpgradeableMock");
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

    it("Is reverted if the caller does not have the owner role", async () => {
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

    it("Is reverted if the caller does not have the owner role", async () => {
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

  describe("Function 'registerWorkingTreasury()", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);
      const allowance = 1; // This allowance should be enough
      await proveTx(connect(token, workingTreasuries[0]).approve(getAddress(liquidityPool), allowance));
      await proveTx(connect(token, workingTreasuries[1]).approve(getAddress(liquidityPool), allowance));

      await expect(liquidityPool.registerWorkingTreasury(workingTreasuries[0].address))
        .to.emit(liquidityPool, EVENT_NAME_WORKING_TREASURY_REGISTERED)
        .withArgs(workingTreasuries[0].address);

      expect(await liquidityPool.workingTreasuries()).to.deep.equal([workingTreasuries[0].address]);

      // Check registration of a second working pool
      await expect(liquidityPool.registerWorkingTreasury(workingTreasuries[1].address))
        .to.emit(liquidityPool, EVENT_NAME_WORKING_TREASURY_REGISTERED)
        .withArgs(workingTreasuries[1].address);

      expect(await liquidityPool.workingTreasuries()).to.deep.equal([
        workingTreasuries[0].address,
        workingTreasuries[1].address,
      ]);
    });

    it("Is reverted if the caller does not have the owner role", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);
      await proveTx(liquidityPool.grantRole(GRANTOR_ROLE, owner.address));
      await proveTx(liquidityPool.grantRole(ADMIN_ROLE, admin.address));
      await proveTx(liquidityPool.grantRole(LIQUIDITY_OPERATOR_ROLE, liquidityOperator.address));

      await expect(connect(liquidityPool, attacker).registerWorkingTreasury(workingTreasuries[0].address))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(attacker.address, OWNER_ROLE);

      await expect(connect(liquidityPool, admin).registerWorkingTreasury(workingTreasuries[0].address))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(admin.address, OWNER_ROLE);

      await expect(connect(liquidityPool, liquidityOperator).registerWorkingTreasury(workingTreasuries[0].address))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(liquidityOperator.address, OWNER_ROLE);
    });

    it("Is reverted if the provided working treasury address is zero", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await expect(liquidityPool.registerWorkingTreasury(ZERO_ADDRESS))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_WORKING_TREASURY_ADDRESS_ZERO);
    });

    it("Is reverted if the provided working treasury is already registered", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);
      const workingTreasury = workingTreasuries[0];
      const allowance = 1; // This allowance should be enough

      await proveTx(connect(token, workingTreasury).approve(getAddress(liquidityPool), allowance));
      await proveTx(liquidityPool.registerWorkingTreasury(workingTreasury.address));

      await expect(liquidityPool.registerWorkingTreasury(workingTreasury.address))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ALREADY_CONFIGURED);
    });

    it("Is reverted if the provided working treasury has not provided an allowance for the pool", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await expect(liquidityPool.registerWorkingTreasury(workingTreasuries[0].address))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_WORKING_TREASURY_ZERO_ALLOWANCE_FOR_POOL);
    });
  });

  describe("Function 'unregisterWorkingTreasury()", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const lastWorkingTreasury = workingTreasuries[workingTreasuries.length - 1];
      const firstWorkingTreasury = workingTreasuries[0];

      await expect(liquidityPool.unregisterWorkingTreasury(lastWorkingTreasury.address))
        .to.emit(liquidityPool, EVENT_NAME_WORKING_TREASURY_UNREGISTERED)
        .withArgs(lastWorkingTreasury.address);

      let expectedWorkingTreasuryAddresses: string[] = workingTreasuries
        .map(treasury => treasury.address)
        .slice(0, workingTreasuries.length - 1);
      expect(await liquidityPool.workingTreasuries()).to.deep.equal(expectedWorkingTreasuryAddresses);

      // Check unregistration of a second working pool
      await expect(liquidityPool.unregisterWorkingTreasury(firstWorkingTreasury.address))
        .to.emit(liquidityPool, EVENT_NAME_WORKING_TREASURY_UNREGISTERED)
        .withArgs(firstWorkingTreasury.address);

      expectedWorkingTreasuryAddresses = expectedWorkingTreasuryAddresses.slice(1);
      expect(await liquidityPool.workingTreasuries()).to.deep.equal(expectedWorkingTreasuryAddresses);
    });

    it("Is reverted if the caller does not have the owner role", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await expect(connect(liquidityPool, attacker).unregisterWorkingTreasury(workingTreasuries[0].address))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(attacker.address, OWNER_ROLE);

      await expect(connect(liquidityPool, admin).unregisterWorkingTreasury(workingTreasuries[0].address))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(admin.address, OWNER_ROLE);

      await expect(connect(liquidityPool, liquidityOperator).unregisterWorkingTreasury(workingTreasuries[0].address))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(liquidityOperator.address, OWNER_ROLE);
    });

    it("Is reverted if the provided working treasury address is zero or unregistered", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await expect(liquidityPool.unregisterWorkingTreasury(ZERO_ADDRESS))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_WORKING_TREASURY_UNREGISTERED);

      await expect(liquidityPool.unregisterWorkingTreasury(operationalTreasury.address))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_WORKING_TREASURY_UNREGISTERED);
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

    it("Is reverted if the caller does not have the owner role", async () => {
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

    it("Is reverted if the caller does not have the owner role", async () => {
      const { liquidityPool } = await setUpFixture(deployLiquidityPool);

      await expect(connect(liquidityPool, attacker).initAdminRole())
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(attacker.address, OWNER_ROLE);
    });
  });

  describe("Function 'deposit()'", async () => {
    it("Executes as expected", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const depositAmount = (DEPOSIT_AMOUNT);
      const balancesBefore = await liquidityPool.getBalances();

      const tx = liquidityPool.deposit(depositAmount);
      await expect(tx).to.changeTokenBalances(
        token,
        [liquidityPool, owner, admin, operationalTreasury],
        [depositAmount, -depositAmount, 0, 0],
      );

      await checkDepositTx(liquidityPool, tx, depositAmount, balancesBefore);
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
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_AMOUNT_INVALID);
    });

    it("Is reverted if the deposit amount is greater than 64-bit unsigned integer", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const amount = maxUintForBits(64) + 1n;

      await expect(liquidityPool.deposit(amount))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST)
        .withArgs(64, amount);
    });
  });

  describe("Function 'depositFromOperationalTreasury()'", async () => {
    it("Executes as expected", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const depositAmount = DEPOSIT_AMOUNT;
      const balancesBefore = await liquidityPool.getBalances();

      const tx = connect(liquidityPool, admin).depositFromOperationalTreasury(depositAmount);
      await expect(tx).to.changeTokenBalances(
        token,
        [liquidityPool, owner, admin, operationalTreasury],
        [depositAmount, 0, 0, -depositAmount],
      );
      await checkDepositTx(liquidityPool, tx, depositAmount, balancesBefore);
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
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_AMOUNT_INVALID);
    });

    it("Is reverted if the deposit amount is greater than 64-bit unsigned integer", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const amount = maxUintForBits(64) + 1n;

      await expect(connect(liquidityPool, admin).depositFromOperationalTreasury(amount))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST)
        .withArgs(64, amount);
    });
  });

  describe("Function 'depositFromWorkingTreasury()'", async () => {
    it("Executes as expected", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const depositAmount = DEPOSIT_AMOUNT;
      const balancesBefore = await liquidityPool.getBalances();
      const workingTreasury = workingTreasuries[0];

      const tx = connect(liquidityPool, admin).depositFromWorkingTreasury(workingTreasury, depositAmount);
      await expect(tx).to.changeTokenBalances(
        token,
        [liquidityPool, owner, admin, operationalTreasury, workingTreasury],
        [depositAmount, 0, 0, 0, -depositAmount],
      );
      await checkDepositTx(liquidityPool, tx, depositAmount, balancesBefore);
    });

    it("Is reverted if the caller does not have the admin role", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const workingTreasury = workingTreasuries[0];

      await expect(connect(liquidityPool, owner).depositFromWorkingTreasury(workingTreasury.address, DEPOSIT_AMOUNT))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(owner.address, ADMIN_ROLE);

      await expect(
        connect(liquidityPool, liquidityOperator).depositFromWorkingTreasury(workingTreasury.address, DEPOSIT_AMOUNT),
      ).to.be.revertedWithCustomError(
        liquidityPool,
        ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT,
      ).withArgs(liquidityOperator.address, ADMIN_ROLE);

      await expect(connect(liquidityPool, attacker).depositFromWorkingTreasury(workingTreasury.address, DEPOSIT_AMOUNT))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(attacker.address, ADMIN_ROLE);
    });

    it("Is reverted if the provided treasury is not a registered working one", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      for (const wrongWorkingTreasury of [operationalTreasury, addonTreasury]) {
        await expect(connect(liquidityPool, admin).depositFromWorkingTreasury(wrongWorkingTreasury.address, 0))
          .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_WORKING_TREASURY_UNREGISTERED);
      }
    });

    it("Is reverted if the deposit amount is zero", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const workingTreasury = workingTreasuries[0];

      await expect(connect(liquidityPool, admin).depositFromWorkingTreasury(workingTreasury.address, 0))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_AMOUNT_INVALID);
    });

    it("Is reverted if the deposit amount is greater than 64-bit unsigned integer", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const workingTreasury = workingTreasuries[0];
      const amount = maxUintForBits(64) + 1n;

      await expect(connect(liquidityPool, admin).depositFromWorkingTreasury(workingTreasury.address, amount))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST)
        .withArgs(64, amount);
    });
  });

  describe("Function 'depositFromReserve()'", async () => {
    it("Executes as expected", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const liquidityPoolAddress = getAddress(liquidityPool);
      const depositAmount = (DEPOSIT_AMOUNT);
      const balancesBefore = await liquidityPool.getBalances();

      const tx = connect(liquidityPool, admin).depositFromReserve(depositAmount);
      await expect(tx).to.changeTokenBalances(
        token,
        [liquidityPool, owner, admin, operationalTreasury],
        [depositAmount, 0, 0, 0],
      );
      await checkDepositTx(liquidityPool, tx, depositAmount, balancesBefore);
      await expect(tx)
        .to.emit(token, EVENT_NAME_MOCK_MINTING_FROM_RESERVE)
        .withArgs(liquidityPoolAddress, liquidityPoolAddress, depositAmount);
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
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_AMOUNT_INVALID);
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
      const withdrawalAmount = (WITHDRAWAL_AMOUNT);
      await proveTx(liquidityPool.deposit(withdrawalAmount * 2n));
      const balancesBefore = await liquidityPool.getBalances();

      const tx = liquidityPool.withdraw(withdrawalAmount, ADDON_AMOUNT_ZERO);
      await expect(tx).to.changeTokenBalances(
        token,
        [liquidityPool, owner, admin, operationalTreasury],
        [-withdrawalAmount, withdrawalAmount, 0, 0],
      );
      await checkWithdrawalTx(liquidityPool, tx, withdrawalAmount, balancesBefore);
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
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_AMOUNT_INVALID);
    });

    it("Is reverted if the addon balance is a non-zero amount", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      await liquidityPool.deposit(DEPOSIT_AMOUNT);
      let borrowableAmount = 1n;

      await expect(liquidityPool.withdraw(borrowableAmount, 1n))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_AMOUNT_INVALID);

      borrowableAmount = 0n;
      await expect(liquidityPool.withdraw(borrowableAmount, 1n))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_AMOUNT_INVALID);
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
      const withdrawalAmount = (WITHDRAWAL_AMOUNT);
      await proveTx(liquidityPool.deposit(withdrawalAmount * 2n));
      const balancesBefore = await liquidityPool.getBalances();

      const tx = connect(liquidityPool, admin).withdrawToOperationalTreasury(withdrawalAmount);
      await expect(tx).to.changeTokenBalances(
        token,
        [liquidityPool, owner, admin, operationalTreasury],
        [-withdrawalAmount, 0, 0, withdrawalAmount],
      );
      await checkWithdrawalTx(liquidityPool, tx, withdrawalAmount, balancesBefore);
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
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_AMOUNT_INVALID);
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

  describe("Function 'withdrawToWorkingTreasury()'", async () => {
    it("Executes as expected", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const withdrawalAmount = (WITHDRAWAL_AMOUNT);
      await proveTx(liquidityPool.deposit(withdrawalAmount * 2n));
      const balancesBefore = await liquidityPool.getBalances();
      const workingTreasury = workingTreasuries[0];

      const tx = connect(liquidityPool, admin).withdrawToWorkingTreasury(workingTreasury.address, withdrawalAmount);
      await expect(tx).to.changeTokenBalances(
        token,
        [liquidityPool, owner, admin, operationalTreasury, workingTreasury],
        [-withdrawalAmount, 0, 0, 0, withdrawalAmount],
      );
      await checkWithdrawalTx(liquidityPool, tx, withdrawalAmount, balancesBefore);
    });

    it("Is reverted if the caller does not have the admin role", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const workingTreasury = workingTreasuries[0];

      await expect(connect(liquidityPool, owner).withdrawToWorkingTreasury(workingTreasury.address, WITHDRAWAL_AMOUNT))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(owner.address, ADMIN_ROLE);

      await expect(connect(liquidityPool, liquidityOperator).withdrawToWorkingTreasury(
        workingTreasury.address,
        WITHDRAWAL_AMOUNT,
      )).to.be.revertedWithCustomError(
        liquidityPool,
        ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT,
      ).withArgs(liquidityOperator.address, ADMIN_ROLE);

      await expect(connect(liquidityPool, attacker).withdrawToWorkingTreasury(
        workingTreasury.address,
        WITHDRAWAL_AMOUNT,
      )).to.be.revertedWithCustomError(
        liquidityPool,
        ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT,
      ).withArgs(attacker.address, ADMIN_ROLE);
    });

    it("Is reverted if the provided treasury is not registered working one", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      for (const wrongWorkingTreasury of [operationalTreasury, addonTreasury]) {
        await expect(
          connect(liquidityPool, admin).withdrawToWorkingTreasury(wrongWorkingTreasury.address, WITHDRAWAL_AMOUNT),
        ).to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_WORKING_TREASURY_UNREGISTERED);
      }
    });

    it("Is reverted if the amount is zero", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);

      await expect(connect(liquidityPool, admin).withdrawToWorkingTreasury(workingTreasuries[0].address, 0))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_AMOUNT_INVALID);
    });

    it("Is reverted if the liquidity pool balance is enough but borrowable balance is not", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      // Make the pool token balance enough for the withdrawal
      await proveTx(token.mint(getAddress(liquidityPool), WITHDRAWAL_AMOUNT));
      await proveTx(liquidityPool.deposit(WITHDRAWAL_AMOUNT - 1n));

      await expect(
        connect(liquidityPool, admin).withdrawToWorkingTreasury(workingTreasuries[0].address, WITHDRAWAL_AMOUNT),
      ).to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_BALANCE_INSUFFICIENT);
    });
  });

  describe("Function 'withdrawToReserve()'", async () => {
    it("Executes as expected", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const withdrawalAmount = (WITHDRAWAL_AMOUNT);
      await proveTx(liquidityPool.deposit(withdrawalAmount * 2n));
      const balancesBefore = await liquidityPool.getBalances();

      const tx = connect(liquidityPool, admin).withdrawToReserve(withdrawalAmount);
      await expect(tx).to.changeTokenBalances(
        token,
        [liquidityPool, owner, admin, operationalTreasury],
        [-withdrawalAmount, 0, 0, 0],
      );
      await checkWithdrawalTx(liquidityPool, tx, withdrawalAmount, balancesBefore);
      await expect(tx)
        .to.emit(token, EVENT_NAME_MOCK_BURNING_TO_RESERVE)
        .withArgs(getAddress(liquidityPool), withdrawalAmount);
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
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_AMOUNT_INVALID);
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

      const tx = liquidityPool.rescue(tokenAddress, rescuedAmount);

      await expect(tx).to.changeTokenBalances(
        token,
        [owner.address, getAddress(liquidityPool)],
        [(rescuedAmount), -(rescuedAmount)],
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
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_AMOUNT_INVALID);
    });

    it("Is reverted if the caller does not have the owner role", async () => {
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

  describe("Function 'correctBorrowableBalance()'", async () => {
    it("Executes as expected with a positive adjustment", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      await proveTx(liquidityPool.deposit(DEPOSIT_AMOUNT));

      const adjustmentAmount = DEPOSIT_AMOUNT / 10n;

      await proveTx(liquidityPool.correctBorrowableBalance(adjustmentAmount));

      const balancesAfter = await liquidityPool.getBalances();
      expect(balancesAfter[0]).to.eq(DEPOSIT_AMOUNT + adjustmentAmount);
      expect(balancesAfter[1]).to.eq(0n);
    });

    it("Executes as expected with a negative adjustment", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      await proveTx(liquidityPool.deposit(DEPOSIT_AMOUNT));

      const adjustmentAmount = -DEPOSIT_AMOUNT / 10n;

      await proveTx(liquidityPool.correctBorrowableBalance(adjustmentAmount));

      const balancesAfter = await liquidityPool.getBalances();
      expect(balancesAfter[0]).to.eq(DEPOSIT_AMOUNT + adjustmentAmount);
      expect(balancesAfter[1]).to.eq(0n);
    });

    it("Executes as expected with zero adjustment", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      await proveTx(liquidityPool.deposit(DEPOSIT_AMOUNT));

      await proveTx(liquidityPool.correctBorrowableBalance(0));

      const balancesAfter = await liquidityPool.getBalances();
      expect(balancesAfter[0]).to.eq(DEPOSIT_AMOUNT);
      expect(balancesAfter[1]).to.eq(0n);
    });

    it("Executes as expected when adjusting to exactly zero balance", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      await proveTx(liquidityPool.deposit(DEPOSIT_AMOUNT));

      await proveTx(liquidityPool.correctBorrowableBalance(-DEPOSIT_AMOUNT));

      const balancesAfter = await liquidityPool.getBalances();
      expect(balancesAfter[0]).to.eq(0n);
      expect(balancesAfter[1]).to.eq(0n);
    });

    it("Executes as expected when adjusting to maximum uint64 value", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      await proveTx(liquidityPool.deposit(DEPOSIT_AMOUNT));

      const adjustmentAmount = maxUintForBits(64) - DEPOSIT_AMOUNT;

      await proveTx(liquidityPool.correctBorrowableBalance(adjustmentAmount));

      const balancesAfter = await liquidityPool.getBalances();
      expect(balancesAfter[0]).to.eq(maxUintForBits(64));
      expect(balancesAfter[1]).to.eq(0n);
    });

    it("Handles multiple consecutive adjustments correctly", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      await proveTx(liquidityPool.deposit(DEPOSIT_AMOUNT));

      // Apply multiple adjustments
      const adjustments = [
        DEPOSIT_AMOUNT / 100n,
        DEPOSIT_AMOUNT / 10n,
        -DEPOSIT_AMOUNT / 20n,
        -DEPOSIT_AMOUNT / 50n,
      ];

      for (const adjustment of adjustments) {
        await proveTx(liquidityPool.correctBorrowableBalance(adjustment));
      }

      const finalBalances = await liquidityPool.getBalances();
      const expectedBalance = DEPOSIT_AMOUNT + adjustments.reduce((acc, val) => acc + val, 0n);

      expect(finalBalances[0]).to.eq(expectedBalance);
      expect(finalBalances[1]).to.eq(0n);
    });

    it("Is reverted if the caller does not have the OWNER role", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const adjustmentAmount = 100n;

      await expect(connect(liquidityPool, admin).correctBorrowableBalance(adjustmentAmount))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(admin.address, OWNER_ROLE);

      await expect(connect(liquidityPool, liquidityOperator).correctBorrowableBalance(adjustmentAmount))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(liquidityOperator.address, OWNER_ROLE);

      await expect(connect(liquidityPool, attacker).correctBorrowableBalance(adjustmentAmount))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(attacker.address, OWNER_ROLE);
    });

    it("Is reverted if the positive adjustment amount exceeds 64-bit unsigned integer", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const adjustmentAmount = maxUintForBits(64) + 1n;

      await expect(liquidityPool.correctBorrowableBalance(adjustmentAmount))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_BALANCE_EXCESS);
    });

    it("Is reverted if the adjustment would cause the balance to exceed 64-bit unsigned integer", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      await proveTx(liquidityPool.deposit(DEPOSIT_AMOUNT));

      const adjustmentAmount = maxUintForBits(64) - DEPOSIT_AMOUNT + 1n;

      await expect(liquidityPool.correctBorrowableBalance(adjustmentAmount))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_BALANCE_EXCESS);
    });

    it("Is reverted if the negative adjustment would result in negative balance", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      await proveTx(liquidityPool.deposit(DEPOSIT_AMOUNT));

      const adjustmentAmount = -DEPOSIT_AMOUNT - 1n;

      await expect(liquidityPool.correctBorrowableBalance(adjustmentAmount))
        .to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_BALANCE_INSUFFICIENT);
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
        connect(liquidityPool, liquidityOperator).onBeforeLiquidityIn(REPAYMENT_AMOUNT),
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
        connect(liquidityPool, liquidityOperator).onBeforeLiquidityOut(REPAYMENT_AMOUNT),
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
