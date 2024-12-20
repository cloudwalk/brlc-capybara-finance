// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

/// @title Loan library
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Defines the common types used for loan management.
library Loan {
    /// @dev The type of a loan.
    ///
    /// Possible values:
    /// - Ordinary = 0 ----- An ordinary loan.
    /// - Installment = 1 -- A sub-loan of an installment loan.
    enum Type {
        Ordinary,
        Installment
    }

    /// @dev A struct that defines the stored state of a loan.
    struct State {
        // Slot1
        uint32 programId;             // The unique identifier of the program.
        uint64 borrowAmount;          // The initial borrow amount of the loan, excluding the addon.
        uint64 addonAmount;           // The amount of the loan addon (extra charges or fees).
        uint32 startTimestamp;        // The timestamp when the loan was created (stated).
        uint32 durationInPeriods;     // The total duration of the loan determined by the number of periods.
        // uint32 __reserved;         // Reserved for future use.
        // Slot 2
        address token;                // The address of the token used for the loan.
        // uint96 __reserved;         // Reserved for future use.
        // Slot 3
        address borrower;             // The address of the borrower.
        uint32 interestRatePrimary;   // The primary interest rate that is applied to the loan.
        uint32 interestRateSecondary; // The secondary interest rate that is applied to the loan.
        // uint32 __reserved;         // Reserved for future use.
        // Slot 4
        uint64 repaidAmount;          // The amount that has been repaid on the loan over its lifetime.
        uint64 trackedBalance;        // The borrow balance of the loan that is tracked over its lifetime.
        uint32 trackedTimestamp;      // The timestamp when the loan was last paid or its balance was updated.
        uint32 freezeTimestamp;       // The timestamp when the loan was frozen. Zero value for unfrozen loans.
        uint40 firstInstallmentId;    // The ID of the first installment for sub-loans or zero for ordinary loans.
        uint8 instalmentCount;        // The total number of installments for sub-loans or zero for ordinary loans.
        // uint16 __reserved;         // Reserved for future use.
    }

    /// @dev A struct that defines the terms of the loan.
    struct Terms {
        // Slot 1
        address token;                // The address of the token to be used for the loan.
        uint64 addonAmount;           // The amount of the loan addon (extra charges or fees).
        uint32 durationInPeriods;     // The total duration of the loan determined by the number of periods.
        // Slot 2
        uint32 interestRatePrimary;   // The primary interest rate to be applied to the loan.
        uint32 interestRateSecondary; // The secondary interest rate to be applied to the loan.
    }

    /// @dev A struct that defines the preview of the loan.
    struct Preview {
        uint256 periodIndex;        // The period index that matches the preview timestamp.
        uint256 trackedBalance;     // The tracked balance of the loan at the previewed period.
        uint256 outstandingBalance; // The outstanding balance of the loan at the previewed period.
    }

    /// @dev A struct that defines the preview of an installment loan.
    ///
    /// The structure can be returned for both ordinary and installment loans.
    ///
    /// The purpose of the fields in the case of installment loans:
    ///
    /// - firstInstallmentId ------- The first installment ID.
    /// - instalmentCount ---------- The total number of installments.
    /// - periodIndex -------------- The period index that matches the preview timestamp.
    /// - totalTrackedBalance ------ The total tracked balance of all installments.
    /// - totalOutstandingBalance -- The total outstanding balance of all installments.
    ///
    /// The purpose of the fields in the case of ordinary loans:
    ///
    /// - firstInstallmentId ------- The ID of the loan.
    /// - instalmentCount ---------- The total number of installments that always equals zero.
    /// - periodIndex -------------- The period index that matches the preview timestamp.
    /// - totalTrackedBalance ------ The tracked balance of the loan.
    /// - totalOutstandingBalance -- The outstanding balance of the loan.
    ///
    /// Notes:
    ///
    /// 1. The `totalTrackedBalance` fields calculates as the sum of tracked balances of all installments.
    /// 2. The `totalOutstandingBalance` fields calculates as the sum of rounded tracked balances
    ///    of all installments according to the `ACCURACY_FACTOR` constant.
    struct InstallmentLoanPreview {
        uint256 firstInstallmentId;      
        uint256 instalmentCount;
        uint256 periodIndex;
        uint256 totalTrackedBalance;
        uint256 totalOutstandingBalance;
    }
}
