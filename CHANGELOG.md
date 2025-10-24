# Current version

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
