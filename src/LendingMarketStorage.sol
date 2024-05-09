// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { Loan } from "src/common/libraries/Loan.sol";

/// @title LendingMarketStorage contract
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Defines the storage layout for the lending market contract.
abstract contract LendingMarketStorage {
    // -------------------------------------------- //
    //  Storage variables                           //
    // -------------------------------------------- //

    /// @dev The counter of loans.
    uint256 internal _loanIdCounter;

    /// @dev The mapping of loan identifier to loan state.
    mapping(uint256 => Loan.State) internal _loans;

    mapping(uint256 => address) internal _loanLenders;

    /// @dev The mapping of credit line to associated lender.
    mapping(address => address) internal _creditLineLenders;

    /// @dev The mapping of liquidity pool to associated lender.
    mapping(address => address) internal _liquidityPoolLenders;

    /// @dev The mapping of credit line to associated liquidity pool.
    mapping(address => address) internal _liquidityPoolByCreditLine;

    /// @dev The mapping of lender to its aliases (True if alias exists).
    mapping(address => mapping(address => bool)) internal _hasAlias;

    /// @dev This empty reserved space is put in place to allow future versions
    /// to add new variables without shifting down storage in the inheritance chain.
    uint256[43] private __gap;
}
