// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

/// @title Rounding library
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Defines upward and downward rounding functions.
library Rounding {
    /// @dev Rounds a value to the nearest multiple of an accuracy according to mathematical rules.
    /// @param value The value to be rounded.
    /// @param accuracy The accuracy to which the value should be rounded.
    function roundMath(uint256 value, uint256 accuracy) internal pure returns (uint256) {
        return ((value + accuracy / 2) / accuracy) * accuracy;
    }
}
