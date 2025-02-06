// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

/// @title ILiquidityPoolPrimary interface
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev The primary part of the liquidity pool contract interface.
interface ILiquidityPoolPrimary {
    // -------------------------------------------- //
    //  Events                                      //
    // -------------------------------------------- //

    /// @dev Emitted when tokens are deposited to the liquidity pool.
    /// @param amount The amount of tokens deposited.
    event Deposit(uint256 amount);

    /// @dev Emitted when tokens are withdrawn from the liquidity pool.
    /// @param borrowableAmount The amount of tokens withdrawn from the borrowable balance.
    /// @param addonAmount Deprecated since version 1.8.0. This amount is always zero now.
    event Withdrawal(uint256 borrowableAmount, uint256 addonAmount);

    /// @dev Emitted when tokens are rescued from the liquidity pool.
    /// @param token The address of the token rescued.
    /// @param amount The amount of tokens rescued.
    event Rescue(address indexed token, uint256 amount);

    // -------------------------------------------- //
    //  Transactional functions                     //
    // -------------------------------------------- //

    /// @dev Deposits tokens to the liquidity pool.
    /// @param amount The amount of tokens to deposit.
    function deposit(uint256 amount) external;

    /// @dev Withdraws tokens from the liquidity pool.
    /// @param borrowableAmount The amount of tokens to withdraw from the borrowable balance.
    /// @param addonAmount This parameter has been deprecated since version 1.8.0 and must be zero.
    ///        See the {addonTreasury} function comments for more details.
    function withdraw(uint256 borrowableAmount, uint256 addonAmount) external;

    /// @dev Rescues tokens from the liquidity pool.
    /// @param token The address of the token to rescue.
    /// @param amount The amount of tokens to rescue.
    function rescue(address token, uint256 amount) external;

    // -------------------------------------------- //
    //  View and pure functions                     //
    // -------------------------------------------- //

    /// @dev Returns the address of the associated lending market.
    function market() external view returns (address);

    /// @dev Returns the address of the liquidity pool token.
    function token() external view returns (address);

    /// @dev Returns the addon treasury address.
    ///
    /// Previously, this address affected the pool logic.
    /// But since version 1.8.0, the ability to save the addon amount in the pool has become deprecated.
    /// Now the addon amount must always be output to an external wallet. The addon balance of the pool is always zero.
    ///
    /// @return The current address of the addon treasury.
    function addonTreasury() external view returns (address);

    /// @dev Gets the borrowable and addons balances of the liquidity pool.
    ///
    /// The addons part of the balance has been deprecated since version 1.8.0 and now it always equals zero.
    ///
    /// @return The borrowable and addons balances.
    function getBalances() external view returns (uint256, uint256);

    /// @dev Proves the contract is the liquidity pool one. A marker function.
    function proveLiquidityPool() external pure;
}

/// @title ILiquidityPoolConfiguration interface
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev The configuration part of the liquidity pool contract interface.
interface ILiquidityPoolConfiguration {
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

    // -------------------------------------------- //
    //  Transactional functions                     //
    // -------------------------------------------- //

    /// @dev Sets the addon treasury address.
    ///
    /// See the {addonTreasury} function comments for more details.
    ///
    /// @param newTreasury The new address of the addon treasury to set.
    function setAddonTreasury(address newTreasury) external;
}

/// @title ILiquidityPoolHooks interface
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev The hooks part of the liquidity pool contract interface.
interface ILiquidityPoolHooks {
    /// @dev A hook that is triggered by the associated market before a loan is taken.
    /// @param loanId The unique identifier of the loan being taken.
    function onBeforeLoanTaken(uint256 loanId) external;

    /// @dev A hook that is triggered by the associated market after the loan payment.
    /// @param loanId The unique identifier of the loan being paid.
    /// @param repaymentAmount The amount of tokens that was repaid.
    function onAfterLoanPayment(uint256 loanId, uint256 repaymentAmount) external;

    /// @dev A hook that is triggered by the associated market after the loan revocation.
    /// @param loanId The unique identifier of the loan being revoked.
    function onAfterLoanRevocation(uint256 loanId) external;
}

/// @title ILiquidityPoolErrors interface
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Defines the custom errors used in the liquidity poool contract.
interface ILiquidityPoolErrors {
    /// @dev Thrown when attempting to zero the addon treasury address.
    ///
    /// Zeroing the addon treasury address is prohibited because this can lead to a situation where
    /// a loan is taken when it is non-zero and revoked when it is zero, which will lead to
    /// an incorrect value of the `_addonsBalance` variable, or a reversion if `_addonsBalance == 0`.
    error AddonTreasuryAddressZeroingProhibited();

    /// @dev Thrown when the addon treasury has not provided an allowance for the lending market to transfer its tokens.
    error AddonTreasuryZeroAllowanceForMarket();

    /// @dev Thrown when the token source balance is insufficient.
    error InsufficientBalance();
}

/// @title ILiquidityPool interface
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Defines the liquidity pool contract functions and events.
interface ILiquidityPool is
    ILiquidityPoolPrimary,
    ILiquidityPoolConfiguration,
    ILiquidityPoolHooks,
    ILiquidityPoolErrors
{}
