// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { Rounding } from "../libraries/Rounding.sol";

/**
 * @title RoundingMock contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev A mock contract to test rounding functions.
 */
contract RoundingMock {
    /**
     * @dev Rounds a value to the nearest multiple of an accuracy according to mathematical rules.
     * @param value The value to be rounded.
     * @param accuracy The accuracy to which the value should be rounded.
     */
    function roundMath(uint256 value, uint256 accuracy) external pure returns (uint256) {
        return Rounding.roundMath(value, accuracy);
    }
}
