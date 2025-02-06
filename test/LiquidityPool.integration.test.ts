const hre = require("hardhat");
const { ethers } = hre;
const { upgrades } = hre;
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { checkEquality, maxUintForBits, setUpFixture } from "../test-utils/common";
import { checkContractUupsUpgrading, connect, getAddress, proveTx } from "../test-utils/eth";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAX_ALLOWANCE = ethers.MaxUint256;
const MINT_AMOUNT = 1000_000_000_000n;
const DEPOSIT_AMOUNT = MINT_AMOUNT / 10n;
const BORROWED_AMOUNT = DEPOSIT_AMOUNT / 10n;
const ADDON_AMOUNT = BORROWED_AMOUNT / 10n;
const REPAYMENT_AMOUNT = BORROWED_AMOUNT / 5n;

const ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED = "AccessControlUnauthorizedAccount";
const ERROR_NAME_INSUFFICIENT_BALANCE = "InsufficientBalance";
const ERROR_NAME_INVALID_AMOUNT = "InvalidAmount";
const ERROR_NAME_UNAUTHORIZED = "Unauthorized";

const EVENT_NAME_DEPOSIT = "Deposit";
const EVENT_NAME_WITHDRAWAL = "Withdrawal";

describe("LiquidityPool Integration Tests", async () => {
  let liquidityPoolFactory: ContractFactory;
  let tokenFactory: ContractFactory;
  let marketFactory: ContractFactory;

  let market: Contract;
  let token: Contract;

  let deployer: HardhatEthersSigner;
  let lender: HardhatEthersSigner;
  let attacker: HardhatEthersSigner;
  let addonTreasury: HardhatEthersSigner;

  let tokenAddress: string;
  let marketAddress: string;

  before(async () => {
    [deployer, lender, attacker, addonTreasury] = await ethers.getSigners();

    liquidityPoolFactory = await ethers.getContractFactory("LiquidityPoolTestable");
    liquidityPoolFactory = liquidityPoolFactory.connect(deployer);
    tokenFactory = await ethers.getContractFactory("ERC20Mock");
    tokenFactory = tokenFactory.connect(deployer);
    marketFactory = await ethers.getContractFactory("LendingMarketMock");
    marketFactory = marketFactory.connect(deployer);

    market = await marketFactory.deploy() as Contract;
    await market.waitForDeployment();
    market = connect(market, deployer);
    marketAddress = getAddress(market);

    token = await tokenFactory.deploy() as Contract;
    await token.waitForDeployment();
    token = connect(token, deployer);
    tokenAddress = getAddress(token);
    await token.mint(lender.address, MINT_AMOUNT);
    await token.mint(addonTreasury.address, MINT_AMOUNT);
  });

  async function deployLiquidityPool(): Promise<{ liquidityPool: Contract }> {
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
    liquidityPool = connect(liquidityPool, lender);

    await proveTx(connect(token, lender).approve(getAddress(liquidityPool), MAX_ALLOWANCE));
    await proveTx(connect(token, addonTreasury).approve(getAddress(market), MAX_ALLOWANCE));
    return { liquidityPool };
  }

  async function deployAndConfigureLiquidityPool(): Promise<{ liquidityPool: Contract }> {
    const { liquidityPool } = await deployLiquidityPool();
    await proveTx(liquidityPool.grantRole(ethers.id("PAUSER_ROLE"), lender.address));
    return { liquidityPool };
  }

  async function prepareLoan(
    liquidityPool: Contract,
    props: {
      loanId: bigint;
      borrowedAmount: bigint;
      addonAmount: bigint;
      repaidAmount?: bigint;
    }
  ) {
    const loanState = {
      programId: 0n,
      borrowedAmount: props.borrowedAmount,
      addonAmount: props.addonAmount,
      startTimestamp: 0n,
      durationInPeriods: 0n,
      token: ZERO_ADDRESS,
      borrower: ZERO_ADDRESS,
      interestRatePrimary: 0n,
      interestRateSecondary: 0n,
      repaidAmount: props.repaidAmount || 0n,
      trackedBalance: 0n,
      trackedTimestamp: 0n,
      freezeTimestamp: 0n,
      firstInstallmentId: 0n,
      installmentCount: 0n,
      lateFeeAmount: 0n,
      discountAmount: 0n
    };
    await proveTx(market.mockLoanState(props.loanId, loanState));
  }

  describe("Multiple Concurrent Loans", () => {
    it("should handle multiple concurrent loans correctly", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const LOAN_IDS = [1n, 2n, 3n];
      const LOAN_AMOUNTS = [1000n, 2000n, 3000n];
      const totalBorrowedAmount = LOAN_AMOUNTS.reduce((a, b) => a + b, 0n);
      
      await proveTx(liquidityPool.deposit(totalBorrowedAmount * 2n));
      
      for (let i = 0; i < LOAN_IDS.length; i++) {
        await prepareLoan(liquidityPool, {
          loanId: LOAN_IDS[i],
          borrowedAmount: LOAN_AMOUNTS[i],
          addonAmount: 0n
        });
        await proveTx(market.callOnBeforeLoanTakenLiquidityPool(getAddress(liquidityPool), LOAN_IDS[i]));
      }

      const [borrowableBalance] = await liquidityPool.getBalances();
      expect(borrowableBalance).to.eq(totalBorrowedAmount);
    });

    it("should handle concurrent loans with partial repayments", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const LOAN_IDS = [1n, 2n];
      const LOAN_AMOUNTS = [1000n, 2000n];
      const totalBorrowedAmount = LOAN_AMOUNTS.reduce((a, b) => a + b, 0n);
      
      await proveTx(liquidityPool.deposit(totalBorrowedAmount * 2n));
      
      // Setup initial loans
      for (let i = 0; i < LOAN_IDS.length; i++) {
        await prepareLoan(liquidityPool, {
          loanId: LOAN_IDS[i],
          borrowedAmount: LOAN_AMOUNTS[i],
          addonAmount: 0n
        });
        await proveTx(market.callOnBeforeLoanTakenLiquidityPool(getAddress(liquidityPool), LOAN_IDS[i]));
      }

      // Make partial repayments
      const repaymentAmounts = LOAN_AMOUNTS.map(amount => amount / 2n);
      for (let i = 0; i < LOAN_IDS.length; i++) {
        await proveTx(market.callOnAfterLoanPaymentLiquidityPool(
          getAddress(liquidityPool),
          LOAN_IDS[i],
          repaymentAmounts[i]
        ));
      }

      const [borrowableBalance] = await liquidityPool.getBalances();
      const expectedBalance = totalBorrowedAmount + repaymentAmounts.reduce((a, b) => a + b, 0n);
      expect(borrowableBalance).to.eq(expectedBalance);
    });

    it("should handle concurrent loans with revocations", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const LOAN_IDS = [1n, 2n, 3n];
      const LOAN_AMOUNTS = [1000n, 2000n, 3000n];
      const totalBorrowedAmount = LOAN_AMOUNTS.reduce((a, b) => a + b, 0n);
      
      await proveTx(liquidityPool.deposit(totalBorrowedAmount * 2n));
      
      // Setup initial loans
      for (let i = 0; i < LOAN_IDS.length; i++) {
        await prepareLoan(liquidityPool, {
          loanId: LOAN_IDS[i],
          borrowedAmount: LOAN_AMOUNTS[i],
          addonAmount: 0n
        });
        await proveTx(market.callOnBeforeLoanTakenLiquidityPool(getAddress(liquidityPool), LOAN_IDS[i]));
      }

      // Revoke loans in different states
      await proveTx(market.callOnAfterLoanRevocationLiquidityPool(getAddress(liquidityPool), LOAN_IDS[0]));
      
      await proveTx(market.callOnAfterLoanPaymentLiquidityPool(
        getAddress(liquidityPool),
        LOAN_IDS[1],
        LOAN_AMOUNTS[1] / 2n
      ));
      await proveTx(market.callOnAfterLoanRevocationLiquidityPool(getAddress(liquidityPool), LOAN_IDS[1]));

      const [borrowableBalance] = await liquidityPool.getBalances();
      // After revocations:
      // Initial balance: totalBorrowedAmount * 2n = 12000n
      // Loan 0 revoked: -1000n
      // Loan 1 partial repayment: +1000n
      // Loan 1 revoked: -1000n
      // Loan 2 still active: -3000n
      expect(borrowableBalance).to.eq(10000n);
    });

    it("should revert when total borrowed amount exceeds pool balance", async () => {
      const { liquidityPool } = await setUpFixture(deployAndConfigureLiquidityPool);
      const LOAN_IDS = [1n, 2n];
      const LOAN_AMOUNTS = [DEPOSIT_AMOUNT, DEPOSIT_AMOUNT];
      
      await proveTx(liquidityPool.deposit(DEPOSIT_AMOUNT));
      
      await prepareLoan(liquidityPool, {
        loanId: LOAN_IDS[0],
        borrowedAmount: LOAN_AMOUNTS[0],
        addonAmount: 0n
      });

      // First loan should succeed
      await proveTx(market.callOnBeforeLoanTakenLiquidityPool(getAddress(liquidityPool), LOAN_IDS[0]));
      
      // Second loan should fail due to insufficient balance
      await prepareLoan(liquidityPool, {
        loanId: LOAN_IDS[1],
        borrowedAmount: LOAN_AMOUNTS[1],
        addonAmount: 0n
      });
      
      await expect(
        market.callOnBeforeLoanTakenLiquidityPool(getAddress(liquidityPool), LOAN_IDS[1])
      ).to.be.revertedWithCustomError(liquidityPool, ERROR_NAME_INSUFFICIENT_BALANCE);
    });
  });
});
