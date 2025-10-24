// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

/**
 * @title Loan library
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the common types used for loan management.
 */
library Loan {
    /**
     * @dev The type of a loan.
     *
     * Possible values:
     * - Ordinary = 0 ----- An ordinary loan.
     * - Installment = 1 -- A sub-loan of an installment loan.
     */
    enum Type {
        Ordinary,
        Installment
    }

    /**
     * @dev A struct that defines the stored state of a loan.
     *
     * Fields:
     *
     * - programId -------------- The unique identifier of the program.
     * - borrowedAmount --------- The initial borrowed amount of the loan, excluding the addon.
     * - addonAmount ------------ The amount of the loan addon (extra charges or fees).
     * - startTimestamp --------- The timestamp when the loan was created (stated).
     * - durationInPeriods ------ The total duration of the loan determined by the number of periods.
     * - token ------------------ The address of the token used for the loan.
     * - borrower --------------- The address of the borrower.
     * - interestRatePrimary ---- The primary interest rate that is applied to the loan.
     * - interestRateSecondary -- The secondary interest rate that is applied to the loan.
     * - repaidAmount ----------- The amount that has been repaid on the loan over its lifetime.
     * - trackedBalance --------- The borrowed balance of the loan that is tracked over its lifetime.
     * - trackedTimestamp ------- The timestamp when the loan was last paid or its balance was updated.
     * - freezeTimestamp -------- The timestamp when the loan was frozen. Zero value for unfrozen loans.
     * - firstInstallmentId ----- The ID of the first installment for sub-loans or zero for ordinary loans.
     * - installmentCount ------- The total number of installments for sub-loans or zero for ordinary loans.
     * - lateFeeAmount ---------- The late fee amount of the loan or zero if the loan is not defaulted.
     * - discountAmount --------- The discount amount of the loan or zero if the loan is not discounted.
     * - penaltyInterestRate ---- The penalty interest rate of the loan, can be zero, see notes below.
     *
     * Notes about the penalty interest rate:
     *
     * - The penalty interest rate defines the rate that will be retroactively applied when the loan is overdue.
     *   It can be used for loans with a grace period or in similar cases.
     * - The zero value means that the penalty interest rate logic is not applied.
     * - If the penalty interest rate is not zero and the loan is overdue then
     *   the tracked balance is replaced by the formula:
     *   `trackedBalance = principal * (1 + penaltyInterestRate) ^ durationInPeriods - repaidAmount - discountAmount`,
     *   where `principal = borrowedAmount + addonAmount`.
     * - The penalty interest rate must noy be lower than the primary interest rate.
     *   Otherwise, with large values of `(repaidAmount + discountAmount)`, the new tracked balance for an overdue loan
     *   may become negative, according to the formula above. An example:
     *   - `principal = 100`;
     *   - `interestRatePrimary = 2%`;
     *   - `penaltyInterestRate = 1%`;
     *   - `durationInPeriods = 10`;
     *   - at the due date: `trackedBalance = 100 * (1 + 2%) ^ 10 = 122`;
     *   - at the due date: `repaidAmount = 120`;
     *   - after the replacement at the due date: `trackedBalance = 100 * (1 + 1%) ^ 10 - 120 = 110 - 120 = -10`.
     * - There is another possible formula for the tracked balance replacement:
     *   `trackedBalance = (principal - repaidAmount - discountAmount) * (1 + penaltyInterestRate) ^ durationInPeriods`
     *   but it creates an exploit opportunity in the case of non-zero primary rate. An example:
     *   - the borrower repays the principal before the loan is overdue, but not the primary interest;
     *   - the borrower waits until the loan is overdue;
     *   - the borrower gets the zero tracked balance after the penalty interest rate is applied.
     */
    struct State {
        // Slot1
        uint32 programId;
        uint64 borrowedAmount;
        uint64 addonAmount;
        uint32 startTimestamp;
        uint32 durationInPeriods;
        // uint32 __reserved;

        // Slot 2
        address token;
        // uint96 __reserved;

        // Slot 3
        address borrower;
        uint32 interestRatePrimary;
        uint32 interestRateSecondary;
        // uint32 __reserved;

        // Slot 4
        uint64 repaidAmount;
        uint64 trackedBalance;
        uint32 trackedTimestamp;
        uint32 freezeTimestamp;
        uint40 firstInstallmentId;
        uint8 installmentCount;
        // uint16 __reserved;

        // Slot 5
        uint64 lateFeeAmount;
        uint64 discountAmount;
        uint32 penaltyInterestRate;
        // uint96 __reserved;
    }

    /**
     * @dev A struct that defines the terms of a loan.
     *
     * Fields:
     *
     * - token ------------------ The address of the token to be used for the loan.
     * - addonAmount ------------ The amount of the loan addon (extra charges or fees).
     * - durationInPeriods ------ The total duration of the loan determined by the number of periods.
     * - interestRatePrimary ---- The primary interest rate to be applied to the loan.
     * - interestRateSecondary -- The secondary interest rate to be applied to the loan.
     *
     * Note:
     * The `addonAmount` field has been deprecated since version 1.8.0 and is always zero.
     * The addon amount of a loan is no longer calculated in the contract.
     * It is passed as a parameter of a borrowing function instead.
     */
    struct Terms {
        address token;
        uint256 addonAmount;
        uint256 durationInPeriods;
        uint256 interestRatePrimary;
        uint256 interestRateSecondary;
    }

    /**
     * @dev A struct that defines the preview of the loan.
     *
     * Fields:
     *
     * - periodIndex ------------ The period index that matches the preview timestamp.
     * - trackedBalance --------- The tracked balance of the loan at the previewed period.
     * - outstandingBalance ----- The outstanding balance of the loan at the previewed period.
     *
     * Note:
     * The outstanding balance is the tracked balance rounded according to the accuracy factor with math rules.
     */
    struct Preview {
        uint256 periodIndex;
        uint256 trackedBalance;
        uint256 outstandingBalance;
    }

    /**
     * @dev A struct that defines the extended preview of a loan.
     *
     * Fields:
     *
     * - periodIndex ------------ The period index that matches the preview timestamp.
     * - trackedBalance --------- The tracked balance of the loan at the previewed period.
     * - outstandingBalance ----- The outstanding balance of the loan at the previewed period.
     * - borrowedAmount --------- The borrowed amount of the loan at the previewed period.
     * - addonAmount ------------ The addon amount of the loan at the previewed period.
     * - repaidAmount ----------- The repaid amount of the loan at the previewed period.
     * - lateFeeAmount ---------- The late fee amount of the loan at the previewed period.
     * - discountAmount --------- The discount amount of the loan at the previewed period.
     * - programId -------------- The program ID of the loan.
     * - borrower --------------- The borrower of the loan.
     * - previewTimestamp ------- The preview timestamp.
     * - startTimestamp --------- The start timestamp of the loan.
     * - trackedTimestamp ------- The tracked timestamp of the loan.
     * - freezeTimestamp -------- The freeze timestamp of the loan.
     * - durationInPeriods ------ The duration in periods of the loan.
     * - interestRatePrimary ---- The primary interest rate of the loan.
     * - interestRateSecondary -- The secondary interest rate of the loan.
     * - firstInstallmentId ----- The ID of the first installment for sub-loans or zero for ordinary loans.
     * - installmentCount ------- The total number of installments for sub-loans or zero for ordinary loans.
     * - penaltyInterestRate ---- The penalty interest rate of the loan, see notes below.
     * - penaltyBalance --------- The tracked balance determined at the preview timestamp
     *                            using the penalty interest rate, see notes below.
     *
     * Notes:
     *
     * - The outstanding balance is the tracked balance rounded according to the accuracy factor with math rules.
     * - See notes about the penalty interest rate in the comments for the {Loan} struct.
     * - The `penaltyBalance` field is determined as follows:
     *   - if the `penaltyInterestRate` field is zero then the `penaltyBalance` field is zero as well;
     *   - if the `trackedBalance` field is zero then the `penaltyBalance` field is zero as well;
     *   - if the loan is overdue then `penaltyBalance` fields equals to the `trackedBalance` field;
     *   - otherwise, the `penaltyBalance` field is calculated using the formula:
     *     ```
     *     penaltyBalance = principal * (1 + penaltyInterestRate) ^ periodsSinceStart - repaidAmount - discountAmount
     *     ```
     *     where `principal = borrowedAmount + addonAmount` and `periodsSinceStart` is
     *     the integer number of periods passed from the loan start timestamp to the preview timestamp.
     * - The `penaltyBalance` field is not rounded according to the accuracy factor.
     */
    struct PreviewExtended {
        uint256 periodIndex;
        uint256 trackedBalance;
        uint256 outstandingBalance;
        uint256 borrowedAmount;
        uint256 addonAmount;
        uint256 repaidAmount;
        uint256 lateFeeAmount;
        uint256 discountAmount;
        uint256 programId;
        address borrower;
        uint256 previewTimestamp;
        uint256 startTimestamp;
        uint256 trackedTimestamp;
        uint256 freezeTimestamp;
        uint256 durationInPeriods;
        uint256 interestRatePrimary;
        uint256 interestRateSecondary;
        uint256 firstInstallmentId;
        uint256 installmentCount;
        uint256 penaltyInterestRate;
        uint256 penaltyBalance;
    }

    /**
     * @dev A struct that defines the preview of an installment loan.
     *
     * The structure can be returned for both ordinary and installment loans.
     *
     * The purpose of the fields in the case of installment loans:
     *
     * - firstInstallmentId ------- The first installment ID.
     * - installmentCount --------- The total number of installments.
     * - periodIndex -------------- The period index that matches the preview timestamp.
     * - totalTrackedBalance ------ The total tracked balance of all installments.
     * - totalOutstandingBalance -- The total outstanding balance of all installments
     * - totalBorrowedAmount ------ The total borrowed amount of all installments.
     * - totalAddonAmount --------- The total addon amount of all installments.
     * - totalRepaidAmount -------- The total repaid amount of all installments.
     * - totalLateFeeAmount ------- The total late fee amount of all installments.
     * - installmentPreviews ------ The extended previews of all installments.
     * - totalDiscountAmount ------ The total discount amount of all installments.
     *
     * The purpose of the fields in the case of ordinary loans:
     *
     * - firstInstallmentId ------- The ID of the loan.
     * - installmentCount --------- The total number of installments that always equals zero.
     * - periodIndex -------------- The period index that matches the preview timestamp.
     * - totalTrackedBalance ------ The tracked balance of the loan.
     * - totalOutstandingBalance -- The outstanding balance of the loan.
     * - totalBorrowedAmount ------ The borrowed amount of the loan.
     * - totalAddonAmount --------- The addon amount of the loan.
     * - totalRepaidAmount -------- The repaid amount of the loan.
     * - totalLateFeeAmount ------- The late fee amount of the loan.
     * - installmentPreviews ------ The extended preview of the loan as a single item array.
     * - totalDiscountAmount ------ The total discount amount of the loan.
     */

    /**
     * Notes:
     *
     * 1. The `totalTrackedBalance` fields calculates as the sum of tracked balances of all installments.
     * 2. The `totalOutstandingBalance` fields calculates as the sum of outstanding balances of all installments.
     * 3. The outstanding balance is the tracked balance rounded according to the accuracy factor with math rules.
     */
    struct InstallmentLoanPreview {
        uint256 firstInstallmentId;
        uint256 installmentCount;
        uint256 periodIndex;
        uint256 totalTrackedBalance;
        uint256 totalOutstandingBalance;
        uint256 totalBorrowedAmount;
        uint256 totalAddonAmount;
        uint256 totalRepaidAmount;
        uint256 totalLateFeeAmount;
        uint256 totalDiscountAmount;
        PreviewExtended[] installmentPreviews;
    }
}
