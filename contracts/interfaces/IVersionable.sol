// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/// @title IVersionable interface
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Defines the function of getting the contract version.
interface IVersionable {
    /// @dev The struct for the contract version.
    ///
    /// Fields:
    ///
    /// - major -- The major version of contract.
    /// - minor -- The minor version of contract.
    /// - patch -- The patch version of contract.
    struct Version {
        uint16 major;
        uint16 minor;
        uint16 patch;
    }

    /// @dev Returns the version of the contract.
    function $__VERSION() external pure returns (Version memory);
}
