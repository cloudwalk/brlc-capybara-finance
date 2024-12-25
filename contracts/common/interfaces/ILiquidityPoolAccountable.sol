// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import "./core/ILiquidityPool.sol";

/// @title ILiquidityPoolAccountable interface
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Defines the accountable liquidity pool contract functions and events.
interface ILiquidityPoolAccountable is ILiquidityPool {
    // -------------------------------------------- //
    //  Events                                      //
    // -------------------------------------------- //

    /// @dev Emitted when the the addon treasury address has been changed.
    ///
    /// See the {addonTreasury} function comments for more details.
    ///
    /// @param newTreasury The updated address of the addon treasury.
    /// @param oldTreasury The previous address of the addon treasury.
    event AddonTreasuryChanged(address newTreasury, address oldTreasury);

    /// @dev Emitted when tokens are deposited to the liquidity pool.
    /// @param amount The amount of tokens deposited.
    event Deposit(uint256 amount);

    /// @dev Emitted when tokens are withdrawn from the liquidity pool.
    /// @param borrowableAmount The amount of tokens withdrawn from the borrowable balance.
    /// @param addonAmount The amount of tokens withdrawn from the addons balance.
    event Withdrawal(uint256 borrowableAmount, uint256 addonAmount);

    /// @dev Emitted when tokens are rescued from the liquidity pool.
    /// @param token The address of the token rescued.
    /// @param amount The amount of tokens rescued.
    event Rescue(address indexed token, uint256 amount);

    /// @dev Emitted when loan auto repayment was initiated.
    /// @param numberOfLoans The number of loans repaid.
    event AutoRepayment(uint256 numberOfLoans);

    // -------------------------------------------- //
    //  Functions                                   //
    // -------------------------------------------- //

    /// @dev Deposits tokens to the liquidity pool.
    /// @param amount The amount of tokens to deposit.
    function deposit(uint256 amount) external;

    /// @dev Withdraws tokens from the liquidity pool.
    /// @param borrowableAmount The amount of tokens to withdraw from the borrowable balance.
    /// @param addonAmount The amount of tokens to withdraw from the addons balance.
    function withdraw(uint256 borrowableAmount, uint256 addonAmount) external;

    /// @dev Rescues tokens from the liquidity pool.
    /// @param token The address of the token to rescue.
    /// @param amount The amount of tokens to rescue.
    function rescue(address token, uint256 amount) external;

    /// @dev Sets the addon treasury address.
    ///
    /// See the {addonTreasury} function comments for more details.
    ///
    /// @param newTreasury The new address of the addon treasury to set.
    function setAddonTreasury(address newTreasury) external;

    /// @dev Executes auto repayment of loans in the batch mode.
    /// @param loanIds The unique identifiers of the loans to repay.
    /// @param amounts The payment amounts that correspond with given loan ids.
    function autoRepay(uint256[] memory loanIds, uint256[] memory amounts) external;

    /// @dev Gets the borrowable and addons balances of the liquidity pool.
    ///
    /// The addons part of the balance is changes only if the addon amount of loans is retained on the pool contract.
    /// If the addon amount of loans transfers to an external addon treasury that part is kept unchanged.
    /// See the {addonTreasury} function comments for more details.
    ///
    /// @return The borrowable and addons balances.
    function getBalances() external view returns (uint256, uint256);

    /// @dev Checks whether an account is an admin.
    /// @param account The address of the account to check.
    /// @return True if the account is configured as an admin.
    function isAdmin(address account) external view returns (bool);
}
