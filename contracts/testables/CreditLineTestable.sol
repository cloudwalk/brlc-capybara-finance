// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { CreditLine } from "../CreditLine.sol";

/// @title CreditLineTestable contract
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Version of the credit line contract with additions required for testing.
/// @custom:oz-upgrades-unsafe-allow missing-initializer
contract CreditLineTestable is CreditLine {
    /// @dev Sets the borrower state for testing purposes.
    /// @param borrower The address of the borrower.
    /// @param newState The new borrower state.
    function setBorrowerState(address borrower, BorrowerState calldata newState) external {
        _borrowerStates[borrower] = newState;
    }
}
