// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { LendingMarket } from "../LendingMarket.sol";

/**
 * @title LendingMarketTestable contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Version of the lending market contract with additions required for testing.
 * @custom:oz-upgrades-unsafe-allow missing-initializer
 */
contract LendingMarketTestable is LendingMarket {
    // ------------------ Storage variables ----------------------- //

    /// @dev The maximum number of installments. Non-zero value overrides the constant in Constants.sol.
    uint256 public installmentCountMax;

    /// @dev Flag to allow any amount for loans in test purposes.
    bool public areAnyAmountsAllowed;

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Sets a new loan ID counter for testing.
     * @param newValue The new loan ID counter value.
     */
    function setLoanIdCounter(uint256 newValue) external {
        _loanIdCounter = newValue;
    }

    /**
     * @dev Sets a new lending program ID counter for testing.
     * @param newValue The new lending program ID counter value.
     */
    function setProgramIdCounter(uint32 newValue) external {
        _programIdCounter = newValue;
    }

    /**
     * @dev Sets a new credit line address for a lending program.
     * @param programId The ID of the lending program.
     * @param newCreditLine The new address of the credit line to set.
     */
    function setCreditLineForProgram(uint32 programId, address newCreditLine) external {
        _programCreditLines[programId] = newCreditLine;
    }

    /**
     * @dev Sets a new liquidity pool address for a lending program.
     * @param programId The ID of the lending program.
     * @param newLiquidityPool The new address of the liquidity pool to set.
     */
    function setLiquidityPoolForProgram(uint32 programId, address newLiquidityPool) external {
        _programLiquidityPools[programId] = newLiquidityPool;
    }

    /**
     * @dev Sets a new maximum number of installments. Non-zero value overrides the constant in Constants.sol.
     * @param newValue The new maximum number of installments.
     */
    function setInstallmentCountMax(uint256 newValue) external {
        installmentCountMax = newValue;
    }

    /**
     * @dev Set the zero addon amount for a batch of loans.
     * @param loanIds The unique identifiers of the loans to zero the addon amount.
     */
    function zeroAddonAmountBatch(uint256[] calldata loanIds) external {
        uint256 len = loanIds.length;
        for (uint256 i = 0; i < len; ++i) {
            _loans[loanIds[i]].addonAmount = 0;
        }
    }

    /// @dev Allow any amounts for a batch of loans.
    function allowAnyAmounts() external {
        areAnyAmountsAllowed = true;
    }

    /**
     * @dev Freeze a batch of loans.
     * @param loanIds The unique identifiers of the loans to freeze.
     */
    function freezeBatch(uint256[] calldata loanIds) external {
        uint256 len = loanIds.length;
        _grantRole(ADMIN_ROLE, address(this));
        for (uint256 i = 0; i < len; ++i) {
            this.freeze(loanIds[i]);
        }
    }

    // ------------------ Internal functions ---------------------- //

    /**
     * @dev Overrides the same name function in the lending market contract to return the testable value if set.
     * @return The maximum number of installments.
     */
    function _installmentCountMax() internal view override returns (uint256) {
        if (installmentCountMax == 0) {
            return super._installmentCountMax();
        } else {
            return installmentCountMax;
        }
    }

    /**
     * @dev Overrides the same name function in the lending market contract to allow zero amounts if the flag is set.
     * @param changeAmount The amount of change in the tracked balance.
     */
    function _checkTrackedBalanceChange(uint256 changeAmount) internal view override {
        if (!areAnyAmountsAllowed) {
            super._checkTrackedBalanceChange(changeAmount);
        } else {
            // just do nothing and allow any amounts
        }
    }
}
