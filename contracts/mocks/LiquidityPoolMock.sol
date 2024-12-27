// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { Error } from "../common/libraries/Error.sol";
import { ILiquidityPool } from "../common/interfaces/core/ILiquidityPool.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ILendingMarket } from "../common/interfaces/core/ILendingMarket.sol";

/// @title LiquidityPoolMock contract
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Mock of the `LiquidityPool` contract used for testing.
contract LiquidityPoolMock is ILiquidityPool {
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

    function market() external pure returns (address) {
        revert Error.NotImplemented();
    }

    function lender() external pure returns (address) {
        revert Error.NotImplemented();
    }

    function token() external view returns (address) {
        return _tokenAddress;
    }

    function addonTreasury() external view returns (address) {
        return _addonTreasury;
    }

    // -------------------------------------------- //
    //  Mock functions                              //
    // -------------------------------------------- //

    function mockTokenAddress(address tokenAddress) external {
        _tokenAddress = tokenAddress;
    }

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
