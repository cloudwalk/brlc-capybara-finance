// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

/// @title ICreditLineTypes interface
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Defines types that are used in the credit line contract.
interface ICreditLineTypes {
    /// @dev Defines the available borrowing policies.
    ///
    /// Possible values:
    ///
    /// - SingleActiveLoan = 0 -------- Only one active loan is allowed; additional loan requests will be rejected.
    /// - MultipleActiveLoans = 1 ----- Multiple active loans are allowed, with no limit on the total borrowed amount.
    /// - TotalActiveAmountLimit = 2 -- Multiple active loans are allowed, but their total borrowed amount cannot
    ///                                 exceed the maximum borrowed amount of a single loan specified for the borrower.
    ///
    /// Note: In all cases, each individual loan must comply with the minimum and maximum amount limits.
    enum BorrowingPolicy {
        SingleActiveLoan,
        MultipleActiveLoans,
        TotalActiveAmountLimit
    }

    /// @dev Defines the available late fee policies.
    ///
    /// Possible values:
    ///
    /// - Common = 0 --------- The late fee rate is coming from the credit line configuration.
    /// - Individual = 1 ----- The late fee rate is coming from the borrower configuration.
    enum LateFeePolicy {
        Common,
        Individual
    }

    /// @dev A struct that defines credit line configuration.
    ///
    /// Fields:
    ///
    /// - minBorrowedAmount --------- The minimum amount of tokens the borrower can take as a loan.
    /// - maxBorrowedAmount --------- The maximum amount of tokens the borrower can take as a loan.
    /// - minInterestRatePrimary ---- The minimum primary interest rate to be applied to the loan.
    /// - maxInterestRatePrimary ---- The maximum primary interest rate to be applied to the loan.
    /// - minInterestRateSecondary -- The minimum secondary interest rate to be applied to the loan.
    /// - maxInterestRateSecondary -- The maximum secondary interest rate to be applied to the loan.
    /// - minDurationInPeriods ------ The minimum duration of the loan determined in periods.
    /// - maxDurationInPeriods ------ The maximum duration of the loan determined in periods.
    /// - minAddonFixedRate --------- The minimum fixed rate for the loan addon calculation.
    /// - maxAddonFixedRate --------- The maximum fixed rate for the loan addon calculation.
    /// - minAddonPeriodRate -------- The minimum period rate for the loan addon calculation.
    /// - maxAddonPeriodRate -------- The maximum period rate for the loan addon calculation.
    /// - lateFeeRate --------------- The late fee rate to be applied to the loan.
    ///
    /// Note:
    /// Fields `minAddonFixedRate`, `maxAddonFixedRate`, `minAddonPeriodRate`, `maxAddonPeriodRate` have been
    /// deprecated since version 1.8.0 and must be set to zero.
    struct CreditLineConfig {
        // Slot 1
        uint64 minBorrowedAmount;
        uint64 maxBorrowedAmount;
        uint32 minInterestRatePrimary;
        uint32 maxInterestRatePrimary;
        uint32 minInterestRateSecondary;
        uint32 maxInterestRateSecondary;
        // Slot 2
        uint32 minDurationInPeriods;
        uint32 maxDurationInPeriods;
        uint32 minAddonFixedRate;
        uint32 maxAddonFixedRate;
        uint32 minAddonPeriodRate;
        uint32 maxAddonPeriodRate;
        uint32 lateFeeRate;
    }

    /// @dev A struct that defines borrower configuration.
    ///
    /// Fields:
    ///
    /// - expiration ------------- The expiration date of the configuration.
    /// - minDurationInPeriods --- The minimum duration of the loan determined in periods.
    /// - maxDurationInPeriods --- The maximum duration of the loan determined in periods.
    /// - minBorrowedAmount ------ The minimum amount of tokens the borrower can take as a loan.
    /// - maxBorrowedAmount ------ The maximum amount of tokens the borrower can take as a loan.
    /// - borrowingPolicy -------- The borrowing policy to be applied to the borrower.
    /// - interestRatePrimary ---- The primary interest rate to be applied to the loan.
    /// - interestRateSecondary -- The secondary interest rate to be applied to the loan.
    /// - addonFixedRate --------- The fixed rate for the loan addon calculation (extra charges or fees).
    /// - addonPeriodRate -------- The period rate for the loan addon calculation (extra charges or fees).
    /// - lateFeePolicy ---------- The late fee policy to be applied to the borrower.
    /// - lateFeeRate ------------ The late fee rate to be applied to the borrower.
    ///
    /// Note:
    /// Fields `addonFixedRate`, `addonPeriodRate` have been deprecated since version 1.8.0 and must be set to zero.
    struct BorrowerConfig {
        // Slot 1
        uint32 expiration;
        uint32 minDurationInPeriods;
        uint32 maxDurationInPeriods;
        uint64 minBorrowedAmount;
        uint64 maxBorrowedAmount;
        BorrowingPolicy borrowingPolicy;
        // uint24 __reserved;
        // Slot 2
        uint32 interestRatePrimary;
        uint32 interestRateSecondary;
        uint32 addonFixedRate;
        uint32 addonPeriodRate;
        LateFeePolicy lateFeePolicy;
        uint32 lateFeeRate;
    }

    /// @dev A legacy struct that defines borrower configuration.
    ///
    /// Fields:
    ///
    /// - expiration ------------- The expiration date of the configuration.
    /// - minDurationInPeriods --- The minimum duration of the loan determined in periods.
    /// - maxDurationInPeriods --- The maximum duration of the loan determined in periods.
    /// - minBorrowedAmount ------ The minimum amount of tokens the borrower can take as a loan.
    /// - maxBorrowedAmount ------ The maximum amount of tokens the borrower can take as a loan.
    /// - borrowingPolicy -------- The borrowing policy to be applied to the borrower.
    /// - interestRatePrimary ---- The primary interest rate to be applied to the loan.
    /// - interestRateSecondary -- The secondary interest rate to be applied to the loan.
    /// - addonFixedRate --------- The fixed rate for the loan addon calculation (extra charges or fees).
    /// - addonPeriodRate -------- The period rate for the loan addon calculation (extra charges or fees).
    ///
    /// Note:
    /// Fields `addonFixedRate`, `addonPeriodRate` have been deprecated since version 1.8.0 and must be set to zero.
    struct BorrowerConfigLegacy {
        // Slot 1
        uint32 expiration;
        uint32 minDurationInPeriods;
        uint32 maxDurationInPeriods;
        uint64 minBorrowedAmount;
        uint64 maxBorrowedAmount;
        BorrowingPolicy borrowingPolicy;
        // uint24 __reserved;
        // Slot 2
        uint32 interestRatePrimary;
        uint32 interestRateSecondary;
        uint32 addonFixedRate;
        uint32 addonPeriodRate;
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
