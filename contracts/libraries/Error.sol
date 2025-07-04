// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

/**
 * @title Error library
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines common error types used across the contracts.
 */
library Error {
    /// @dev Thrown when the caller is not authorized.
    error Unauthorized();

    /// @dev Thrown when the specified address is zero.
    error ZeroAddress();

    /// @dev Thrown when the specified amount is invalid.
    error InvalidAmount();

    /// @dev Thrown when the configuration is already applied.
    error AlreadyConfigured();

    /// @dev Thrown when array lengths do not match each other.
    error ArrayLengthMismatch();

    /// @dev Thrown if the provided new implementation address is not of a contract.
    error ImplementationAddressInvalid();

    /// @dev Thrown when the provided address does not belong to a contract of expected type or a contract at all.
    error ContractAddressInvalid();
}
