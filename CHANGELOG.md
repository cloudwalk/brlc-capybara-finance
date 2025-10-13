# Current version

## Main changes

1. The penalized balance logic has been introduced to provide loans with grace periods. Now starting an installment loan of several sub-loans you can provide the `penalizedBalance` values for each sub-loan. The provided values that will be used to override the `trackedBalance` field when a sub-loan is overdue according to the formula: `trackedBalance = penalizedBalance - repaidAmount - discountAmount`. The replacement of `trackedBalance` is being happened before calculating the late fee and before applying the secondary rate for days after the due one. If `penalizedBalance=0` for a sub-loan the new logic is not used.

2. The new `penalizedBalance` filed has been added at the end of the `Loan.State` structure.

3. The new `penalizedBalance` field has been added at the end of the `PreviewExtended` structure.

4. The new `takeInstallmentLoan()` function has been introduced to take installment loans with the `penalizedBalance` values. It is expected that the new function will be used in all cases. The existing `takeInstallmentLoanFor()` function will be removed in the future.

5. The new `updateLoanPenalizedBalance()` function has been added to update the `penalizedBalance`  value of a sub-loan.

6. The new `LoanPenalizedBalanceUpdated` event has been added. It is emitted in the following cases:
    * a. When a loan is taken with a non-zero `penalizedBalance` value.
    * b. When the `penalizedBalance` of an ongoing sub-loan is changed by the `updateLoanPenalizedBalance()` function.

## Migration

No special actions are required, just upgrade the deployed `CapybaraFinance` smart-contracts.

# 1.20.0

older changes
