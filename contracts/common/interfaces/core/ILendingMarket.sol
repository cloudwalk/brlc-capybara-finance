// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { Loan } from "../../libraries/Loan.sol";

/// @title ILendingMarket interface
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Defines the lending market contract functions and events.
///
/// The lending market supports two types of loans:
///
/// 1. Ordinary Loans:
/// - A single, standalone loan.
/// - Represented by one loan entity on the smart-contract side with a unique ID.
/// - Has `firstInstallmentId` and `installmentCount` set to 0 in the loan structure.
///
/// 2. Installment Loans:
/// - A loan split into multiple installments (sub-loans).
/// - Each installment is a separate loan entity on the smart-contract side with its own unique ID.
/// - All installments are represented by the same loan structure as ordinary loans.
/// - The `firstInstallmentId` field stores the ID of the first installment.
/// - The `installmentCount` field stores the total number of installments.
/// - Any installment ID can be used to reference the whole installment loan.
///
/// Note: Throughout the code, the terms "loan" (without additional specification), "sub-loan", and "installment"
/// are used interchangeably since they all represent the same underlying loan structure in the smart contract.
/// Unless otherwise specified, a smart-contract function is applicable to both ordinary loans and sub-loans.
interface ILendingMarket {
    // -------------------------------------------- //
    //  Events                                      //
    // -------------------------------------------- //

    /// @dev Emitted when a loan is taken.
    /// @param loanId The unique identifier of the loan.
    /// @param borrower The address of the borrower of the loan.
    /// @param principalAmount The initial principal amount of the loan, including the borrow amount and addon.
    /// @param durationInPeriods The duration of the loan in periods.
    event LoanTaken(
        uint256 indexed loanId, // Tools: this comment prevents Prettier from formatting into a single line.
        address indexed borrower,
        uint256 principalAmount,
        uint256 durationInPeriods
    );

    /// @dev Emitted when an installment loan is taken in the form of multiple sub-loans.
    /// @param firstInstallmentId The ID of the first sub-loan of the installment loan.
    /// @param borrower The address of the borrower.
    /// @param programId The ID of the lending program.
    /// @param installmentCount The total number of installments.
    /// @param totalBorrowAmount The total amount borrowed.
    /// @param totalAddonAmount The total addon amount of the loan.
    event InstallmentLoanTaken(
        uint256 indexed firstInstallmentId,
        address indexed borrower,
        uint256 indexed programId,
        uint256 installmentCount,
        uint256 totalBorrowAmount,
        uint256 totalAddonAmount
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

    /// @dev Emitted when a loan is revoked.
    /// @param loanId The unique identifier of the loan.
    event LoanRevoked(uint256 indexed loanId);

    /// @dev Emitted when an installment loan is revoked.
    /// @param firstInstallmentId The ID of the first sub-loan of the installment loan.
    /// @param installmentCount The total number of installments.
    event InstallmentLoanRevoked(
        uint256 indexed firstInstallmentId, // Tools: this comment prevents Prettier from formatting into a single line.
        uint256 installmentCount
    );

    /// @dev Emitted when the duration of the loan is updated.
    /// @param loanId The unique identifier of the loan.
    /// @param newDuration The new duration of the loan in periods.
    /// @param oldDuration The old duration of the loan in periods.
    event LoanDurationUpdated(
        uint256 indexed loanId, // Tools: this comment prevents Prettier from formatting into a single line.
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

    /// @dev Emitted when a new credit line is registered.
    /// @param lender The address of the lender who registered the credit line.
    /// @param creditLine The address of the credit line registered.
    event CreditLineRegistered(
        address indexed lender, // Tools: this comment prevents Prettier from formatting into a single line.
        address indexed creditLine
    );

    /// @dev Emitted when a new liquidity pool is registered.
    /// @param lender The address of the lender who registered the liquidity pool.
    /// @param liquidityPool The address of the liquidity pool registered.
    event LiquidityPoolRegistered(
        address indexed lender, // Tools: this comment prevents Prettier from formatting into a single line.
        address indexed liquidityPool
    );

    /// @dev Emitted when a new program is created.
    /// @param lender The address of the lender who created the program.
    /// @param programId The unique identifier of the program.
    event ProgramCreated(
        address indexed lender, // Tools: this comment prevents Prettier from formatting into a single line.
        uint32 indexed programId
    );

    /// @dev Emitted when a program is updated.
    /// @param programId The unique identifier of the program.
    /// @param creditLine The address of the credit line associated with the program.
    /// @param liquidityPool The address of the liquidity pool associated with the program.
    event ProgramUpdated(
        uint32 indexed programId, // Tools: this comment prevents Prettier from formatting into a single line.
        address indexed creditLine,
        address indexed liquidityPool
    );

    /// @dev Emitted when a lender alias is configured.
    /// @param lender The address of the lender account.
    /// @param account The address of the alias account.
    /// @param isAlias True if the account is configured as an alias, otherwise false.
    event LenderAliasConfigured(
        address indexed lender, // Tools: this comment prevents Prettier from formatting into a single line.
        address indexed account,
        bool isAlias
    );

    // -------------------------------------------- //
    //  Borrower functions                          //
    // -------------------------------------------- //

    /// @dev Takes an ordinary loan.
    /// @param programId The identifier of the program to take the loan from.
    /// @param borrowAmount The desired amount of tokens to borrow.
    /// @param durationInPeriods The desired duration of the loan in periods.
    /// @return The unique identifier of the loan.
    function takeLoan(
        uint32 programId, // Tools: this comment prevents Prettier from formatting into a single line.
        uint256 borrowAmount,
        uint256 durationInPeriods
    ) external returns (uint256);

    /// @dev Takes an ordinary loan for a provided account. Can be called only by an account with a special role.
    /// @param borrower The account for whom the loan is taken.
    /// @param programId The identifier of the program to take the loan from.
    /// @param borrowAmount The desired amount of tokens to borrow.
    /// @param addonAmount The off-chain calculated addon amount for the loan.
    /// @param durationInPeriods The desired duration of the loan in periods.
    /// @return The unique identifier of the loan.
    function takeLoanFor(
        address borrower,
        uint32 programId,
        uint256 borrowAmount,
        uint256 addonAmount,
        uint256 durationInPeriods
    ) external returns (uint256);

    /// @dev Takes an installment loan with multiple sub-loans for a provided account.
    ///
    /// Can be called only by an account with a special role.
    ///
    /// @param borrower The account for whom the loan is taken.
    /// @param programId The identifier of the program to take the loan from.
    /// @param borrowAmounts The desired amounts of tokens to borrow for each installment.
    /// @param addonAmounts The off-chain calculated addon amounts for each installment.
    /// @param durationsInPeriods The desired duration of each installment in periods.
    /// @return firstInstallmentId The unique identifier of the first sub-loan of the installment loan.
    /// @return installmentCount The total number of installments.
    function takeInstallmentLoanFor(
        address borrower,
        uint32 programId,
        uint256[] calldata borrowAmounts,
        uint256[] calldata addonAmounts,
        uint256[] calldata durationsInPeriods
    ) external returns (uint256 firstInstallmentId, uint256 installmentCount);

    /// @dev Repays a loan.
    /// @param loanId The unique identifier of the loan to repay.
    /// @param repayAmount The amount to repay or `type(uint256).max` to repay the remaining balance of the loan.
    function repayLoan(uint256 loanId, uint256 repayAmount) external;

    // -------------------------------------------- //
    //  Lender functions                            //
    // -------------------------------------------- //

    /// @dev Registers a credit line.
    /// @param creditLine The address of the credit line to register.
    function registerCreditLine(address creditLine) external;

    /// @dev Registers a liquidity pool.
    /// @param liquidityPool The address of the liquidity pool to register.
    function registerLiquidityPool(address liquidityPool) external;

    /// @dev Creates a new program.
    /// @param creditLine The address of the credit line to associate with the program.
    /// @param liquidityPool The address of the liquidity pool to associate with the program.
    function createProgram(address creditLine, address liquidityPool) external;

    /// @dev Updates an existing program.
    /// @param programId The unique identifier of the program to update.
    /// @param creditLine The address of the credit line to associate with the program.
    /// @param liquidityPool The address of the liquidity pool to associate with the program.
    function updateProgram(uint32 programId, address creditLine, address liquidityPool) external;

    /// @dev Freezes an ordinary loan or a sub-loan.
    /// @param loanId The unique identifier of the loan to freeze.
    function freeze(uint256 loanId) external;

    /// @dev Unfreezes an ordinary loan or a sub-loan.
    /// @param loanId The unique identifier of the loan to unfreeze.
    function unfreeze(uint256 loanId) external;

    /// @dev Updates the duration of an ordinary loan or a sub-loan.
    /// @param loanId The unique identifier of the loan whose duration is to update.
    /// @param newDurationInPeriods The new duration of the loan, specified in periods.
    function updateLoanDuration(uint256 loanId, uint256 newDurationInPeriods) external;

    /// @dev Updates the primary interest rate of an ordinary loan or a sub-loan.
    /// @param loanId The unique identifier of the loan whose primary interest rate is to update.
    /// @param newInterestRate The new primary interest rate of the loan.
    function updateLoanInterestRatePrimary(uint256 loanId, uint256 newInterestRate) external;

    /// @dev Updates the secondary interest rate of an ordinary loan or a sub-loan.
    /// @param loanId The unique identifier of the loan whose secondary interest rate is to update.
    /// @param newInterestRate The new secondary interest rate of the loan.
    function updateLoanInterestRateSecondary(uint256 loanId, uint256 newInterestRate) external;

    /// @dev Configures an alias for a lender.
    /// @param account The address to configure as an alias.
    /// @param isAlias True if the account is an alias, otherwise false.
    function configureAlias(address account, bool isAlias) external;

    // -------------------------------------------- //
    //  Borrower OR Lender functions                //
    // -------------------------------------------- //

    /// @dev Revokes an ordinary loan.
    /// @param loanId The unique identifier of the loan to revoke.
    function revokeLoan(uint256 loanId) external;

    /// @dev Revokes an installment loan by revoking all of its sub-loans.
    /// @param loanId The unique identifier of any sub-loan of the installment loan to revoke.
    function revokeInstallmentLoan(uint256 loanId) external;

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

    /// @dev Gets the lender of a program.
    /// @param programId The unique identifier of the program to check.
    /// @return The lender address of the program.
    function getProgramLender(uint32 programId) external view returns (address);

    /// @dev Gets the credit line associated with a program.
    /// @param programId The unique identifier of the program to check.
    /// @return The address of the credit line associated with the program.
    function getProgramCreditLine(uint32 programId) external view returns (address);

    /// @dev Gets the liquidity pool associated with a program.
    /// @param programId The unique identifier of the program to check.
    /// @return The address of the liquidity pool associated with the program.
    function getProgramLiquidityPool(uint32 programId) external view returns (address);

    /// @dev Gets the stored state of a given ordinary loan or a sub-loan.
    /// @param loanId The unique identifier of the loan to check.
    /// @return The stored state of the loan (see the `Loan.State` struct).
    function getLoanState(uint256 loanId) external view returns (Loan.State memory);

    /// @dev Gets the stored state of a batch of ordinary loans or sub-loans.
    /// @param loanIds The unique identifiers of the loans to check.
    /// @return The stored states of the loans (see the `Loan.State` struct).
    function getLoanStateBatch(uint256[] calldata loanIds) external view returns (Loan.State[] memory);

    /// @dev Gets the preview of an ordinary loan or a sub-loan at a specific timestamp.
    /// @param loanId The unique identifier of the loan to check.
    /// @param timestamp The timestamp to get the loan preview for.
    /// @return The preview state of the loan (see the `Loan.Preview` struct).
    function getLoanPreview(uint256 loanId, uint256 timestamp) external view returns (Loan.Preview memory);

    /// @dev Gets the loan preview at a specific timestamp for a batch of ordinary loans or sub-loans.
    /// @param loanIds The unique identifiers of the loans to check.
    /// @param timestamp The timestamp to get the loan preview for. If 0, the current timestamp is used.
    /// @return The preview states of the loans (see the `Loan.Preview` struct).
    function getLoanPreviewBatch(
        uint256[] calldata loanIds,
        uint256 timestamp
    ) external view returns (Loan.Preview[] memory);

    /// @dev Gets the preview of an installment loan at a specific timestamp.
    ///
    /// This function can be called for an ordinary loan as well, but the resulting data will be slightly different.
    /// See additional comments for the the `Loan.InstallmentLoanPreview` structure
    ///
    /// @param loanId The unique identifier of any sub-loan of the installment loan to check.
    /// @param timestamp The timestamp to get the installment loan preview for. If 0, the current timestamp is used.
    /// @return The preview state of the installment loan (see the `Loan.InstallmentLoanPreview` structure).
    function getInstallmentLoanPreview(
        uint256 loanId,
        uint256 timestamp
    ) external view returns (Loan.InstallmentLoanPreview memory);

    /// @dev Checks if the provided account is a lender or an alias for a lender of a given ordinary loan or a sub-loan.
    /// @param loanId The unique identifier of the loan to check.
    /// @param account The address to check whether it's a lender or an alias.
    function isLenderOrAlias(uint256 loanId, address account) external view returns (bool);

    /// @dev Checks if the provided account is a lender or an alias for a lender of a given lending program.
    /// @param programId The identifier of the program to check.
    /// @param account The address to check whether it's a lender or an alias.
    function isProgramLenderOrAlias(uint32 programId, address account) external view returns (bool);

    /// @dev Checks if the provided account is an alias for a lender.
    /// @param lender The address of the lender to check alias for.
    /// @param account The address to check whether it's an alias or not.
    /// @return True if the account is an alias for the lender, otherwise false.
    function hasAlias(address lender, address account) external view returns (bool);

    /// @dev Returns the rate factor used to for interest rate calculations.
    function interestRateFactor() external view returns (uint256);

    /// @dev Returns the duration of a loan period specified in seconds.
    function periodInSeconds() external view returns (uint256);

    /// @dev Returns time offset and whether it's positive (`true`) or negative (`false`).
    /// The time offset is used to adjust current period of the loan.
    function timeOffset() external view returns (uint256, bool);

    /// @dev Returns the total number of loans taken.
    function loanCounter() external view returns (uint256);

    /// @dev Returns the total number of lending programs.
    function programCounter() external view returns (uint256);

    /// @dev Proves the contract is the lending market one. A marker function.
    function proveLendingMarket() external pure;
}
