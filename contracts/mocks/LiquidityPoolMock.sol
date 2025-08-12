// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

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
