// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { Error } from "../libraries/Error.sol";
import { Loan } from "../libraries/Loan.sol";
import { ICreditLine } from "../interfaces/ICreditLine.sol";

/// @title CreditLineMock contract
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Mock of the `CreditLine` contract used for testing.
contract CreditLineMock {
    // -------------------------------------------- //
    //  Storage variables                           //
    // -------------------------------------------- //

    mapping(address => Loan.Terms) private _loanTerms;

    bool private _onBeforeLoanTakenResult;

    bool private _onAfterLoanPaymentResult;

    bool private _onAfterLoanRevocationResult;

    uint256 private _lateFeeRate;

    // -------------------------------------------- //
    //  Events                                      //
    // -------------------------------------------- //

    event OnBeforeLoanTakenCalled(uint256 indexed loanId);

    event OnAfterLoanPaymentCalled(uint256 indexed loanId, uint256 indexed repayAmount);

    event OnAfterLoanRevocationCalled(uint256 indexed loanId);

    // -------------------------------------------- //
    //  Hook transactional functions                //
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

    // -------------------------------------------- //
    //  Mock transactional functions                //
    // -------------------------------------------- //

    function mockLoanTerms(address borrower, uint256 amount, Loan.Terms memory terms) external {
        amount; // To prevent compiler warning about unused variable
        _loanTerms[borrower] = terms;
    }

    function mockLateFeeRate(uint256 newRate) external {
        _lateFeeRate = newRate;
    }

    // -------------------------------------------- //
    //  View and pure functions                     //
    // -------------------------------------------- //

    function determineLoanTerms(
        address borrower,
        uint256 borrowAmount,
        uint256 durationInPeriods
    ) external view returns (Loan.Terms memory terms) {
        borrowAmount; // To prevent compiler warning about unused variable
        terms = _loanTerms[borrower];
        terms.durationInPeriods = uint32(durationInPeriods);
    }

    function lateFeeRate() external view returns (uint256) {
        return _lateFeeRate;
    }

    function proveCreditLine() external pure {}
}
