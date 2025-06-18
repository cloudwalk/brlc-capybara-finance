// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { ABDKMath64x64 } from "../libraries/ABDKMath64x64.sol";

/**
 * @title ABDKMath64x64Mock contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev A mock contract to test the ABDKMath64x64 lib functions
 */
contract ABDKMath64x64Mock {
    /**
     * @dev Convert unsigned 256-bit integer number into signed 64.64-bit fixed point number. Revert on overflow.
     * @param x unsigned 256-bit integer number
     * @return signed 64.64-bit fixed point number
     */
    function fromUInt(uint256 x) external pure returns (int128) {
        return ABDKMath64x64.fromUInt(x);
    }

    /**
     * @dev Calculate x * y rounding down. Revert on overflow.
     * @param x signed 64.64-bit fixed point number
     * @param y signed 64.64-bit fixed point number
     * @return signed 64.64-bit fixed point number
     */
    function mul(int128 x, int128 y) external pure returns (int128) {
        return ABDKMath64x64.mul(x, y);
    }

    /**
     * @dev Calculate x / y rounding towards zero. Revert on overflow or when y is zero.
     * @param x signed 64.64-bit fixed point number
     * @param y signed 64.64-bit fixed point number
     * @return signed 64.64-bit fixed point number
     */
    function div(int128 x, int128 y) external pure returns (int128) {
        return ABDKMath64x64.div(x, y);
    }

    /**
     * @dev Calculate x^y assuming 0^0 is 1, where x is signed 64.64 fixed point number
     * and y is unsigned 256-bit integer number. Revert on overflow.
     * @param x signed 64.64-bit fixed point number
     * @param y uint256 value
     * @return signed 64.64-bit fixed point number
     */
    function pow(int128 x, uint256 y) external pure returns (int128) {
        return ABDKMath64x64.pow(x, y);
    }
}
