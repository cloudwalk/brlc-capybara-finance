// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { Constants } from "../libraries/Constants.sol";
import { Error } from "../libraries/Error.sol";
import { Loan } from "../libraries/Loan.sol";
import { ICreditLine } from "../interfaces/ICreditLine.sol";

/// @title CreditLineMock contract
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Mock of the `CreditLine` contract used for testing.
contract CreditLineMock {
    // ------------------ Storage variables ----------------------- //

    mapping(address => Loan.Terms) private _loanTerms;
    uint256 private _lateFeeRate;

    // ------------------ Events ---------------------------------- //

    event OnBeforeLoanTakenCalled(uint256 indexed loanId);
    event OnBeforeLoanReopenedCalled(uint256 indexed loanId);
    event OnAfterLoanPaymentCalled(uint256 indexed loanId, uint256 indexed repaymentAmount);
    event OnAfterLoanRevocationCalled(uint256 indexed loanId);

    // ------------------ Hook transactional functions ------------ //

    function onBeforeLoanTaken(uint256 loanId) external {
        emit OnBeforeLoanTakenCalled(loanId);
    }

    function onBeforeLoanReopened(uint256 loanId) external {
        emit OnBeforeLoanReopenedCalled(loanId);
    }

    function onAfterLoanPayment(uint256 loanId, uint256 repaymentAmount) external {
        emit OnAfterLoanPaymentCalled(loanId, repaymentAmount);
    }

    function onAfterLoanRevocation(uint256 loanId) external {
        emit OnAfterLoanRevocationCalled(loanId);
    }

    // ------------------ Mock transactional functions ------------ //

    function mockLoanTerms(address borrower, uint256 amount, Loan.Terms memory terms) external {
        amount; // To prevent compiler warning about unused variable
        _loanTerms[borrower] = terms;
    }

    function mockLateFeeRate(uint256 newRate) external {
        _lateFeeRate = newRate;
    }

    // ------------------ View functions -------------------------- //

    function determineLoanTerms(
        address borrower,
        uint256 borrowedAmount,
        uint256 durationInPeriods
    ) external view returns (Loan.Terms memory terms) {
        borrowedAmount; // To prevent compiler warning about unused variable
        terms = _loanTerms[borrower];
        terms.durationInPeriods = uint32(durationInPeriods);
    }

    function determineLateFeeAmount(address borrower, uint256 loanTrackedBalance) external view returns (uint256) {
        borrower; // To prevent compiler warning about unused variable

        // The equivalent formula: round(loanTrackedBalance * lateFeeRate / INTEREST_RATE_FACTOR)
        // Where division operator `/` takes into account the fractional part and
        // the `round()` function returns an integer rounded according to standard mathematical rules.
        uint256 product = loanTrackedBalance * _lateFeeRate;
        uint256 reminder = product % Constants.INTEREST_RATE_FACTOR;
        uint256 result = product / Constants.INTEREST_RATE_FACTOR;
        if (reminder >= (Constants.INTEREST_RATE_FACTOR / 2)) {
            ++result;
        }
        return result;
    }

    // ------------------ Pure functions -------------------------- //

    function proveCreditLine() external pure {}
}
