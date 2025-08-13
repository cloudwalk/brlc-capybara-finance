// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { LiquidityPool } from "../LiquidityPool.sol";

/**
 * @title LiquidityPoolTestable contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Version of the liquidity pool contract with additions required for testing.
 * @custom:oz-upgrades-unsafe-allow missing-initializer
 */
contract LiquidityPoolTestable is LiquidityPool {
    /**
     * @dev Sets the deprecated market address variable.
     *
     * @param newMarket The new market address.
     */
    function setMarket(address newMarket) external {
        _market = newMarket;
    }

    /**
     * @dev Gets the deprecated market address variable for testing purposes.
     *
     * @return The current market address.
     */
    function getMarket() external view returns (address) {
        return _market;
    }
}
