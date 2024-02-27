// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

import {Interest} from "./Interest.sol";

/// @title Loan library
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @notice Defines loan related structs and enums
library Loan {
    /// @notice A struct that defines the state of the loan
    struct State {
        //slot 1
        /// @notice The address of the token used in the loan
        address token;
        /// @notice The primary interest rate that is applied to the loan
        uint32 interestRatePrimary;
        /// @notice The secondary interest rate that is applied to the loan
        uint32 interestRateSecondary;
        /// @notice The rate factor used together with interest rate
        uint32 interestRateFactor;
        //slot 2
        /// @notice The address of the borrower
        address borrower;
        /// @notice The start date of the loan
        uint32 startDate;
        /// @notice The initial principal amount of the loan
        uint64 initialBorrowAmount;
        //slot 3
        /// @notice The duration of the loan period specified in seconds
        uint32 periodInSeconds;
        /// @notice The total duration of the loan determined by the number of periods
        uint32 durationInPeriods;
        /// @notice The updated loan amount after the last repayment
        uint64 trackedBorrowAmount;
        /// @notice The date of the last repayment
        uint32 trackedDate;
        /// @notice The date when the loan was frozen
        uint32 freezeDate;
        /// @notice Whether the loan can be repaid automatically
        bool autoRepayment;
        /// @notice The formula used for interest calculation on the loan
        Interest.Formula interestFormula;
        //slot 4
        /// @notice The address of the loan holder
        address holder;
    }

    /// @notice A struct that defines the terms of the loan
    struct Terms {
        //slot 1
        /// @notice The address of the token to be used in the loan
        address token;
        /// @notice The duration of the loan period specified in seconds
        uint32 periodInSeconds;
        /// @notice The total duration of the loan determined by the number of periods
        uint32 durationInPeriods;
        /// @notice The rate factor used together with interest rate
        uint32 interestRateFactor;
        //slot 2
        /// @notice The address of the recipient of additional payments and fees
        address addonRecipient;
        /// @notice The amount of additional payments and fees
        uint64 addonAmount;
        /// @notice The primary interest rate to be applied to the loan
        uint32 interestRatePrimary;
        //slot 3
        /// @notice The secondary interest rate to be applied to the loan
        uint32 interestRateSecondary;
        /// @notice Whether the loan can be repaid automatically
        bool autoRepayment;
        /// @notice The formula to be used for interest calculation on the loan
        Interest.Formula interestFormula;
        //slot 4
        /// @notice The address of the loan holder
        address holder;
    }

    /// @notice A struct that defines the preview of the loan
    struct Preview {
        /// @notice The period date that the loan is previewed for
        uint256 periodDate;
        /// @notice The outstanding balance of the loan at previewed period
        uint256 outstandingBalance;
    }
}
