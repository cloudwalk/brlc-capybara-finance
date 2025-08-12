// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title LiquidityPoolMock contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Mock of the `LiquidityPool` contract used for testing.
 */
contract LiquidityPoolMock {
    // ------------------ Storage variables ----------------------- //

    address private _addonTreasury;

    // ------------------ Events ---------------------------------- //

    event OnBeforeLiquidityInCalled(uint256 amount);
    event OnBeforeLiquidityOutCalled(uint256 amount);

    // ------------------ Hook transactional functions ------------ //

    function onBeforeLiquidityIn(uint256 amount) external {
        emit OnBeforeLiquidityInCalled(amount);
    }

    function onBeforeLiquidityOut(uint256 amount) external {
        emit OnBeforeLiquidityOutCalled(amount);
    }

    // ------------------ Mock transactional functions ------------ //

    function approveMaxTokenSpending(address spender, address token) external {
        IERC20(token).approve(spender, type(uint56).max);
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
