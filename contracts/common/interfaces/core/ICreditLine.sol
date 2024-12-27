// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { Loan } from "../../../common/libraries/Loan.sol";

/// @title ICreditLine interface
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Defines the credit line contract functions and events.
interface ICreditLine {
    // -------------------------------------------- //
    //  Functions                                   //
    // -------------------------------------------- //

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

    /// @dev Proves the contract is the credit line one. A marker function.
    function proveCreditLine() external pure;
}
