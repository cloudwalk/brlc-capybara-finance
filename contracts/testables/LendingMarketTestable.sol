// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { LendingMarket } from "../LendingMarket.sol";

/// @title LendingMarketTestable contract
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Version of the lending market contract with additions required for testing.
contract LendingMarketTestable is LendingMarket {
    // -------------------------------------------- //
    //  Storage variables                           //
    // -------------------------------------------- //

    /// @dev The maximum number of installments. Non-zero value overrides the constant in Constants.sol.
    uint256 public installmentCountMax;

    // -------------------------------------------- //
    //  Transactional functions                     //
    // -------------------------------------------- //

    /// @dev Calls the internal initialize function of the parent contract to check
    /// that the 'onlyInitializing' modifier is present.
    /// @param owner_ The address of the owner.
    function call_parent_initialize(address owner_) public {
        __LendingMarket_init(owner_);
    }

    /// @dev Calls the internal initialize_unchained function of the parent contract
    /// to check that the 'onlyInitializing' modifier is present.
    /// @param owner_ The address of the owner.
    function call_parent_initialize_unchained(address owner_) public {
        __LendingMarket_init_unchained(owner_);
    }

    /// @dev Sets a new loan ID counter for testing.
    /// @param newValue The new loan ID counter value.
    function setLoanIdCounter(uint256 newValue) external {
        _loanIdCounter = newValue;
    }

    /// @dev Sets a new lending program ID counter for testing.
    /// @param newValue The new lending program ID counter value.
    function setProgramIdCounter(uint32 newValue) external {
        _programIdCounter = newValue;
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

    /// @dev Set the zero addon amount for a batch of loans.
    /// @param loanIds The unique identifiers of the loans to zero the addon amount.
    function zeroAddonAmountBatch(uint256[] calldata loanIds) external {
        uint256 len = loanIds.length;
        for (uint256 i = 0; i < len; ++i) {
            _loans[loanIds[i]].addonAmount = 0;
        }
    }

    /// @dev Sets the admin role for a given role for testing purposes.
    /// @param role The role to set the admin for.
    /// @param adminRole The admin role to set.
    function setRoleAdmin(bytes32 role, bytes32 adminRole) external {
        _setRoleAdmin(role, adminRole);
    }

    /// @dev Checks if the account is an admin for testing purposes.
    /// @param account The address of the account to check.
    function checkIfAdmin(address account) external view {
        _checkIfAdmin(account);
    }

    /// @dev Sets the lender for a given program for testing purposes.
    /// @param programId The ID of the program.
    /// @param lender The address of the lender.
    function setProgramLender(uint32 programId, address lender) external {
        _programLenders[programId] = lender;
    }

    /// @dev Sets the lender for a given credit line for testing purposes.
    /// @param creditLine The address of the credit line.
    /// @param lender The address of the lender.
    function setCreditLineLender(address creditLine, address lender) external {
        _creditLineLenders[creditLine] = lender;
    }

    /// @dev Sets the lender for a given liquidity pool for testing purposes.
    /// @param liquidityPool The address of the liquidity pool.
    /// @param lender The address of the lender.
    function setLiquidityPoolLender(address liquidityPool, address lender) external {
        _liquidityPoolLenders[liquidityPool] = lender;
    }

    /// @dev Sets the alias for a given lender and account for testing purposes.
    /// @param lender The address of the lender.
    /// @param account The address of the account.
    /// @param hasAlias The boolean value to set.
    function setAlias(address lender, address account, bool hasAlias) external {
        _hasAlias[lender][account] = hasAlias;
    }

    /// @dev Gets the lender for a given program for testing purposes.
    /// @param programId The ID of the program.
    /// @return The address of the lender.
    function getProgramLender(uint32 programId) external view returns (address) {
        return _programLenders[programId];
    }

    /// @dev Gets the lender for a given credit line for testing purposes.
    /// @param creditLine The address of the credit line.
    /// @return The address of the lender.
    function getCreditLineLender(address creditLine) external view returns (address) {
        return _creditLineLenders[creditLine];
    }

    /// @dev Gets the lender for a given liquidity pool for testing purposes.
    /// @param liquidityPool The address of the liquidity pool.
    /// @return The address of the lender.
    function getLiquidityPoolLender(address liquidityPool) external view returns (address) {
        return _liquidityPoolLenders[liquidityPool];
    }

    /// @dev Checks if the account is an alias for a given lender for testing purposes.
    /// @param account The address of the account.
    /// @param lender The address of the lender.
    /// @return The boolean value indicating if the account is an alias.
    function isAlias(address account, address lender) external view returns (bool) {
        return _hasAlias[lender][account];
    }

    // -------------------------------------------- //
    //  Internal functions                          //
    // -------------------------------------------- //

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
