// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { ICreditLineTypes } from "./interfaces/ICreditLineTypes.sol";

/// @title CreditLineStorage contract
/// @author CloudWalk Inc. (See https://www.cloudwalk.io)
/// @dev Defines the storage layout for the credit line contract.
abstract contract CreditLineStorage is ICreditLineTypes {
    /// @dev The address of the underlying token.
    address internal _token;

    /// @dev The address of the associated market.
    address internal _market;

    /// @dev The structure of the credit line configuration.
    CreditLineConfig internal _config; // 2 slots

    /// @dev The mapping of borrower to borrower configuration.
    mapping(address => BorrowerConfig) internal _borrowerConfigs;

    /// @dev The mapping of a borrower to the borrower state.
    mapping(address => BorrowerState) internal _borrowerStates;

    /// @dev This empty reserved space is put in place to allow future versions
    /// to add new variables without shifting down storage in the inheritance chain.
    uint256[45] private __gap;
}
