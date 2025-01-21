// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { ABDKMath64x64 } from "./ABDKMath64x64.sol";

/// @title InterestMath library
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Defines interest calculation functions.
library InterestMath {
    /// @dev Calculates the tracked balance of a loan using the compound interest formula.
    /// @param originalBalance The original balance of the loan.
    /// @param numberOfPeriods The number of periods since the loan was taken.
    /// @param interestRate The interest rate applied to the loan.
    /// @param interestRateFactor The interest rate factor.
    /// @return trackedBalance The tracked balance of the loan.
    function calculateTrackedBalance(
        uint256 originalBalance,
        uint256 numberOfPeriods,
        uint256 interestRate,
        uint256 interestRateFactor
    ) internal pure returns (uint256 trackedBalance) {
        // The equivalent formula: round(originalBalance * (1 + interestRate / interestRateFactor)^numberOfPeriods)
        // Where division operator `/` and power operator `^` take into account the fractional part and
        // the `round()` function returns an integer rounded according to standard mathematical rules.
        int128 onePlusRateValue = ABDKMath64x64.div(
            ABDKMath64x64.fromUInt(interestRateFactor + interestRate),
            ABDKMath64x64.fromUInt(interestRateFactor)
        );
        int128 powValue = ABDKMath64x64.pow(onePlusRateValue, numberOfPeriods);
        int128 originalBalanceValue = ABDKMath64x64.fromUInt(originalBalance);
        uint256 unroundedResult = uint256(uint128(ABDKMath64x64.mul(powValue, originalBalanceValue)));
        trackedBalance = unroundedResult >> 64;
        if ((unroundedResult - (trackedBalance << 64)) >= (1 << 63)) {
            trackedBalance += 1;
        }
    }
}
