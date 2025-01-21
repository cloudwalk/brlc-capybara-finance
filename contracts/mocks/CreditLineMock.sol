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
    uint256 private _lateFeeAmount;

    // -------------------------------------------- //
    //  Events                                      //
    // -------------------------------------------- //

    event OnBeforeLoanTakenCalled(uint256 indexed loanId);
    event OnAfterLoanPaymentCalled(uint256 indexed loanId, uint256 indexed repaymentAmount);
    event OnAfterLoanRevocationCalled(uint256 indexed loanId);

    // -------------------------------------------- //
    //  Hook transactional functions                //
    // -------------------------------------------- //

    function onBeforeLoanTaken(uint256 loanId) external {
        emit OnBeforeLoanTakenCalled(loanId);
    }

    function onAfterLoanPayment(uint256 loanId, uint256 repaymentAmount) external {
        emit OnAfterLoanPaymentCalled(loanId, repaymentAmount);
    }

    function onAfterLoanRevocation(uint256 loanId) external {
        emit OnAfterLoanRevocationCalled(loanId);
    }

    // -------------------------------------------- //
    //  Mock transactional functions                //
    // -------------------------------------------- //

    function mockLoanTerms(address borrower, uint256 amount, Loan.Terms memory terms) external {
        amount; // To prevent compiler warning about unused variable
        _loanTerms[borrower] = terms;
    }

    function mockLateFeeAmount(uint256 newAmount) external {
        _lateFeeAmount = newAmount;
    }

    // -------------------------------------------- //
    //  View and pure functions                     //
    // -------------------------------------------- //

    function determineLoanTerms(
        address borrower,
        uint256 borrowedAmount,
        uint256 durationInPeriods
    ) external view returns (Loan.Terms memory terms) {
        borrowedAmount; // To prevent compiler warning about unused variable
        terms = _loanTerms[borrower];
        terms.durationInPeriods = uint32(durationInPeriods);
    }

    function determineLateFeeAmount(uint256 loanTrackedBalance) external view returns (uint256) {
        loanTrackedBalance; // To prevent compiler warning about unused variable
        return _lateFeeAmount;
    }

    function proveCreditLine() external pure {}
}
