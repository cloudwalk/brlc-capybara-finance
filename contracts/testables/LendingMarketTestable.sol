// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { LendingMarket } from "../LendingMarket.sol";

/// @title LendingMarketTestable contract
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Version of the lending market contract with additions required for testing.
contract LendingMarketTestable is LendingMarket {
    /// @dev The maximum number of installments. Non-zero value overrides the constant in Constants.sol.
    uint256 public installmentCountMax;

    /// @dev Sets a new loan ID counter for testing.
    /// @param newValue The new loan ID counter value.
    function setLoanIdCounter(uint256 newValue) external {
        _loanIdCounter = newValue;
    }

    /// @dev Sets a new credit line address for a lending program.
    /// @param programId The ID of the lending program.
    /// @param newCreditLine The new address of the credit line to set.
    function setCreditLineForProgram(uint32 programId, address newCreditLine) external {
        _programCreditLines[programId] = newCreditLine;
    }

    /// @dev Sets a new liquidity pool address for a lending program.
    /// @param programId The ID of the lending program.
    /// @param newLiquidityPool The new address of the liquidity pool to set.
    function setLiquidityPoolForProgram(uint32 programId, address newLiquidityPool) external {
        _programLiquidityPools[programId] = newLiquidityPool;
    }

    /// @dev Sets a new maximum number of installments. Non-zero value overrides the constant in Constants.sol.
    /// @param newValue The new maximum number of installments.
    function setInstallmentCountMax(uint256 newValue) external {
        installmentCountMax = newValue;
    }

    /// @dev Overrides the same name function in the lending market contract to return the testable value if set.
    /// @return The maximum number of installments.
    function _installmentCountMax() internal view override returns (uint256) {
        if (installmentCountMax == 0) {
            return super._installmentCountMax();
        } else {
            return installmentCountMax;
        }
    }
}
