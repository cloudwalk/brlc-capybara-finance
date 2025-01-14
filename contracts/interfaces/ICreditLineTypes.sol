// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

/// @title ICreditLineTypes interface
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Defines types that are used in the credit line contract.
interface ICreditLineTypes {
    /// @dev Defines the available borrow policies.
    ///
    /// Possible values:
    ///
    /// - SingleActiveLoan = 0 -------- Only one active loan is allowed; additional loan requests will be rejected.
    /// - MultipleActiveLoans = 1 ------ Multiple active loans are allowed, with no limit on the total borrowed amount.
    /// - TotalActiveAmountLimit = 2 --- Multiple active loans are allowed, but their total borrowed amount cannot
    ///                                  exceed the maximum borrow amount of a single loan specified for the borrower.
    ///
    /// Note: In all cases, each individual loan must comply with the minimum and maximum amount limits.
    enum BorrowPolicy {
        SingleActiveLoan,
        MultipleActiveLoans,
        TotalActiveAmountLimit
    }

    /// @dev A struct that defines credit line configuration.
    struct CreditLineConfig {
        // Slot 1
        uint64 minBorrowAmount;          // The minimum amount of tokens the borrower can take as a loan.
        uint64 maxBorrowAmount;          // The maximum amount of tokens the borrower can take as a loan.
        uint32 minInterestRatePrimary;   // The minimum primary interest rate to be applied to the loan.
        uint32 maxInterestRatePrimary;   // The maximum primary interest rate to be applied to the loan.
        uint32 minInterestRateSecondary; // The minimum secondary interest rate to be applied to the loan.
        uint32 maxInterestRateSecondary; // The maximum secondary interest rate to be applied to the loan.
        // Slot 2
        uint32 minDurationInPeriods;     // The minimum duration of the loan determined in periods.
        uint32 maxDurationInPeriods;     // The maximum duration of the loan determined in periods.
        uint32 minAddonFixedRate;        // The minimum fixed rate for the loan addon calculation.
        uint32 maxAddonFixedRate;        // The maximum fixed rate for the loan addon calculation.
        uint32 minAddonPeriodRate;       // The minimum period rate for the loan addon calculation.
        uint32 maxAddonPeriodRate;       // The maximum period rate for the loan addon calculation.
        uint32 lateFeeRate;              // The late fee rate to be applied to the loan.
    }

    /// @dev A struct that defines borrower configuration.
    struct BorrowerConfig {
        // Slot 1
        uint32 expiration;                // The expiration date of the configuration.
        uint32 minDurationInPeriods;      // The minimum duration of the loan determined in periods.
        uint32 maxDurationInPeriods;      // The maximum duration of the loan determined in periods.
        uint64 minBorrowAmount;           // The minimum amount of tokens the borrower can take as a loan.
        uint64 maxBorrowAmount;           // The maximum amount of tokens the borrower can take as a loan.
        BorrowPolicy borrowPolicy;        // The borrow policy to be applied to the borrower.
        // uint24 __reserved;             // Reserved for future use.
        // Slot 2
        uint32 interestRatePrimary;       // The primary interest rate to be applied to the loan.
        uint32 interestRateSecondary;     // The secondary interest rate to be applied to the loan.
        uint32 addonFixedRate;            // The fixed rate for the loan addon calculation (extra charges or fees).
        uint32 addonPeriodRate;           // The period rate for the loan addon calculation (extra charges or fees).
    }

    /// @dev Defines a borrower state.
    ///
    /// Fields:
    ///
    /// - activeLoanCount -------- the number of active loans currently held by the borrower.
    /// - closedLoanCount -------- the number of loans that have been closed, with or without a full repayment.
    /// - totalActiveLoanAmount -- the total amount borrowed across all active loans.
    /// - totalClosedLoanAmount -- the total amount that was borrowed across all closed loans.
    struct BorrowerState {
        // Slot 1
        uint16 activeLoanCount;
        uint16 closedLoanCount;
        uint64 totalActiveLoanAmount;
        uint64 totalClosedLoanAmount;
        // uint96 __reserved; // Reserved for future use until the end of the storage slot.
    }
}
