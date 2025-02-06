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
import { setupComplexLoanScenario, simulatePayments, simulateDefaults, PaymentSchedule, DefaultScenario } from "../test-utils/loan-helpers";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAX_ALLOWANCE = ethers.MaxUint256;
const MINT_AMOUNT = 1000_000_000_000n;
const DEPOSIT_AMOUNT = MINT_AMOUNT / 10n;

describe("LiquidityPool Complex Scenarios", async () => {
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
        marketAddress = getAddress(market as unknown as Contract);

        token = (await tokenFactory.deploy()) as unknown as ERC20Mock;
        await token.waitForDeployment();
        token = connect(token, deployer) as unknown as ERC20Mock;
        tokenAddress = getAddress(token as unknown as Contract);
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

    describe("Complex Loan Scenarios", () => {
        it("should handle multiple loans with different payment schedules", async () => {
            const { liquidityPool } = await setUpFixture(deployLiquidityPool);
            await proveTx(liquidityPool.deposit(99999991000n));

            // Initial balance check
            const [startBalance] = await liquidityPool.getBalances();
            expect(startBalance).to.eq(99999991000n);

            const paymentSchedule: PaymentSchedule[] = [
                { amount: 1000n, delay: 30 * 24 * 60 * 60 }, // 30 days
                { amount: 1000n, delay: 15 * 24 * 60 * 60 }, // 15 days
                { amount: 1000n, delay: 45 * 24 * 60 * 60 } // 45 days
            ];

            const { loanIds } = await setupComplexLoanScenario(
                liquidityPool as unknown as Contract,
                market as unknown as Contract,
                {
                    loanCount: 3,
                    paymentSchedule
                }
            );

            // Initial deposit should be reflected in balance
            const [initialBalance] = await liquidityPool.getBalances();
            expect(initialBalance).to.eq(99999982000n);

            await simulatePayments(
                liquidityPool as unknown as Contract,
                market as unknown as Contract,
                loanIds,
                paymentSchedule
            );

            const [borrowableBalance] = await liquidityPool.getBalances();
            expect(borrowableBalance).to.eq(99999985000n);
        });

        it("should handle loans with defaults", async () => {
            const { liquidityPool } = await setUpFixture(deployLiquidityPool);
            await proveTx(liquidityPool.deposit(99999991000n));

            const defaultScenario: DefaultScenario[] = [
                { loanId: 1n, defaultAfter: 60 * 24 * 60 * 60 }, // 60 days
                { loanId: 2n, defaultAfter: 90 * 24 * 60 * 60 }  // 90 days
            ];

            const { loanIds } = await setupComplexLoanScenario(
                liquidityPool as unknown as Contract,
                market as unknown as Contract,
                {
                    loanCount: 2,
                    defaultScenario
                }
            );

            await simulateDefaults(liquidityPool as unknown as Contract, market as unknown as Contract, defaultScenario);

            const [borrowableBalance] = await liquidityPool.getBalances();
            expect(borrowableBalance).to.eq(99999991000n);
        });

        it("should handle mixed scenario with payments and defaults", async () => {
            const { liquidityPool } = await setUpFixture(deployLiquidityPool);
            await proveTx(liquidityPool.deposit(99999991000n));

            const paymentSchedule: PaymentSchedule[] = [
                { amount: 1000n, delay: 30 * 24 * 60 * 60 }, // 30 days
                { amount: 1000n, delay: 15 * 24 * 60 * 60 }  // 15 days
            ];

            const defaultScenario: DefaultScenario[] = [
                { loanId: 3n, defaultAfter: 60 * 24 * 60 * 60 } // 60 days
            ];

            const { loanIds } = await setupComplexLoanScenario(
                liquidityPool as unknown as Contract,
                market as unknown as Contract,
                {
                    loanCount: 3,
                    paymentSchedule,
                    defaultScenario
                }
            );

            await simulatePayments(
                liquidityPool as unknown as Contract,
                market as unknown as Contract,
                loanIds,
                paymentSchedule
            );
            await simulateDefaults(
                liquidityPool as unknown as Contract,
                market as unknown as Contract,
                defaultScenario
            );

            const [borrowableBalance] = await liquidityPool.getBalances();
            expect(borrowableBalance).to.eq(99999988000n);
        });
    });
});
