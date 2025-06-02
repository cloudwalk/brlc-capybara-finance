// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { Error } from "../libraries/Error.sol";
import { ILendingMarket } from "../interfaces/ILendingMarket.sol";

/// @title LiquidityPoolMock contract
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Mock of the `LiquidityPool` contract used for testing.
contract LiquidityPoolMock {
    // ------------------ Storage variables ----------------------- //

    address private _addonTreasury;

    // ------------------ Events ---------------------------------- //

    event OnBeforeLoanTakenCalled(uint256 indexed loanId);
    event OnAfterLoanPaymentCalled(uint256 indexed loanId, uint256 indexed repaymentAmount);
    event OnAfterLoanRepaymentUndoingCalled(uint256 indexed loanId, uint256 indexed repaymentAmount);
    event OnAfterLoanRevocationCalled(uint256 indexed loanId);

    // ------------------ Hook transactional functions ------------ //

    function onBeforeLoanTaken(uint256 loanId) external {
        emit OnBeforeLoanTakenCalled(loanId);
    }

    function onAfterLoanPayment(uint256 loanId, uint256 repaymentAmount) external {
        emit OnAfterLoanPaymentCalled(loanId, repaymentAmount);
    }

    function onAfterLoanRepaymentUndoing(uint256 loanId, uint256 repaymentAmount) external {
        emit OnAfterLoanRepaymentUndoingCalled(loanId, repaymentAmount);
    }

    function onAfterLoanRevocation(uint256 loanId) external {
        emit OnAfterLoanRevocationCalled(loanId);
    }

    // ------------------ Mock transactional functions ------------ //

    function approveMarket(address _market, address token_) external {
        IERC20(token_).approve(_market, type(uint56).max);
    }

    function mockAddonTreasury(address newTreasury) external {
        _addonTreasury = newTreasury;
    }

    // ------------------ View functions -------------------------- //

    function addonTreasury() external view returns (address) {
        return _addonTreasury;
    }

    // ------------------ Pure functions -------------------------- //

    function proveLiquidityPool() external pure {}
}
