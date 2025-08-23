// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title LiquidityPoolStorage contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the storage layout for the liquidity pool contract.
 */
abstract contract LiquidityPoolStorage {
    /// @dev The address of the underlying token.
    address internal _token;

    /**
     * @dev [DEPRECATED] The address of the associated market. Not in use since version 1.16.0.
     * It has been set to zero for already deployed contracts during the migration procedure.
     */
    address internal _market;

    /// @dev The borrowable balance of the liquidity pool.
    uint64 internal _borrowableBalance;

    /**
     * @dev [DEPRECATED] The addons balance of the liquidity pool.
     *
     * IMPORTANT! Deprecated since version 1.8.0. Now this variable is always zero.
     *
     * See the comments of the {_addonTreasury} storage variable for more details.
     */
    uint64 internal _addonsBalance;

    /**
     * @dev The address of the addon treasury.
     *
     * Previously, this address affected the pool logic.
     * But since version 1.8.0, the ability to save the addon amount in the pool has become deprecated.
     * Now the addon amount must always be output to an external wallet. The addon balance of the pool is always zero.
     */
    address internal _addonTreasury;

    /**
     * @dev The address of the operational treasury.
     *
     * The operational treasury is used to deposit and withdraw tokens through special functions.
     */
    address internal _operationalTreasury;

    /// @dev TODO
    EnumerableSet.AddressSet internal _workingTreasures;

    /**
     * @dev This empty reserved space is put in place to allow future versions
     * to add new variables without shifting down storage in the inheritance chain.
     */
    uint256[43] private __gap;
}
