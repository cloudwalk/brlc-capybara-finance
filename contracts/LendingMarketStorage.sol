// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { Loan } from "./libraries/Loan.sol";

/// @title LendingMarketStorage contract
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Defines the storage layout for the lending market contract.
abstract contract LendingMarketStorage {
    // -------------------------------------------- //
    //  Storage variables                           //
    // -------------------------------------------- //

    /// @dev The loan identifier counter.
    uint256 internal _loanIdCounter;

    /// @dev The program identifier counter.
    uint32 internal _programIdCounter;

    /// @dev The mapping of loan id to its state.
    mapping(uint256 => Loan.State) internal _loans;

    /// @dev The mapping of credit line to associated lender.
    mapping(address => address) internal _creditLineLenders;

    /// @dev The mapping of liquidity pool to associated lender.
    mapping(address => address) internal _liquidityPoolLenders;

    /// @dev The mapping of program identifier to associated lender.
    mapping(uint32 => address) internal _programLenders;

    /// @dev The mapping of program identifier to associated credit line.
    mapping(uint32 => address) internal _programCreditLines;

    /// @dev The mapping of program identifier to associated liquidity pool.
    mapping(uint32 => address) internal _programLiquidityPools;

    /// @dev The mapping of lender to its aliases (True if alias exists).
    mapping(address => mapping(address => bool)) internal _hasAlias;

    /// @dev This empty reserved space is put in place to allow future versions
    /// to add new variables without shifting down storage in the inheritance chain.
    uint256[41] private __gap;
}
