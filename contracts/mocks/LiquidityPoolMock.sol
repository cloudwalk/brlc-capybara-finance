// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { Error } from "../libraries/Error.sol";
import { ILendingMarket } from "../interfaces/ILendingMarket.sol";

/// @title LiquidityPoolMock contract
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Mock of the `LiquidityPool` contract used for testing.
contract LiquidityPoolMock {
    // -------------------------------------------- //
    //  Events                                      //
    // -------------------------------------------- //

    event OnBeforeLoanTakenCalled(uint256 indexed loanId);

    event OnAfterLoanPaymentCalled(uint256 indexed loanId, uint256 indexed repayAmount);

    event OnAfterLoanRevocationCalled(uint256 indexed loanId);

    // -------------------------------------------- //
    //  Storage variables                           //
    // -------------------------------------------- //

    bool private _onBeforeLoanTakenResult;

    bool private _onAfterLoanPaymentResult;

    bool private _onAfterLoanRevocationResult;

    address private _addonTreasury;

    // -------------------------------------------- //
    //  ILiquidityPool functions                    //
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

    function addonTreasury() external view returns (address) {
        return _addonTreasury;
    }

    // -------------------------------------------- //
    //  Mock functions                              //
    // -------------------------------------------- //

    function approveMarket(address _market, address token_) external {
        IERC20(token_).approve(_market, type(uint56).max);
    }

    function mockAddonTreasury(address newTreasury) external {
        _addonTreasury = newTreasury;
    }

    function proveLiquidityPool() external pure {}

    function repayLoan(address _market, uint256 loanId, uint256 amount) external {
        ILendingMarket(_market).repayLoan(loanId, amount);
    }
}
