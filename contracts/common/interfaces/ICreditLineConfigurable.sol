// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { ICreditLine } from "./core/ICreditLine.sol";

/// @title ICreditLineConfigurable interface
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Defines the configurable credit line contract functions and events.
interface ICreditLineConfigurable is ICreditLine {
    // -------------------------------------------- //
    //  Structs and enums                           //
    // -------------------------------------------- //

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

    // -------------------------------------------- //
    //  Events                                      //
    // -------------------------------------------- //

    /// @dev Emitted when the credit line is configured.
    /// @param creditLine The address of the current credit line.
    event CreditLineConfigured(address indexed creditLine);

    /// @dev Emitted when a borrower is configured.
    /// @param creditLine The address of the current credit line.
    /// @param borrower The address of the borrower being configured.
    event BorrowerConfigured(address indexed creditLine, address indexed borrower);

    // -------------------------------------------- //
    //  Functions                                   //
    // -------------------------------------------- //

    /// @dev Updates the credit line configuration.
    /// @param config The structure containing the credit line configuration.
    function configureCreditLine(CreditLineConfig memory config) external;

    /// @dev Configures a specific borrower.
    /// @param borrower The address of the borrower to configure.
    /// @param config The struct containing the borrower configuration.
    function configureBorrower(address borrower, BorrowerConfig memory config) external;

    /// @dev Configures multiple borrowers at once.
    /// @param borrowers The addresses of the borrowers to configure.
    /// @param configs The array containing the borrower configurations.
    function configureBorrowers(address[] memory borrowers, BorrowerConfig[] memory configs) external;

    /// @dev Retrieves the configuration of a borrower.
    /// @param borrower The address of the borrower to check.
    /// @return The structure containing the borrower configuration.
    function getBorrowerConfiguration(address borrower) external view returns (BorrowerConfig memory);

    /// @dev Retrieves the state of a borrower.
    /// @param borrower The address of the borrower to check.
    /// @return The structure containing the borrower state.
    function getBorrowerState(address borrower) external view returns (BorrowerState memory);

    /// @dev Retrieves the credit line configuration.
    /// @return The structure containing the credit line configuration.
    function creditLineConfiguration() external view returns (CreditLineConfig memory);

    /// @dev Checks whether an account is an admin.
    /// @param account The address of the account to check.
    /// @return True if the account is configured as an admin.
    function isAdmin(address account) external view returns (bool);
}
