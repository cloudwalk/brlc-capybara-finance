import type { Contract } from "ethers";
import { proveTx, getAddress } from "./eth";

export interface PaymentSchedule {
  amount: bigint;
  delay: number; // in seconds
}

export interface DefaultScenario {
  loanId: bigint;
  defaultAfter: number; // in seconds
}

export interface LoanSetupConfig {
  loanCount: number;
  paymentSchedule?: PaymentSchedule[];
  defaultScenario?: DefaultScenario[];
}

export async function setupComplexLoanScenario(
  liquidityPool: Contract,
  market: Contract,
  config: LoanSetupConfig
): Promise<{ loanIds: bigint[] }> {
  const loanIds: bigint[] = [];
  const baseTimestamp = Math.floor(Date.now() / 1000);

  for (let i = 0; i < config.loanCount; i++) {
    const loanId = BigInt(i + 1);
    loanIds.push(loanId);

    const loanState = {
      programId: 0n,
      borrowedAmount: 1000n * (loanId + 1n), // Different amounts for each loan
      addonAmount: 0n,
      startTimestamp: BigInt(baseTimestamp),
      durationInPeriods: 12n, // 12 periods by default
      token: "0x0000000000000000000000000000000000000000",
      borrower: "0x0000000000000000000000000000000000000000",
      interestRatePrimary: 500n, // 5% APR
      interestRateSecondary: 1000n, // 10% APR
      repaidAmount: 0n,
      trackedBalance: 0n,
      trackedTimestamp: 0n,
      freezeTimestamp: 0n,
      firstInstallmentId: 0n,
      installmentCount: 12n,
      lateFeeAmount: 0n,
      discountAmount: 0n
    };

    // Apply payment schedule if provided
    if (config.paymentSchedule && config.paymentSchedule[i]) {
      const schedule = config.paymentSchedule[i];
      loanState.repaidAmount = schedule.amount;
      loanState.trackedTimestamp = BigInt(baseTimestamp + schedule.delay);
    }

    // Apply default scenario if provided
    if (config.defaultScenario && config.defaultScenario[i]) {
      const defaultConfig = config.defaultScenario[i];
      if (defaultConfig.loanId === loanId) {
        loanState.freezeTimestamp = BigInt(baseTimestamp + defaultConfig.defaultAfter);
      }
    }

    await proveTx(market.mockLoanState(loanId, loanState));
    await proveTx(market.callOnBeforeLoanTakenLiquidityPool(getAddress(liquidityPool), loanId));
  }

  return { loanIds };
}

export async function simulatePayments(
  liquidityPool: Contract,
  market: Contract,
  loanIds: bigint[],
  paymentSchedule: PaymentSchedule[]
): Promise<void> {
  for (let i = 0; i < loanIds.length; i++) {
    if (paymentSchedule[i]) {
      await proveTx(market.callOnAfterLoanPaymentLiquidityPool(
        getAddress(liquidityPool),
        loanIds[i],
        paymentSchedule[i].amount
      ));
    }
  }
}

export async function simulateDefaults(
  liquidityPool: Contract,
  market: Contract,
  defaultScenario: DefaultScenario[]
): Promise<void> {
  for (const scenario of defaultScenario) {
    await proveTx(market.callOnAfterLoanRevocationLiquidityPool(
      getAddress(liquidityPool),
      scenario.loanId
    ));
  }
}
