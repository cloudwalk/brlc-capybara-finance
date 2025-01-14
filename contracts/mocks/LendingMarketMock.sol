// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { Error } from "../libraries/Error.sol";
import { Loan } from "../libraries/Loan.sol";
import { ICreditLine } from "../interfaces/ICreditLine.sol";
import { ILiquidityPool } from "../interfaces/ILiquidityPool.sol";

/// @title LendingMarketMock contract
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Mock of the `LendingMarket` contract used for testing.
contract LendingMarketMock {
    // -------------------------------------------- //
    //  Events                                      //
    // -------------------------------------------- //

    event RepayLoanCalled(uint256 indexed loanId, uint256 repayAmount, uint256 repaymentCounter);
    event HookCallResult(bool result);

    // -------------------------------------------- //
    //  Storage variables                           //
    // -------------------------------------------- //

    mapping(uint256 => Loan.State) private _loanStates;
    uint256 public repaymentCounter;

    // -------------------------------------------- //
    //  ILendingMarket functions                    //
    // -------------------------------------------- //

    function repayLoan(uint256 loanId, uint256 repayAmount) external {
        loanId; // To prevent compiler warning about unused variable
        repayAmount; // To prevent compiler warning about unused variable
        ++repaymentCounter;
        emit RepayLoanCalled(loanId, repayAmount, repaymentCounter);
    }

    function getLoanState(uint256 loanId) external view returns (Loan.State memory) {
        return _loanStates[loanId];
    }

    // -------------------------------------------- //
    //  Mock functions                              //
    // -------------------------------------------- //

    function mockLoanState(uint256 loanId, Loan.State memory state) external {
        _loanStates[loanId] = state;
    }

    function callOnBeforeLoanTakenLiquidityPool(address liquidityPool, uint256 loanId) external {
        emit HookCallResult(ILiquidityPool(liquidityPool).onBeforeLoanTaken(loanId));
    }

    function callOnBeforeLoanTakenCreditLine(address creditLine, uint256 loanId) external {
        emit HookCallResult(ICreditLine(creditLine).onBeforeLoanTaken(loanId));
    }

    function callOnAfterLoanPaymentLiquidityPool(address liquidityPool, uint256 loanId, uint256 amount) external {
        emit HookCallResult(ILiquidityPool(liquidityPool).onAfterLoanPayment(loanId, amount));
    }

    function callOnAfterLoanPaymentCreditLine(address creditLine, uint256 loanId, uint256 repayAmount) external {
        emit HookCallResult(ICreditLine(creditLine).onAfterLoanPayment(loanId, repayAmount));
    }

    function callOnAfterLoanRevocationLiquidityPool(address liquidityPool, uint256 loanId) external {
        emit HookCallResult(ILiquidityPool(liquidityPool).onAfterLoanRevocation(loanId));
    }

    function callOnAfterLoanRevocationCreditLine(address creditLine, uint256 loanId) external {
        emit HookCallResult(ICreditLine(creditLine).onAfterLoanRevocation(loanId));
    }
}
