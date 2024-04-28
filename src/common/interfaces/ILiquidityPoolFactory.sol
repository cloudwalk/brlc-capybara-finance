// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

/// @title ILiquidityPoolFactory interface
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Defines the liquidity pool factory contract functions and events.
interface ILiquidityPoolFactory {
    // -------------------------------------------- //
    //  Events                                      //
    // -------------------------------------------- //

    /// @dev Emitted when a new liquidity pool is created.
    /// @param market The address of the lending market.
    /// @param lender The address of the liquidity pool lender.
    /// @param kind The kind of the created liquidity pool.
    /// @param liquidityPool The address of the created liquidity pool.
    event LiquidityPoolCreated(
        address indexed market, address indexed lender, uint16 indexed kind, address liquidityPool
    );

    // -------------------------------------------- //
    //  Functions                                   //
    // -------------------------------------------- //

    /// @dev Creates a new liquidity pool.
    /// @param market The address of the lending market.
    /// @param lender The address of the liquidity pool lender.
    /// @param kind The kind of liquidity pool to create.
    /// @param data The data to configure the liquidity pool.
    /// @return The address of the created liquidity pool.
    function createLiquidityPool(
        address market,
        address lender,
        uint16 kind,
        bytes calldata data
    ) external returns (address);

    /// @dev Returns the list of supported liquidity pool kinds.
    function supportedKinds() external view returns (uint16[] memory);
}
