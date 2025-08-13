// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

/**
 * @title ILiquidityPoolPrimary interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The primary part of the liquidity pool contract interface.
 */
interface ILiquidityPoolPrimary {
    // ------------------ Events ---------------------------------- //

    /**
     * @dev Emitted when tokens are deposited to the liquidity pool.
     * @param amount The amount of tokens deposited.
     */
    event Deposit(uint256 amount);

    /**
     * @dev Emitted when tokens are withdrawn from the liquidity pool.
     * @param borrowableAmount The amount of tokens withdrawn from the borrowable balance.
     * @param addonAmount Deprecated since version 1.8.0. This amount is always zero now.
     */
    event Withdrawal(uint256 borrowableAmount, uint256 addonAmount);

    /**
     * @dev Emitted when tokens are rescued from the liquidity pool.
     * @param token The address of the token rescued.
     * @param amount The amount of tokens rescued.
     */
    event Rescue(address indexed token, uint256 amount);

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Deposits tokens to the liquidity pool from the caller account.
     * @param amount The amount of tokens to deposit.
     */
    function deposit(uint256 amount) external;

    /**
     * @dev Deposits tokens to the liquidity pool from the operational treasury.
     * @param amount The amount of tokens to deposit.
     */
    function depositFromOperationalTreasury(uint256 amount) external;

    /**
     * @dev Deposits tokens to the liquidity pool by minting them from the reserve
     * using a special function of the underlying token smart-contract.
     *
     * To use this function this contract must be granted an appropriate role on the token contract.
     *
     * @param amount The amount of tokens to mint and deposit.
     */
    function depositFromReserve(uint256 amount) external;

    /**
     * @dev Withdraws tokens from the liquidity pool to the caller account.
     * @param borrowableAmount The amount of tokens to withdraw from the borrowable balance.
     * @param addonAmount This parameter has been deprecated since version 1.8.0 and must be zero.
     * See the {addonTreasury} function comments for more details.
     */
    function withdraw(uint256 borrowableAmount, uint256 addonAmount) external;

    /**
     * @dev Withdraws tokens from the liquidity pool to the operational treasury.
     * @param amount The amount of tokens to withdraw from the borrowable balance.
     */
    function withdrawToOperationalTreasury(uint256 amount) external;

    /**
     * @dev Withdraws tokens from the liquidity pool by burning them to the reserve
     *       using a special function of the underlying token smart-contract.
     *
     * To use this function this contract must be granted an appropriate role on the token contract.
     *
     * @param amount The amount of tokens to withdraw from the borrowable balance and burn.
     */
    function withdrawToReserve(uint256 amount) external;

    /**
     * @dev Rescues tokens from the liquidity pool.
     * @param token The address of the token to rescue.
     * @param amount The amount of tokens to rescue.
     */
    function rescue(address token, uint256 amount) external;

    // ------------------ View functions -------------------------- //

    /// @dev Returns the address of the liquidity pool token.
    function token() external view returns (address);

    /**
     * @dev Returns the addon treasury address.
     *
     * Previously, this address affected the pool logic.
     * But since version 1.8.0, the ability to save the addon amount in the pool has become deprecated.
     * Now the addon amount must always be output to an external wallet. The addon balance of the pool is always zero.
     *
     * @return The current address of the addon treasury.
     */
    function addonTreasury() external view returns (address);

    /**
     * @dev Returns the operational treasury address.
     *
     * The operational treasury is used to deposit and withdraw tokens through special functions.
     *
     * @return The current address of the operational treasury.
     */
    function operationalTreasury() external view returns (address);

    /**
     * @dev Gets the borrowable and addons balances of the liquidity pool.
     *
     * The addons part of the balance has been deprecated since version 1.8.0 and now it always equals zero.
     *
     * @return The borrowable and addons balances.
     */
    function getBalances() external view returns (uint256, uint256);
}

/**
 * @title ILiquidityPoolConfiguration interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The configuration part of the liquidity pool contract interface.
 */
interface ILiquidityPoolConfiguration {
    // ------------------ Events ---------------------------------- //

    /**
     * @dev Emitted when the addon treasury address has been changed.
     *
     * See the {addonTreasury} function comments for more details.
     *
     * @param newTreasury The updated address of the addon treasury.
     * @param oldTreasury The previous address of the addon treasury.
     */
    event AddonTreasuryChanged(address newTreasury, address oldTreasury);

    /**
     * @dev Emitted when the operational treasury address has been changed.
     *
     * See the {operationalTreasury} function comments for more details.
     *
     * @param newTreasury The updated address of the operational treasury.
     * @param oldTreasury The previous address of the operational treasury.
     */
    event OperationalTreasuryChanged(address newTreasury, address oldTreasury);

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Sets the addon treasury address.
     *
     * See the {addonTreasury} function comments for more details.
     *
     * @param newTreasury The new address of the addon treasury to set.
     */
    function setAddonTreasury(address newTreasury) external;

    /**
     * @dev Sets the operational treasury address.
     *
     * See the {operationalTreasury} function comments for more details.
     *
     * @param newTreasury The new address of the operational treasury to set.
     */
    function setOperationalTreasury(address newTreasury) external;

    /**
     * @dev Approves a spender to spend tokens on behalf of the liquidity pool contract.
     *
     * It is expected to use for managing the allowance of liquidity operators in the case
     * there is not trustable functionality on the underlying token contract.
     *
     * @param spender The address of the spender to approve on the underlying token.
     * @param newAllowance The new allowance amount to set for the spender.
     */
    function approveSpender(address spender, uint256 newAllowance) external;
}

/**
 * @title ILiquidityPoolHooks interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The hooks part of the liquidity pool contract interface.
 */
interface ILiquidityPoolHooks {
    /**
     * @dev Hook function that must be called before tokens are transferred into the pool.
     *
     * Checks whether the transfer will not break the pool balance.
     * Updates the internal borrowable balance to reflect the incoming liquidity.
     *
     * @param amount The amount of tokens to be transferred into the pool.
     */
    function onBeforeLiquidityIn(uint256 amount) external;

    /**
     * @dev Hook function that must be called before tokens are transferred out of the pool.
     *
     * Checks whether the transfer will not break the pool balance.
     * Updates the internal borrowable balance to reflect the outgoing liquidity.
     *
     * @param amount The amount of tokens to be transferred out of the pool.
     */
    function onBeforeLiquidityOut(uint256 amount) external;
}

/**
 * @title ILiquidityPoolErrors interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the custom errors used in the liquidity pool contract.
 */
interface ILiquidityPoolErrors {
    /**
     * @dev Thrown when attempting to zero the addon treasury address.
     *
     * Zeroing the addon treasury address is prohibited because this can lead to a situation where
     * a loan is taken when it is non-zero and revoked when it is zero, which will lead to
     * an incorrect value of the `_addonsBalance` variable, or a reversion if `_addonsBalance == 0`.
     */
    error AddonTreasuryAddressZeroingProhibited();

    /// @dev Thrown when the addon treasury has not provided an allowance for the lending market to transfer its tokens.
    error AddonTreasuryZeroAllowanceForMarket();

    /// @dev Thrown when a deposit would cause the pool balance to exceed its maximum allowed value.
    error BalanceExcess();

    /// @dev Thrown when the liquidity pool balance is insufficient to cover moving liquidity out of the pool.
    error BalanceInsufficient();

    /// @dev Thrown when the operational treasury address is zero.
    error OperationalTreasuryAddressZero();

    /// @dev Thrown when the operational treasury has not provided an allowance for the pool to transfer its tokens.
    error OperationalTreasuryZeroAllowanceForPool();
}

/**
 * @title ILiquidityPool interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the liquidity pool contract functions and events.
 */
interface ILiquidityPool is
    ILiquidityPoolPrimary,
    ILiquidityPoolConfiguration,
    ILiquidityPoolHooks,
    ILiquidityPoolErrors
{
    /// @dev Proves the contract is the liquidity pool one. A marker function.
    function proveLiquidityPool() external pure;
}
