// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

/// @title ILiquidityPool interface
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Defines the liquidity pool contract functions and events.
interface ILiquidityPool {
    // -------------------------------------------- //
    //  Functions                                   //
    // -------------------------------------------- //

    /// @dev A hook that is triggered by the associated market before a loan is taken.
    /// @param loanId The unique identifier of the loan being taken.
    function onBeforeLoanTaken(uint256 loanId) external returns (bool);

    /// @dev A hook that is triggered by the associated market after the loan payment.
    /// @param loanId The unique identifier of the loan being paid.
    /// @param repayAmount The amount of tokens that was repaid.
    function onAfterLoanPayment(uint256 loanId, uint256 repayAmount) external returns (bool);

    /// @dev A hook that is triggered by the associated market after the loan revocation.
    /// @param loanId The unique identifier of the loan being revoked.
    function onAfterLoanRevocation(uint256 loanId) external returns (bool);

    /// @dev Returns the address of the associated lending market.
    function market() external view returns (address);

    /// @dev Returns the address of the liquidity pool token.
    function token() external view returns (address);

    /// @dev Returns the addon treasury address.
    ///
    /// If the address is zero the addon amount of a loan is retained in the pool.
    /// Otherwise the addon amount transfers to that treasury when a loan is taken and back when a loan is revoked.
    ///
    /// @return The current address of the addon treasury.
    function addonTreasury() external view returns (address);

    /// @dev Proves the contract is the liquidity pool one. A marker function.
    function proveLiquidityPool() external pure;
}
