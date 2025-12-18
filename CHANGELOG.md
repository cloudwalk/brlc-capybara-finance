# v1.23.0

## Main changes

1. The liquidity pool now uses the actual ERC20 token balance directly instead of maintaining separate internal accounting for borrowable balance. This simplifies the contract logic and eliminates potential discrepancies between internal accounting and actual token holdings.

2. The `_borrowableBalance` storage variable has been deprecated and is no longer used. The variable remains in storage for upgrade compatibility but is marked as deprecated in the code documentation. Previously, this variable tracked available liquidity separately from the actual token balance. Now the contract uses `IERC20(_token).balanceOf(address(this))` directly.

3. The internal accounting operations in deposit and withdrawal functions have been removed:
   * a. `onBeforeLiquidityIn()` no longer increments `_borrowableBalance`.
   * b. `onBeforeLiquidityOut()` no longer decrements `_borrowableBalance`.
   * c. All deposit functions (`deposit()`, `depositFromOperationalTreasury()`, `depositFromWorkingTreasury()`, `depositFromReserve()`) no longer update internal accounting.
   * d. All withdrawal functions (`withdraw()`, `withdrawToOperationalTreasury()`, `withdrawToWorkingTreasury()`, `withdrawToReserve()`) now check against actual token balance instead of internal accounting.

4. The `getBalances()` function has been updated to return the actual token balance and `0` for the addons balance (second return value).

5. The `SafeCast` library import and usage have been removed since the contract no longer needs to downcast amounts to `uint64` for internal accounting.

6. The 64-bit (`uint64`) limitation on deposit and withdrawal amounts has been removed. The contract now supports amounts up to `uint256` maximum, limited only by the underlying token's total supply.

7. The operational treasury allowance check has been removed:
   * a. The `setOperationalTreasury()` function no longer verifies that the operational treasury has approved the pool to transfer tokens.
   * b. The `LiquidityPool_OperationalTreasuryZeroAllowanceForPool` error has been removed from the interface.

8. This change improves the security model by using a single source of truth (the actual token balance) and eliminates the risk of internal accounting becoming out of sync with actual holdings.

## Migration

No special actions are required, just upgrade the deployed `LiquidityPool` smart-contracts. The deprecated `_borrowableBalance` storage variable will retain its last value but will no longer be used. All balance queries will automatically use the actual token balance after the upgrade.

# v1.22.0

## Main changes

1. The previous penalized balance logic has been replaced with the penalty interest rate one.
   Now starting an installment loan of several sub-loans, you can provide the `penaltyInterestRate` values for each sub-loan. 
   The provided penalty rates will be used to override the `trackedBalance` field when a sub-loan is overdue,
   according to the formula: `trackedBalance = principal * (1 + penaltyInterestRate) ^ durationInPeriods - repaidAmount - discountAmount`, where `principal = borrowedAmount + addonAmount`.
   The overriding of `trackedBalance` is being happened before calculating the late fee and before applying 
   the secondary rate for days after the due one. If `penaltyInterestRate=0` for a sub-loan the new logic is not used.

2. The following code entities related to the previous penalized balance logic have been removed:
    * a. The `penalizedBalance` filed at the end of the `Loan.State` structure. The field is effectively replaced by the `penaltyInterestRate` one.
    * b. The `penalizedBalance` filed at the end of the `Loan.PreviewExtended` structure. The field is effectively replaced by the `penaltyInterestRate` one.
    * c. The `takeInstallmentLoan()` function with the `penalizedBalance` values.
    * d. The `updateLoanPenalizedBalance()` function.
    * e. The `LoanPenalizedBalanceUpdated` event.

3. The new `penaltyInterestRate` filed has been added at the end of the `Loan.State` structure.

4. The new `penaltyInterestRate` field has been added at the end of the `Loan.PreviewExtended` structure.

5. The new `penaltyBalance` field has been added at the end of the `Loan.PreviewExtended` structure.
   The new field is determined during the call of the appropriate view functions as follows:
    * if the `penaltyInterestRate` field is zero then the `penaltyBalance` field is zero as well;
    * if the `trackedBalance` field is zero then the `penaltyBalance` field is zero as well;
    * if the loan is overdue then `penaltyBalance` field equals to the `trackedBalance` field;
    * otherwise, the `penaltyBalance` field is calculated using the formula: `penaltyBalance = principal * (1 + penaltyInterestRate) ^ periodsSinceStart - repaidAmount - discountAmount`, where `principal = borrowedAmount + addonAmount` and `periodsSinceStart` is the integer number of periods passed from the loan start timestamp to the preview timestamp.

6. The new `takeInstallmentLoan()` function has been introduced to take installment loans with the `penaltyInterestRate` values.
   It is expected that the new function will be used in all cases.
   The existing `takeInstallmentLoanFor()` function will be removed in the future.

7. The new `updateLoanPenaltyInterestRate()` function has been added to update the `penaltyInterestRate`  value of a sub-loan.

8. The new `LoanPenaltyInterestRateUpdated` event has been added. It is emitted in the following cases:
    * a. When a loan is taken with a non-zero `penaltyInterestRate` value.
    * b. When the `penaltyInterestRate` value of an ongoing sub-loan is changed by the `updateLoanPenaltyInterestRate()` function.

9. Additional checks have been added to ensure that the penalty interest rate is not lower than the primary interest rate. 
   Without these checks, the new tracked balance of an overdue loan may become negative. An example:
    * `principal = 100`;
    * `interestRatePrimary = 2%`;
    * `penaltyInterestRate = 1%`;
    * `durationInPeriods = 10`;
    * at the due date: `trackedBalance = 100 * (1 + 2%) ^ 10 = 122`;
    * at the due date: `repaidAmount = 120`;
    * after the balance replacement at the due date: `trackedBalance = 100 * (1 + 1%) ^ 10 - 120 = 110 - 120 = -10`.

10. Additional checks have been added to ensure that the duration of loans with a non-zero penalty interest rate cannot be changed directly or indirectly (through freezing and unfreezing) until the loan is overdue.
    Because the new duration affects the application of the penalty interest rate for the loan.
    Those checks can be overcome in emergency cases like:
    * first set the penalty interest rate of the loan to zero,
    * then execute the protected operation (e.g. update the duration or freeze the loan),
    * then set the penalty interest rate back to the original value or a corrected one.

11. Note. There is another possible formula for the tracked balance overriding: `trackedBalance = (principal - repaidAmount - discountAmount) * (1 + penaltyInterestRate) ^ durationInPeriods`.
    But it creates an exploit opportunity in the case of non-zero primary rate. An example:
    * the borrower repays the principal before the loan is overdue, but not the primary interest rate;
    * the borrower waits until the loan is overdue;
    * the borrower gets the zero tracked balance after the penalty interest rate is applied.

## Migration

No special actions are required, just upgrade the deployed `CapybaraFinance` smart-contracts.

# 1.21.0

## Main changes

1. The penalized balance logic has been introduced to provide loans with grace periods. Now starting an installment loan of several sub-loans, you can provide the `penalizedBalance` values for each sub-loan. The provided values that will be used to override the `trackedBalance` field when a sub-loan is overdue, according to the formula: `trackedBalance = penalizedBalance - repaidAmount - discountAmount`. The replacement of `trackedBalance` is being happened before calculating the late fee and before applying the secondary rate for days after the due one. If `penalizedBalance=0` for a sub-loan the new logic is not used.

2. The new `penalizedBalance` filed has been added at the end of the `Loan.State` structure.

3. The new `penalizedBalance` field has been added at the end of the `Loan.PreviewExtended` structure.

4. The new `takeInstallmentLoan()` function has been introduced to take installment loans with the `penalizedBalance` values. It is expected that the new function will be used in all cases. The existing `takeInstallmentLoanFor()` function will be removed in the future.

5. The new `updateLoanPenalizedBalance()` function has been added to update the `penalizedBalance`  value of a sub-loan.

6. The new `LoanPenalizedBalanceUpdated` event has been added. It is emitted in the following cases:
    * a. When a loan is taken with a non-zero `penalizedBalance` value.
    * b. When the `penalizedBalance` of an ongoing sub-loan is changed by the `updateLoanPenalizedBalance()` function.

## Migration

No special actions are required, just upgrade the deployed `CapybaraFinance` smart-contracts.

# 1.20.0

older changes
