// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/// @title IERC20Mintable interface
/// @author CloudWalk Inc. (See https://www.cloudwalk.io)
/// @dev The interface of an ERC20 token smart contract that supports minting and burning tokens.
interface IERC20Mintable {
    /// @dev Mints tokens from reserve.
    ///
    /// Tokens are minted in a regular way, but we also increase the total reserve supply by the minted amount.
    ///
    /// @param account The address of a tokens recipient
    /// @param amount The amount of tokens to mint
    function mintFromReserve(address account, uint256 amount) external;

    /// @dev Burns tokens to reserve.
    ///
    /// Tokens are burned in a regular way, but we also decrease the total reserve supply by the burned amount.
    ///
    /// @param amount The amount of tokens to burn
    function burnToReserve(uint256 amount) external;
}
