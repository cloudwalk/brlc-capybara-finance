// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { Interest } from "./Interest.sol";

/// @title Loan library
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Defines the common types used for loan management.
library Loan {
    /// @dev A struct that defines the stored state of a loan.
    struct State {
        // Slot 1
        address token;                    // The address of the token used for the loan.
        uint32 interestRateFactor;        // The rate factor used together with interest rates.
        uint32 interestRatePrimary;       // The primary interest rate that is applied to the loan.
        uint32 interestRateSecondary;     // The secondary interest rate that is applied to the loan.
        // Slot 2
        address borrower;                 // The address of the borrower.
        uint64 initialBorrowAmount;       // The initial total amount of the loan, including the addon.
        uint32 startTimestamp;            // The timestamp when the loan was created.
        // Slot 3
        address treasury;                 // The address of the loan treasury.
        uint32 periodInSeconds;           // The duration of the loan period specified in seconds.
        uint32 durationInPeriods;         // The total duration of the loan determined by the number of periods.
        Interest.Formula interestFormula; // The formula used for interest calculation on the loan.
        bool autoRepayment;               // The flag that indicates whether the loan can be repaid automatically.
        // Slot 4
        uint64 trackedBorrowBalance;      // The borrow balance of the loan that is tracked over its lifetime.
        uint32 trackedTimestamp;          // The timestamp when the loan was last paid or its balance was updated.
        uint32 freezeTimestamp;           // The timestamp when the loan was frozen. Zero value for unfrozen loans.
    }

    /// @dev A struct that defines the terms of the loan.
    struct Terms {
        // Slot 1
        address token;                    // The address of the token to be used for the loan.
        uint32 interestRatePrimary;       // The primary interest rate to be applied to the loan.
        uint32 interestRateSecondary;     // The secondary interest rate to be applied to the loan.
        uint32 interestRateFactor;        // The rate factor used together with interest rate.
        // Slot 2
        address treasury;                 // The address of the loan treasury.
        uint32 periodInSeconds;           // The duration of the loan period specified in seconds.
        uint32 durationInPeriods;         // The total duration of the loan determined by the number of periods.
        Interest.Formula interestFormula; // The formula to be used for interest calculation on the loan.
        bool autoRepayment;               // The flag that indicates whether the loan can be repaid automatically.
        // Slot 3
        address addonRecipient;           // The address of the loan addon recipient (extra charges or fees).
        uint64 addonAmount;               // The amount of the loan addon (extra charges or fees).
    }

    /// @dev A struct that defines the preview of the loan.
    struct Preview {
        uint256 periodIndex;        // The period index that matches the preview timestamp.
        uint256 outstandingBalance; // The outstanding balance of the loan at the previewed period.
    }
}