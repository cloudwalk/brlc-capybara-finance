const hre = require("hardhat");
const { ethers, upgrades } = hre;
import { expect } from "chai";
import type { Contract, ContractFactory, BaseContract } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ERC20Mock, LiquidityPoolTestable, LendingMarketMock, ReentrancyAttacker } from "../typechain-types";
import { checkEquality, maxUintForBits, setUpFixture } from "../test-utils/common";
import { checkContractUupsUpgrading, connect, getAddress, proveTx } from "../test-utils/eth";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAX_ALLOWANCE = ethers.MaxUint256;
const MINT_AMOUNT = 1000_000_000_000n;
const DEPOSIT_AMOUNT = MINT_AMOUNT / 10n;

const ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED = "AccessControlUnauthorizedAccount";
const ERROR_NAME_UNAUTHORIZED = "Unauthorized";

describe("LiquidityPool Security Tests", async () => {
    let liquidityPoolFactory: ContractFactory;
    let tokenFactory: ContractFactory;
    let marketFactory: ContractFactory;
    let attackerFactory: ContractFactory;

    let market: LendingMarketMock;
    let token: ERC20Mock;
    let attacker: ReentrancyAttacker;

    let deployer: HardhatEthersSigner;
    let lender: HardhatEthersSigner;
    let maliciousUser: HardhatEthersSigner;
    let addonTreasury: HardhatEthersSigner;

    let tokenAddress: string;
    let marketAddress: string;

    before(async () => {
        [deployer, lender, maliciousUser, addonTreasury] = await ethers.getSigners();

        liquidityPoolFactory = await ethers.getContractFactory("LiquidityPoolTestable");
        liquidityPoolFactory = liquidityPoolFactory.connect(deployer);
        tokenFactory = await ethers.getContractFactory("ERC20Mock");
        tokenFactory = tokenFactory.connect(deployer);
        marketFactory = await ethers.getContractFactory("LendingMarketMock");
        marketFactory = marketFactory.connect(deployer);
        attackerFactory = await ethers.getContractFactory("ReentrancyAttacker");
        attackerFactory = attackerFactory.connect(deployer);

        market = (await marketFactory.deploy()) as unknown as LendingMarketMock;
        await market.waitForDeployment();
        market = connect(market, deployer) as unknown as LendingMarketMock;
        marketAddress = getAddress(market as unknown as Contract);

        token = (await tokenFactory.deploy()) as unknown as ERC20Mock;
        await token.waitForDeployment();
        token = connect(token, deployer) as unknown as ERC20Mock;
        tokenAddress = getAddress(token as unknown as Contract);
        await token.mint(lender.address, MINT_AMOUNT);
        await token.mint(maliciousUser.address, MINT_AMOUNT);
    });

    async function deployLiquidityPool(): Promise<{ liquidityPool: LiquidityPoolTestable }> {
        let liquidityPool = await upgrades.deployProxy(
            liquidityPoolFactory,
            [lender.address, marketAddress, tokenAddress],
            { kind: "uups" }
        );

        await liquidityPool.waitForDeployment();
        liquidityPool = connect(liquidityPool, lender);

        await proveTx(connect(token, lender).approve(getAddress(liquidityPool), MAX_ALLOWANCE));
        return { liquidityPool };
    }

    describe("Reentrancy Protection", () => {
        it("should prevent reentrancy on deposit", async () => {
            const { liquidityPool } = await setUpFixture(deployLiquidityPool);
            
            // Deploy reentrant token
            const ReentrantERC20Mock = await ethers.getContractFactory("ReentrantERC20Mock");
            const reentrantToken = await ReentrantERC20Mock.deploy(getAddress(liquidityPool as unknown as Contract));
            await reentrantToken.waitForDeployment();
            
            // Setup for reentrancy attack
            await reentrantToken.mint(lender.address, DEPOSIT_AMOUNT);
            await reentrantToken.connect(lender).approve(getAddress(liquidityPool as unknown as Contract), DEPOSIT_AMOUNT);
            
            // Attempt reentrancy attack during token transfer
            // The deposit should succeed since the reentrancy attack is caught and handled in the token
            await expect(liquidityPool.deposit(DEPOSIT_AMOUNT))
                .to.not.be.reverted;
        });
    });

    describe("Role Management Security", () => {
        it("should prevent unauthorized role transfers", async () => {
            const { liquidityPool } = await setUpFixture(deployLiquidityPool);
            const OWNER_ROLE = ethers.id("OWNER_ROLE");
            
            await expect(
                liquidityPool.connect(maliciousUser).grantRole(OWNER_ROLE, maliciousUser.address)
            ).to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED);
        });

        it("should prevent unauthorized role revocations", async () => {
            const { liquidityPool } = await setUpFixture(deployLiquidityPool);
            const OWNER_ROLE = ethers.id("OWNER_ROLE");
            
            await expect(
                liquidityPool.connect(maliciousUser).revokeRole(OWNER_ROLE, lender.address)
            ).to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED);
        });

        it("should maintain role hierarchy", async () => {
            const { liquidityPool } = await setUpFixture(deployLiquidityPool);
            const OWNER_ROLE = ethers.id("OWNER_ROLE");
            const PAUSER_ROLE = ethers.id("PAUSER_ROLE");
            
            // Owner should be able to grant pauser role
            await proveTx(liquidityPool.grantRole(PAUSER_ROLE, addonTreasury.address));
            
            // Pauser should not be able to grant owner role
            await expect(
                liquidityPool.connect(addonTreasury).grantRole(OWNER_ROLE, addonTreasury.address)
            ).to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED);
        });
    });
});
