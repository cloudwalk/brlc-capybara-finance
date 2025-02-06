const hre = require("hardhat");
const { ethers, upgrades } = hre;
import { expect } from "chai";
import type { Contract, ContractFactory } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { ERC20Mock } from "../typechain-types/contracts/mocks/ERC20Mock";
import type { LiquidityPoolTestable } from "../typechain-types/contracts/testables/LiquidityPoolTestable";
import type { LendingMarketMock } from "../typechain-types/contracts/mocks/LendingMarketMock";
import { checkEquality, maxUintForBits, setUpFixture } from "../test-utils/common";
import { checkContractUupsUpgrading, connect, getAddress, proveTx } from "../test-utils/eth";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAX_ALLOWANCE = ethers.MaxUint256;
const MINT_AMOUNT = 1000_000_000_000n;
const DEPOSIT_AMOUNT = MINT_AMOUNT / 10n;

describe("LiquidityPool Gas Optimization Tests", async () => {
    let liquidityPoolFactory: ContractFactory;
    let tokenFactory: ContractFactory;
    let marketFactory: ContractFactory;

    let market: LendingMarketMock;
    let token: ERC20Mock;

    let deployer: HardhatEthersSigner;
    let lender: HardhatEthersSigner;
    let borrower: HardhatEthersSigner;

    let tokenAddress: string;
    let marketAddress: string;

    before(async () => {
        [deployer, lender, borrower] = await ethers.getSigners();

        liquidityPoolFactory = await ethers.getContractFactory("LiquidityPoolTestable");
        liquidityPoolFactory = liquidityPoolFactory.connect(deployer);
        tokenFactory = await ethers.getContractFactory("ERC20Mock");
        tokenFactory = tokenFactory.connect(deployer);
        marketFactory = await ethers.getContractFactory("LendingMarketMock");
        marketFactory = marketFactory.connect(deployer);

        market = (await marketFactory.deploy()) as unknown as LendingMarketMock;
        await market.waitForDeployment();
        market = connect(market, deployer) as unknown as LendingMarketMock;
        marketAddress = getAddress(market as Contract);

        token = (await tokenFactory.deploy()) as unknown as ERC20Mock;
        await token.waitForDeployment();
        token = connect(token, deployer) as unknown as ERC20Mock;
        tokenAddress = getAddress(token as Contract);
        await token.mint(lender.address, MINT_AMOUNT);
        await token.mint(borrower.address, MINT_AMOUNT);
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

    describe("Gas Usage for Bulk Operations", () => {
        it("should maintain reasonable gas usage for multiple deposits", async () => {
            const { liquidityPool } = await setUpFixture(deployLiquidityPool);
            const depositAmount = 1000n;
            const numDeposits = 5;

            // First deposit as baseline
            const tx1 = await liquidityPool.deposit(depositAmount);
            const receipt1 = await tx1.wait();
            const gasUsed1 = receipt1?.gasUsed || 0n;

            // Multiple deposits
            for (let i = 0; i < numDeposits; i++) {
                const tx = await liquidityPool.deposit(depositAmount);
                const receipt = await tx.wait();
                const gasUsed = receipt?.gasUsed || 0n;

                // Gas usage should not increase significantly
                const maxGas = (gasUsed1 * 120n) / 100n; // Allow 20% variance
                expect(gasUsed).to.be.lte(maxGas);
            }
        });

        it("should maintain reasonable gas usage for multiple loan operations", async () => {
            const { liquidityPool } = await setUpFixture(deployLiquidityPool);
            const LOAN_IDS = [1n, 2n, 3n];
            const LOAN_AMOUNTS = [1000n, 2000n, 3000n];
            
            await proveTx(liquidityPool.deposit(MINT_AMOUNT / 2n));

            // First loan operation as baseline
            const loanState = {
                programId: 0n,
                borrowedAmount: LOAN_AMOUNTS[0],
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

            await proveTx(market.mockLoanState(LOAN_IDS[0], loanState));
            const tx1 = await market.callOnBeforeLoanTakenLiquidityPool(getAddress(liquidityPool as unknown as Contract), LOAN_IDS[0]);
            const receipt1 = await tx1.wait();
            const gasUsed1 = receipt1?.gasUsed || 0n;

            // Multiple loan operations
            for (let i = 1; i < LOAN_IDS.length; i++) {
                loanState.borrowedAmount = LOAN_AMOUNTS[i];
                await proveTx(market.mockLoanState(LOAN_IDS[i], loanState));
                const tx = await market.callOnBeforeLoanTakenLiquidityPool(getAddress(liquidityPool as unknown as Contract), LOAN_IDS[i]);
                const receipt = await tx.wait();
                const gasUsed = receipt?.gasUsed || 0n;

                // Gas usage should not increase significantly
                const maxGas = (gasUsed1 * 120n) / 100n; // Allow 20% variance
                expect(gasUsed).to.be.lte(maxGas);
            }
        });
    });
});
