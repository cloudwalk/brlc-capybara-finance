// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

/// @title LiquidityPoolStorage contract
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Defines the storage layout for the credit line contract.
abstract contract LiquidityPoolStorage {
    /// @dev The address of the underlying token.
    address internal _token;

    /// @dev The address of the associated market.
    address internal _market;

    /// @dev The borrowable balance of the liquidity pool.
    uint64 internal _borrowableBalance;

    /// @dev The addons balance of the liquidity pool.
    ///
    /// IMPORTANT! Deprecated since version 1.8.0. Now this variable is always zero.
    ///
    /// See the comments of the {_addonTreasury} storage variable for more details.
    uint64 internal _addonsBalance;

    /// @dev The address of the addon treasury.
    ///
    /// Previously, this address affected the pool logic.
    /// But since version 1.8.0, the ability to save the addon amount in the pool has become deprecated.
    /// Now the addon amount must always be output to an external wallet. The addon balance of the pool is always zero.
    address internal _addonTreasury;

    /// @dev This empty reserved space is put in place to allow future versions
    /// to add new variables without shifting down storage in the inheritance chain.
    uint256[46] private __gap;
}
