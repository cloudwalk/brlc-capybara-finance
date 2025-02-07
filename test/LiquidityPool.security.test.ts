const hre = require("hardhat");
const { ethers, upgrades } = hre;
import { expect } from "chai";
import type { Contract, ContractFactory } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ERC20Mock, LiquidityPoolTestable, LendingMarketMock, ReentrantERC20Mock } from "../typechain-types";
import { checkEquality, maxUintForBits, setUpFixture } from "../test-utils/common";
import { checkContractUupsUpgrading, connect, getAddress, proveTx } from "../test-utils/eth";

const ZERO_ADDRESS = ethers.ZeroAddress;
const MAX_ALLOWANCE = ethers.MaxUint256;
const MINT_AMOUNT = 1000_000_000_000n;
const DEPOSIT_AMOUNT = MINT_AMOUNT / 10n;

describe("LiquidityPool Security Tests", async () => {
    let liquidityPoolFactory: ContractFactory;
    let tokenFactory: ContractFactory;
    let marketFactory: ContractFactory;

    let market: LendingMarketMock;
    let token: ERC20Mock;

    let deployer: HardhatEthersSigner;
    let lender: HardhatEthersSigner;
    let maliciousUser: HardhatEthersSigner;

    let tokenAddress: string;
    let marketAddress: string;

    before(async () => {
        [deployer, lender, maliciousUser] = await ethers.getSigners();

        liquidityPoolFactory = await ethers.getContractFactory("LiquidityPoolTestable");
        liquidityPoolFactory = liquidityPoolFactory.connect(deployer);
        tokenFactory = await ethers.getContractFactory("ERC20Mock");
        tokenFactory = tokenFactory.connect(deployer);
        marketFactory = await ethers.getContractFactory("LendingMarketMock");
        marketFactory = marketFactory.connect(deployer);

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
        liquidityPool = connect(liquidityPool, lender) as unknown as LiquidityPoolTestable;

        await proveTx(connect(token, lender).approve(getAddress(liquidityPool), MAX_ALLOWANCE));
        return { liquidityPool };
    }

    describe("Reentrancy Protection", () => {
        it("should prevent reentrancy on deposit", async () => {
            const { liquidityPool } = await setUpFixture(deployLiquidityPool);
            
            const ReentrantERC20Mock = await ethers.getContractFactory("ReentrantERC20Mock");
            const reentrantToken = await ReentrantERC20Mock.deploy(getAddress(liquidityPool as unknown as Contract));
            await reentrantToken.waitForDeployment();
            
            await reentrantToken.mint(lender.address, DEPOSIT_AMOUNT);
            await reentrantToken.connect(lender).approve(getAddress(liquidityPool as unknown as Contract), DEPOSIT_AMOUNT);
            
            await expect(liquidityPool.deposit(DEPOSIT_AMOUNT))
                .to.emit(liquidityPool, "Deposit")
                .withArgs(DEPOSIT_AMOUNT);
        });
    });
});
