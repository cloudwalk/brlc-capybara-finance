// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { Error } from "../libraries/Error.sol";
import { Loan } from "../libraries/Loan.sol";
import { ICreditLine } from "../interfaces/ICreditLine.sol";
import { ILiquidityPool } from "../interfaces/ILiquidityPool.sol";

/**
 * @title LendingMarketMock contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Mock of the `LendingMarket` contract used for testing.
 */
contract LendingMarketMock {
    // ------------------ Storage variables ----------------------- //

    mapping(uint256 => Loan.State) private _loanStates;

    // ------------------ Mock transactional functions ------------ //

    function mockLoanState(uint256 loanId, Loan.State memory state) external {
        _loanStates[loanId] = state;
    }

    function callOnBeforeLoanTakenCreditLine(address creditLine, uint256 loanId) external {
        ICreditLine(creditLine).onBeforeLoanTaken(loanId);
    }

    function callOnBeforeLoanReopenedCreditLine(address creditLine, uint256 loanId) external {
        ICreditLine(creditLine).onBeforeLoanReopened(loanId);
    }

    function callOnAfterLoanPaymentCreditLine(address creditLine, uint256 loanId, uint256 repaymentAmount) external {
        ICreditLine(creditLine).onAfterLoanPayment(loanId, repaymentAmount);
    }

    function callOnAfterLoanRevocationCreditLine(address creditLine, uint256 loanId) external {
        ICreditLine(creditLine).onAfterLoanRevocation(loanId);
    }

    function callOnBeforeLiquidityInLiquidityPool(address liquidityPool, uint256 amount) external {
        ILiquidityPool(liquidityPool).onBeforeLiquidityIn(amount);
    }

    function callOnBeforeLiquidityOutLiquidityPool(address liquidityPool, uint256 amount) external {
        ILiquidityPool(liquidityPool).onBeforeLiquidityOut(amount);
    }


    // ------------------ View functions -------------------------- //

    function getLoanState(uint256 loanId) external view returns (Loan.State memory) {
        return _loanStates[loanId];
    }

    // ------------------ Pure functions -------------------------- //

    function proveLendingMarket() external pure {}
}
