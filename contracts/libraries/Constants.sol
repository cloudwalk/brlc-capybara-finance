// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

/// @title Constants library
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Defines the constants used across the contracts.
library Constants {
    /// @dev The loan period duration in seconds.
    uint256 internal constant PERIOD_IN_SECONDS = 24 hours;

    /// @dev The negative time offset applied to the loan period.
    uint256 internal constant NEGATIVE_TIME_OFFSET = 3 hours;

    /// @dev The rate factor used for the interest rate calculations.
    uint256 internal constant INTEREST_RATE_FACTOR = 10 ** 9;

    /// @dev The number of periods before which the loan can be revoked.
    uint256 internal constant COOLDOWN_IN_PERIODS = 3;

    /// @dev The accuracy factor used for loan amounts calculation.
    uint64 internal constant ACCURACY_FACTOR = 10000;

    /// @dev The maximum number of installments. Must not be greater than uint16
    uint256 internal constant INSTALLMENT_COUNT_MAX = 255;
}
