const hre = require("hardhat");
const { ethers, upgrades } = hre;
import { expect } from "chai";
import type { Contract, ContractFactory, BaseContract } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { FailingERC20Mock } from "../typechain-types/contracts/mocks/FailingERC20Mock";
import type { LiquidityPoolTestable } from "../typechain-types/contracts/testables/LiquidityPoolTestable";
import type { LendingMarketMock } from "../typechain-types/contracts/mocks/LendingMarketMock";
import { checkEquality, maxUintForBits, setUpFixture } from "../test-utils/common";
import { checkContractUupsUpgrading, connect, getAddress, proveTx } from "../test-utils/eth";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAX_ALLOWANCE = ethers.MaxUint256;
const MINT_AMOUNT = 1000_000_000_000n;
const DEPOSIT_AMOUNT = MINT_AMOUNT / 10n;

const ERROR_NAME_INVALID_AMOUNT = "InvalidAmount";

describe("LiquidityPool Error Recovery Tests", async () => {
    let liquidityPoolFactory: ContractFactory;
    let tokenFactory: ContractFactory;
    let marketFactory: ContractFactory;

    let market: LendingMarketMock;
    let token: FailingERC20Mock;

    let deployer: HardhatEthersSigner;
    let lender: HardhatEthersSigner;
    let borrower: HardhatEthersSigner;

    let tokenAddress: string;
    let marketAddress: string;

    before(async () => {
        [deployer, lender, borrower] = await ethers.getSigners();

        liquidityPoolFactory = await ethers.getContractFactory("LiquidityPoolTestable");
        liquidityPoolFactory = liquidityPoolFactory.connect(deployer);
        tokenFactory = await ethers.getContractFactory("FailingERC20Mock");
        tokenFactory = tokenFactory.connect(deployer);
        marketFactory = await ethers.getContractFactory("LendingMarketMock");
        marketFactory = marketFactory.connect(deployer);

        market = (await marketFactory.deploy()) as unknown as LendingMarketMock;
        await market.waitForDeployment();
        market = connect(market, deployer) as unknown as LendingMarketMock;
        marketAddress = getAddress(market as Contract);

        token = (await tokenFactory.deploy()) as unknown as FailingERC20Mock;
        await token.waitForDeployment();
        token = connect(token, deployer) as unknown as FailingERC20Mock;
        tokenAddress = getAddress(token as Contract);
        await token.mint(lender.address, MINT_AMOUNT);
        await token.mint(borrower.address, MINT_AMOUNT);
    });

    async function deployLiquidityPool(): Promise<{ liquidityPool: LiquidityPoolTestable }> {
        let liquidityPool = await upgrades.deployProxy(
            liquidityPoolFactory,
            [
                lender.address,
                marketAddress,
                tokenAddress
            ],
            { kind: "uups" }
        );

        await liquidityPool.waitForDeployment();
        liquidityPool = connect(liquidityPool, lender) as unknown as LiquidityPoolTestable;

        await proveTx(connect(token, lender).approve(getAddress(liquidityPool), MAX_ALLOWANCE));
        return { liquidityPool };
    }

    describe("Failed Token Transfer Recovery", () => {
        it("should handle failed token transfers gracefully", async () => {
            const { liquidityPool } = await setUpFixture(deployLiquidityPool);
            
            // Set token to fail transfers
            await token.setShouldFailTransfers(true);
            
            // Attempt deposit with failing transfers
            await token.setShouldFailTransferFroms(true);
            await expect(
                liquidityPool.deposit(DEPOSIT_AMOUNT)
            ).to.be.revertedWith("ERC20: transfer failed");
            
            // Verify state remains unchanged
            const [borrowableBalance] = await liquidityPool.getBalances();
            expect(borrowableBalance).to.eq(0n);
        });

        it("should handle failed transferFrom gracefully", async () => {
            const { liquidityPool } = await setUpFixture(deployLiquidityPool);
            
            // Set token to fail transferFroms
            await token.setShouldFailTransferFroms(true);
            
            // Attempt deposit with failing transferFroms
            await expect(
                liquidityPool.deposit(DEPOSIT_AMOUNT)
            ).to.be.revertedWith("ERC20: transfer failed");
            
            // Verify state remains unchanged
            const [borrowableBalance] = await liquidityPool.getBalances();
            expect(borrowableBalance).to.eq(0n);
        });
    });

    describe("State Consistency After Failures", () => {
        it("should maintain consistent state after failed operations", async () => {
            const { liquidityPool } = await setUpFixture(deployLiquidityPool);
            
            // First deposit succeeds
            await proveTx(liquidityPool.deposit(DEPOSIT_AMOUNT));
            
            // Second deposit fails
            await token.setShouldFailTransferFroms(true);
            await expect(
                liquidityPool.deposit(DEPOSIT_AMOUNT)
            ).to.be.revertedWith("ERC20: transfer failed");
            
            // Verify state reflects only the successful deposit
            const [borrowableBalance] = await liquidityPool.getBalances();
            expect(borrowableBalance).to.eq(DEPOSIT_AMOUNT);
        });

        it("should maintain allowances after failed operations", async () => {
            const { liquidityPool } = await setUpFixture(deployLiquidityPool);
            
            // Set initial allowance
            await proveTx(connect(token, lender).approve(getAddress(liquidityPool as unknown as Contract), DEPOSIT_AMOUNT));
            
            // Make transfer fail
            await token.setShouldFailTransferFroms(true);
            await expect(
                liquidityPool.deposit(DEPOSIT_AMOUNT)
            ).to.be.revertedWith("ERC20: transfer failed");
            
            // Verify allowance remains unchanged
            const allowance = await token.allowance(lender.address, getAddress(liquidityPool as unknown as Contract));
            expect(allowance).to.eq(DEPOSIT_AMOUNT);
        });
    });
});
