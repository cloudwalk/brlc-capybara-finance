// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { Loan } from "../common/libraries/Loan.sol";
import { Error } from "../common/libraries/Error.sol";
import { ICreditLine } from "../common/interfaces/core/ICreditLine.sol";

/// @title CreditLineMock contract
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Mock of the `CreditLine` contract used for testing.
contract CreditLineMock is ICreditLine {
    // -------------------------------------------- //
    //  Events                                      //
    // -------------------------------------------- //

    event OnBeforeLoanTakenCalled(uint256 indexed loanId);

    event OnAfterLoanPaymentCalled(uint256 indexed loanId, uint256 indexed repayAmount);

    event OnAfterLoanRevocationCalled(uint256 indexed loanId);

    // -------------------------------------------- //
    //  Storage variables                           //
    // -------------------------------------------- //

    address private _tokenAddress;

    mapping(address => Loan.Terms) private _loanTerms;

    bool private _onBeforeLoanTakenResult;

    bool private _onAfterLoanPaymentResult;

    bool private _onAfterLoanRevocationResult;

    // -------------------------------------------- //
    //  ICreditLine functions                       //
    // -------------------------------------------- //

    function onBeforeLoanTaken(uint256 loanId) external returns (bool) {
        emit OnBeforeLoanTakenCalled(loanId);
        return _onBeforeLoanTakenResult;
    }

    function onAfterLoanPayment(uint256 loanId, uint256 repayAmount) external returns (bool) {
        emit OnAfterLoanPaymentCalled(loanId, repayAmount);
        return _onAfterLoanPaymentResult;
    }

    function onAfterLoanRevocation(uint256 loanId) external returns (bool) {
        emit OnAfterLoanRevocationCalled(loanId);
        return _onAfterLoanRevocationResult;
    }

    function determineLoanTerms(
        address borrower,
        uint256 borrowAmount,
        uint256 durationInPeriods
    ) external view returns (Loan.Terms memory terms) {
        borrowAmount; // To prevent compiler warning about unused variable
        terms = _loanTerms[borrower];
        terms.durationInPeriods = uint32(durationInPeriods);
    }

    function market() external pure returns (address) {
        revert Error.NotImplemented();
    }

    function lender() external pure returns (address) {
        revert Error.NotImplemented();
    }

    function token() external view returns (address) {
        return _tokenAddress;
    }

    // -------------------------------------------- //
    //  Mock functions                              //
    // -------------------------------------------- //

    function mockTokenAddress(address tokenAddress) external {
        _tokenAddress = tokenAddress;
    }

    function mockLoanTerms(address borrower, uint256 amount, Loan.Terms memory terms) external {
        amount; // To prevent compiler warning about unused variable
        _loanTerms[borrower] = terms;
    }

    function proveCreditLine() external pure {}
}
