// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { Loan } from "../../libraries/Loan.sol";

/// @title ILendingMarket interface
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Defines the lending market contract functions and events.
interface ILendingMarket {
    // -------------------------------------------- //
    //  Events                                      //
    // -------------------------------------------- //

    /// @dev Emitted when the lending market registry is changed.
    /// @param newRegistry The address of the new registry.
    /// @param oldRegistry The address of the old registry.
    event MarketRegistryChanged(address indexed newRegistry, address indexed oldRegistry);

    /// @dev Emitted when a liquidity pool is registered.
    /// @param lender The address of the liquidity pool lender.
    /// @param liquidityPool The address of the liquidity pool contract.
    event LiquidityPoolRegistered(address indexed lender, address indexed liquidityPool);

    /// @dev Emitted when a credit line is registered.
    /// @param lender The address of the credit line lender.
    /// @param creditLine The address of the credit line contract.
    event CreditLineRegistered(address indexed lender, address indexed creditLine);

    /// @dev Emitted when the lender of a liquidity pool is updated.
    /// @param liquidityPool The address of the liquidity pool.
    /// @param newLender The address of the new lender.
    /// @param oldLender The address of the old lender.
    event LiquidityPoolLenderUpdated(
        address indexed liquidityPool,
        address indexed newLender,
        address indexed oldLender
    );

    /// @dev Emitted when the lender of a credit line is updated.
    /// @param creditLine The address of the credit line.
    /// @param newLender The address of the new lender.
    /// @param oldLender The address of the old lender.
    event CreditLineLenderUpdated(
        address indexed creditLine,
        address indexed newLender,
        address indexed oldLender
    );

    /// @dev Emitted when a loan is taken.
    /// @param loanId The unique identifier of the loan.
    /// @param borrower The address of the borrower of the loan.
    /// @param borrowAmount The initial total amount of the loan, including the addon.
    /// @param durationInPeriods The duration of the loan in periods.
    event LoanTaken(
        uint256 indexed loanId,
        address indexed borrower,
        uint256 borrowAmount,
        uint256 durationInPeriods
    );

    /// @dev Emitted when a loan is repaid (fully or partially).
    /// @param loanId The unique identifier of the loan.
    /// @param repayer The address of the repayer (borrower or third-party).
    /// @param borrower The address of the borrower of the loan.
    /// @param repayAmount The amount of the repayment.
    /// @param outstandingBalance The outstanding balance of the loan after the repayment.
    event LoanRepayment(
        uint256 indexed loanId,
        address indexed repayer,
        address indexed borrower,
        uint256 repayAmount,
        uint256 outstandingBalance
    );

    /// @dev Emitted when a loan is frozen.
    /// @param loanId The unique identifier of the loan.
    event LoanFrozen(uint256 indexed loanId);

    /// @dev Emitted when a loan is unfrozen.
    /// @param loanId The unique identifier of the loan.
    event LoanUnfrozen(uint256 indexed loanId);

    /// @dev Emitted when a loan is cancelled.
    /// @param loanId The unique identifier of the loan.
    event LoanCancelled(uint256 indexed loanId);

    /// @dev Emitted when the duration of the loan is updated.
    /// @param loanId The unique identifier of the loan.
    /// @param newDuration The new duration of the loan in periods.
    /// @param oldDuration The old duration of the loan in periods.
    event LoanDurationUpdated(
        uint256 indexed loanId,
        uint256 indexed newDuration,
        uint256 indexed oldDuration
    );

    /// @dev Emitted when the primary interest rate of the loan is updated.
    /// @param loanId The unique identifier of the loan.
    /// @param newInterestRate The new primary interest rate of the loan.
    /// @param oldInterestRate The old primary interest rate of the loan.
    event LoanInterestRatePrimaryUpdated(
        uint256 indexed loanId,
        uint256 indexed newInterestRate,
        uint256 indexed oldInterestRate
    );

    /// @dev Emitted when the secondary interest rate of the loan is updated.
    /// @param loanId The unique identifier of the loan.
    /// @param newInterestRate The new secondary interest rate of the loan.
    /// @param oldInterestRate The old secondary interest rate of the loan.
    event LoanInterestRateSecondaryUpdated(
        uint256 indexed loanId,
        uint256 indexed newInterestRate,
        uint256 indexed oldInterestRate
    );

    /// @dev Emitted when a lender alias is configured.
    /// @param lender The address of the lender account.
    /// @param account The address of the alias account.
    /// @param isAlias True if the account is configured as an alias, otherwise false.
    event LenderAliasConfigured(
        address indexed lender,
        address indexed account,
        bool isAlias
    );

    /// @dev Emitted when a liquidity pool is assigned to a credit line.
    /// @param creditLine The address of the credit line.
    /// @param newLiquidityPool The address of the new liquidity pool.
    /// @param oldLiquidityPool The address of the old liquidity pool.
    event LiquidityPoolAssignedToCreditLine(
        address indexed creditLine,
        address indexed newLiquidityPool,
        address indexed oldLiquidityPool
    );

    // -------------------------------------------- //
    //  Borrower functions                          //
    // -------------------------------------------- //

    /// @dev Takes a loan.
    /// @param creditLine The address of the credit line to take the loan from.
    /// @param borrowAmount The desired amount of tokens to borrow.
    /// @param durationInPeriods The desired duration of the loan in periods.
    /// @return The unique identifier of the loan.
    function takeLoan(
        address creditLine,
        uint256 borrowAmount,
        uint256 durationInPeriods
    ) external returns (uint256);

    /// @dev Repays a loan.
    /// @param loanId The unique identifier of the loan to repay.
    /// @param repayAmount The amount to repay or `type(uint256).max` to repay the remaining balance of the loan.
    function repayLoan(uint256 loanId, uint256 repayAmount) external;

    // -------------------------------------------- //
    //  Lender functions                            //
    // -------------------------------------------- //

    /// @dev Freezes a loan.
    /// @param loanId The unique identifier of the loan to freeze.
    function freeze(uint256 loanId) external;

    /// @dev Unfreezes a loan.
    /// @param loanId The unique identifier of the loan to unfreeze.
    function unfreeze(uint256 loanId) external;

    /// @dev Updates the duration of a loan.
    /// @param loanId The unique identifier of the loan whose duration is to update.
    /// @param newDurationInPeriods The new duration of the loan, specified in periods.
    function updateLoanDuration(uint256 loanId, uint256 newDurationInPeriods) external;

    /// @dev Updates the primary interest rate of a loan.
    /// @param loanId The unique identifier of the loan whose primary interest rate is to update.
    /// @param newInterestRate The new primary interest rate of the loan.
    function updateLoanInterestRatePrimary(uint256 loanId, uint256 newInterestRate) external;

    /// @dev Updates the secondary interest rate of a loan.
    /// @param loanId The unique identifier of the loan whose secondary interest rate is to update.
    /// @param newInterestRate The new secondary interest rate of the loan.
    function updateLoanInterestRateSecondary(uint256 loanId, uint256 newInterestRate) external;

    /// @dev Registers a credit line.
    /// @param lender The address of the credit line lender.
    /// @param creditLine The address of the credit line.
    function registerCreditLine(address lender, address creditLine) external;

    /// @dev Registers a liquidity pool.
    /// @param lender The address of the liquidity pool lender.
    /// @param liquidityPool The address of the liquidity pool.
    function registerLiquidityPool(address lender, address liquidityPool) external;

    /// @dev Updates the lender of a given credit line.
    /// @param creditLine The address of the credit line to update.
    /// @param newLender The address of the new lender of the credit line.
    function updateCreditLineLender(address creditLine, address newLender) external;

    /// @dev Updates the lender of a given liquidity pool.
    /// @param liquidityPool The address of the liquidity pool to update.
    /// @param newLender The address of the new lender of the liquidity pool.
    function updateLiquidityPoolLender(address liquidityPool, address newLender) external;

    /// @dev Assigns a liquidity pool to a credit line.
    /// @param creditLine The address of the credit line.
    /// @param liquidityPool The address of the liquidity pool.
    function assignLiquidityPoolToCreditLine(address creditLine, address liquidityPool) external;

    /// @dev Configures an alias for a lender.
    /// @param account The address to configure as an alias.
    /// @param isAlias True if the account is an alias, otherwise false.
    function configureAlias(address account, bool isAlias) external;

    // -------------------------------------------- //
    //  Borrower and lender functions               //
    // -------------------------------------------- //

    /// @dev Cancels a loan.
    /// @param loanId The unique identifier of the loan to cancel.
    function cancelLoan(uint256 loanId) external;

    // -------------------------------------------- //
    //  View functions                              //
    // -------------------------------------------- //

    /// @dev Gets the lender of a credit line.
    /// @param creditLine The address of the credit line to check.
    /// @return The lender address of the credit line.
    function getCreditLineLender(address creditLine) external view returns (address);

    /// @dev Gets the lender of a liquidity pool.
    /// @param liquidityPool The address of the liquidity pool to check.
    /// @return The lender address of the liquidity pool.
    function getLiquidityPoolLender(address liquidityPool) external view returns (address);

    /// @dev Gets the liquidity pool assigned to a credit line.
    /// @param liquidityPool The address of the liquidity pool to check.
    /// @return The address of the credit line that the liquidity pool is assigned to.
    function getLiquidityPoolByCreditLine(address liquidityPool) external view returns (address);

    /// @dev Gets the stored state of a given loan.
    /// @param loanId The unique identifier of the loan to check.
    /// @return The stored state of the loan (see the Loan.State struct).
    function getLoanState(uint256 loanId) external view returns (Loan.State memory);

    /// @dev Gets the loan preview at a specific timestamp.
    /// @param loanId The unique identifier of the loan to check.
    /// @param timestamp The timestamp to get the loan preview for.
    /// @return The preview state of the loan (see the Loan.Preview struct).
    function getLoanPreview(uint256 loanId, uint256 timestamp) external view returns (Loan.Preview memory);

    /// @dev Checks if the provided account is a lender or an alias for a lender of a given loan.
    /// @param loanId The unique identifier of the loan to check.
    /// @param account The address to check whether it's a lender or an alias.
    function isLenderOrAlias(uint256 loanId, address account) external view returns (bool);

    /// @dev Checks if the provided account is an alias for a lender.
    /// @param lender The address of the lender to check alias for.
    /// @param account The address to check whether it's an alias or not.
    /// @return True if the account is an alias for the lender, otherwise false.
    function hasAlias(address lender, address account) external view returns (bool);

    /// @dev Returns the rate factor used to for interest rate calculations.
    function interestRateFactor() external view returns (uint256);

    /// @dev Returns the duration of a loan period specified in seconds.
    function periodInSeconds() external view returns (uint256);

    /// @dev Returns time offset and whether it's positive or negative.
    /// The time offset is used to adjust current period of the loan.
    function timeOffset() external view returns (uint256, bool);

    /// @dev Returns the address of the lending market registry.
    function registry() external view returns (address);
}
