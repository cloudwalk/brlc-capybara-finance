// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { ICreditLineTypes } from "./ICreditLineTypes.sol";
import { Loan } from "../libraries/Loan.sol";

/// @title ICreditLinePrimary interface
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev The primary part of the credit line contract interface.
interface ICreditLinePrimary is ICreditLineTypes {
    // -------------------------------------------- //
    //  Events                                      //
    // -------------------------------------------- //

    /// @dev Emitted when a borrower is configured.
    /// @param creditLine The address of the current credit line.
    /// @param borrower The address of the borrower being configured.
    event BorrowerConfigured(address indexed creditLine, address indexed borrower);

    // -------------------------------------------- //
    //  Transactional functions                     //
    // -------------------------------------------- //

    /// @dev Configures a specific borrower.
    /// @param borrower The address of the borrower to configure.
    /// @param config The struct containing the borrower configuration.
    function configureBorrower(address borrower, BorrowerConfig memory config) external;

    /// @dev Configures multiple borrowers at once.
    /// @param borrowers The addresses of the borrowers to configure.
    /// @param configs The array containing the borrower configurations.
    function configureBorrowers(address[] memory borrowers, BorrowerConfig[] memory configs) external;

    // -------------------------------------------- //
    //  View and pure functions                     //
    // -------------------------------------------- //

    /// @dev Retrieves the loan terms for the provided borrower, amount, and loan duration.
    /// @param borrower The address of the borrower.
    /// @param borrowAmount The desired amount of tokens to borrow.
    /// @param durationInPeriods The desired duration of the loan in periods.
    /// @return terms The struct containing the terms of the loan.
    function determineLoanTerms(
        address borrower,
        uint256 borrowAmount,
        uint256 durationInPeriods
    ) external view returns (Loan.Terms memory terms);

    /// @dev Returns the address of the associated lending market.
    function market() external view returns (address);

    /// @dev Returns the address of the credit line token.
    function token() external view returns (address);

    /// @dev Returns the late fee rate to be applied to loans taken out with this credit line.
    function lateFeeRate() external view returns (uint256);

    /// @dev Retrieves the configuration of a borrower.
    /// @param borrower The address of the borrower to check.
    /// @return The structure containing the borrower configuration.
    function getBorrowerConfiguration(address borrower) external view returns (BorrowerConfig memory);

    /// @dev Retrieves the state of a borrower.
    /// @param borrower The address of the borrower to check.
    /// @return The structure containing the borrower state.
    function getBorrowerState(address borrower) external view returns (BorrowerState memory);

    /// @dev Proves the contract is the credit line one. A marker function.
    function proveCreditLine() external pure;
}

/// @title ICreditLineConfiguration interface
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev The configuration part of the credit line contract interface.
interface ICreditLineConfiguration is ICreditLineTypes {
    // -------------------------------------------- //
    //  Events                                      //
    // -------------------------------------------- //

    /// @dev Emitted when the credit line is configured.
    /// @param creditLine The address of the current credit line.
    event CreditLineConfigured(address indexed creditLine);

    // -------------------------------------------- //
    //  Transactional functions                     //
    // -------------------------------------------- //

    /// @dev Updates the credit line configuration.
    /// @param config The structure containing the credit line configuration.
    function configureCreditLine(CreditLineConfig memory config) external;

    // -------------------------------------------- //
    //  View functions                              //
    // -------------------------------------------- //

    /// @dev Retrieves the credit line configuration.
    /// @return The structure containing the credit line configuration.
    function creditLineConfiguration() external view returns (CreditLineConfig memory);

    /// @dev Checks whether an account is an admin.
    /// @param account The address of the account to check.
    /// @return True if the account is configured as an admin.
    function isAdmin(address account) external view returns (bool);
}

/// @title ICreditLineHooks interface
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev The hooks part of the credit line contract interface.
interface ICreditLineHooks {
    /// @dev A hook that is triggered by the associated market before a loan is taken.
    /// @param loanId The unique identifier of the loan being taken.
    function onBeforeLoanTaken(uint256 loanId) external returns (bool);

    /// @dev A hook that is triggered by the associated market after the loan payment.
    /// @param loanId The unique identifier of the loan being paid.
    /// @param repayAmount The amount of tokens that was repaid.
    function onAfterLoanPayment(uint256 loanId, uint256 repayAmount) external returns (bool);

    /// @dev A hook that is triggered by the associated market after the loan revocation.
    /// @param loanId The unique identifier of the loan being revoked.
    function onAfterLoanRevocation(uint256 loanId) external returns (bool);
}

/// @title ICreditLineErrors interface
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Defines the custom errors used in the credit line contract.
interface ICreditLineErrors {
    /// @dev Thrown when the credit line configuration is invalid.
    error InvalidCreditLineConfiguration();

    /// @dev Thrown when the borrower configuration is invalid.
    error InvalidBorrowerConfiguration();

    /// @dev Thrown when the borrower configuration has expired.
    error BorrowerConfigurationExpired();

    /// @dev Thrown when the loan duration is out of range.
    error LoanDurationOutOfRange();

    /// @dev Thrown when another loan is requested by an account but only one active loan is allowed.
    error LimitViolationOnSingleActiveLoan();

    /// @dev Thrown when the total borrowed amount of active loans exceeds the maximum borrow amount of a single loan.
    error LimitViolationOnTotalActiveLoanAmount(uint256 newTotalActiveLoanAmount);

    /// @dev Thrown when the borrower state counters or amounts would overflow their maximum values.
    error BorrowerStateOverflow();
}

/// @title ICreditLine interface
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Defines the full interface of the credit line contract.
interface ICreditLine is ICreditLinePrimary, ICreditLineConfiguration, ICreditLineHooks, ICreditLineErrors {}