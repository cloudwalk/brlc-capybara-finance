// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { Loan } from "../libraries/Loan.sol";

/**
 * @title ILendingMarketPrimary interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The primary part of the lending market contract interface.
 *
 * The lending market supports two types of loans:
 *
 * 1. Ordinary Loans:
 * - A single, standalone loan.
 * - Represented by one loan entity on the smart-contract side with a unique ID.
 * - Has `firstInstallmentId` and `installmentCount` set to 0 in the loan structure.
 *
 * 2. Installment Loans:
 * - A loan split into multiple installments (sub-loans).
 * - Each installment is a separate loan entity on the smart-contract side with its own unique ID.
 * - All installments are represented by the same loan structure as ordinary loans.
 * - The `firstInstallmentId` field stores the ID of the first installment.
 * - The `installmentCount` field stores the total number of installments.
 * - Any installment ID can be used to reference the whole installment loan.
 *
 * Note: Throughout the code, the terms "loan" (without additional specification), "sub-loan", and "installment"
 * are used interchangeably since they all represent the same underlying loan structure in the smart contract.
 * Unless otherwise specified, a smart-contract function is applicable to both ordinary loans and sub-loans.
 */
interface ILendingMarketPrimary {
    // ------------------ Events ---------------------------------- //

    /**
     * @dev Emitted when a loan is taken.
     * @param loanId The unique identifier of the loan.
     * @param borrower The address of the borrower of the loan.
     * @param principalAmount The initial principal amount of the loan, including the borrowed amount and addon.
     * @param durationInPeriods The duration of the loan in periods.
     */
    event LoanTaken(
        uint256 indexed loanId, // Tools: prevent Prettier one-liner
        address indexed borrower,
        uint256 principalAmount,
        uint256 durationInPeriods
    );

    /**
     * @dev Emitted when an installment loan is taken in the form of multiple sub-loans.
     * @param firstInstallmentId The ID of the first sub-loan of the installment loan.
     * @param borrower The address of the borrower.
     * @param programId The ID of the lending program.
     * @param installmentCount The total number of installments.
     * @param totalBorrowedAmount The total amount borrowed.
     * @param totalAddonAmount The total addon amount of the loan.
     */
    event InstallmentLoanTaken(
        uint256 indexed firstInstallmentId,
        address indexed borrower,
        uint256 indexed programId,
        uint256 installmentCount,
        uint256 totalBorrowedAmount,
        uint256 totalAddonAmount
    );

    /**
     * @dev Emitted when a loan is repaid (fully or partially).
     * @param loanId The unique identifier of the loan.
     * @param repayer The address of the token source for the repayment (borrower or third-party).
     * @param borrower The address of the borrower of the loan.
     * @param repaymentAmount The amount of the repayment.
     * @param trackedBalance The tracked balance of the loan after the repayment.
     */
    event LoanRepayment(
        uint256 indexed loanId,
        address indexed repayer,
        address indexed borrower,
        uint256 repaymentAmount,
        uint256 trackedBalance
    );

    /**
     * @dev Emitted when a loan is revoked.
     * @param loanId The unique identifier of the loan.
     */
    event LoanRevoked(uint256 indexed loanId);

    /**
     * @dev Emitted when an installment loan is revoked.
     * @param firstInstallmentId The ID of the first sub-loan of the installment loan.
     * @param installmentCount The total number of installments.
     */
    event InstallmentLoanRevoked(
        uint256 indexed firstInstallmentId, // Tools: prevent Prettier one-liner
        uint256 installmentCount
    );

    /**
     * @dev Emitted when a loan is discounted.
     * @param loanId The unique identifier of the loan.
     * @param discountAmount The amount of the discount.
     * @param newTrackedBalance The new tracked balance of the loan after the discount.
     */
    event LoanDiscounted(
        uint256 indexed loanId, // Tools: prevent Prettier one-liner
        uint256 discountAmount,
        uint256 newTrackedBalance
    );

    /**
     * @dev Emitted when a repayment is undone.
     * @param loanId The unique identifier of the loan.
     * @param receiver The address of the receiver of the tokens due to the repayment undoing.
     * @param borrower The address of the borrower of the loan.
     * @param repaymentTimestamp The timestamp of the repayment in the lending market time zone.
     * @param newRepaidAmount The new repaid amount of the loan.
     * @param oldRepaidAmount The old repaid amount of the loan.
     * @param newTrackedBalance The new tracked balance of the loan.
     * @param oldTrackedBalance The old tracked balance of the loan.
     * @param newLateFeeAmount The new late fee amount of the loan.
     * @param oldLateFeeAmount The old late fee amount of the loan.
     */
    event RepaymentUndone(
        uint256 indexed loanId,
        address indexed receiver,
        address indexed borrower,
        uint256 repaymentTimestamp,
        uint256 newRepaidAmount,
        uint256 oldRepaidAmount,
        uint256 newTrackedBalance,
        uint256 oldTrackedBalance,
        uint256 newLateFeeAmount,
        uint256 oldLateFeeAmount
    );

    /**
     * @dev Emitted when a loan is frozen.
     * @param loanId The unique identifier of the loan.
     */
    event LoanFrozen(uint256 indexed loanId);

    /**
     * @dev Emitted when a loan is unfrozen.
     * @param loanId The unique identifier of the loan.
     */
    event LoanUnfrozen(uint256 indexed loanId);

    /**
     * @dev Emitted when the duration of the loan is updated.
     * @param loanId The unique identifier of the loan.
     * @param newDuration The new duration of the loan in periods.
     * @param oldDuration The old duration of the loan in periods.
     */
    event LoanDurationUpdated(
        uint256 indexed loanId, // Tools: prevent Prettier one-liner
        uint256 indexed newDuration,
        uint256 indexed oldDuration
    );

    /**
     * @dev Emitted when the primary interest rate of the loan is updated.
     * @param loanId The unique identifier of the loan.
     * @param newInterestRate The new primary interest rate of the loan.
     * @param oldInterestRate The old primary interest rate of the loan.
     */
    event LoanInterestRatePrimaryUpdated(
        uint256 indexed loanId,
        uint256 indexed newInterestRate,
        uint256 indexed oldInterestRate
    );

    /**
     * @dev Emitted when the secondary interest rate of the loan is updated.
     * @param loanId The unique identifier of the loan.
     * @param newInterestRate The new secondary interest rate of the loan.
     * @param oldInterestRate The old secondary interest rate of the loan.
     */
    event LoanInterestRateSecondaryUpdated(
        uint256 indexed loanId,
        uint256 indexed newInterestRate,
        uint256 indexed oldInterestRate
    );

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Takes an ordinary loan for a provided account. Can be called only by an account with a special role.
     * @param borrower The account for whom the loan is taken.
     * @param programId The identifier of the program to take the loan from.
     * @param borrowedAmount The desired amount of tokens to borrow.
     * @param addonAmount The off-chain calculated addon amount for the loan.
     * @param durationInPeriods The desired duration of the loan in periods.
     * @return The unique identifier of the loan.
     */
    function takeLoanFor(
        address borrower,
        uint32 programId,
        uint256 borrowedAmount,
        uint256 addonAmount,
        uint256 durationInPeriods
    ) external returns (uint256);

    /**
     * @dev Takes an installment loan with multiple sub-loans for a provided account.
     *
     * Can be called only by an account with a special role.
     *
     * @param borrower The account for whom the loan is taken.
     * @param programId The identifier of the program to take the loan from.
     * @param borrowedAmounts The desired amounts of tokens to borrow for each installment.
     * @param addonAmounts The off-chain calculated addon amounts for each installment.
     * @param durationsInPeriods The desired duration of each installment in periods.
     * @return firstInstallmentId The unique identifier of the first sub-loan of the installment loan.
     * @return installmentCount The total number of installments.
     */
    function takeInstallmentLoanFor(
        address borrower,
        uint32 programId,
        uint256[] calldata borrowedAmounts,
        uint256[] calldata addonAmounts,
        uint256[] calldata durationsInPeriods
    ) external returns (uint256 firstInstallmentId, uint256 installmentCount);

    /**
     * @dev Repays a loan.
     * @param loanId The unique identifier of the loan to repay.
     * @param repaymentAmount The amount to repay or `type(uint256).max` to repay the remaining balance of the loan.
     */
    function repayLoan(uint256 loanId, uint256 repaymentAmount) external;

    /**
     * @dev Repays a batch of loans.
     *
     * Can be called only by an account with a special role.
     * Using `type(uint256).max` for the `repaymentAmount` will repay the remaining balance of the loan.
     *
     * @param loanIds The unique identifiers of the loans to repay.
     * @param repaymentAmounts The amounts to repay for each loan in the batch.
     * @param repayer The address of the token source for the repayments (borrower or third-party).
     */
    function repayLoanForBatch(
        uint256[] calldata loanIds,
        uint256[] calldata repaymentAmounts,
        address repayer
    ) external;

    /**
     * @dev Revokes an ordinary loan.
     * @param loanId The unique identifier of the loan to revoke.
     */
    function revokeLoan(uint256 loanId) external;

    /**
     * @dev Revokes an installment loan by revoking all of its sub-loans.
     * @param loanId The unique identifier of any sub-loan of the installment loan to revoke.
     */
    function revokeInstallmentLoan(uint256 loanId) external;

    /**
     * @dev Discounts a batch of loans.
     *
     * Can be called only by an account with a special role.
     * Using `type(uint256).max` for the `discountAmount` will discount the remaining balance of the loan.
     *
     * @param loanIds The unique identifiers of the loans to discount.
     * @param discountAmounts The amounts to discount for each loan in the batch.
     */
    function discountLoanForBatch(
        uint256[] calldata loanIds, // Tools: prevent Prettier one-liner
        uint256[] calldata discountAmounts
    ) external;

    /**
     * @dev Undoes a repayment for a loan.
     *
     * This function is based on the following formulas:
     *
     * 1. Bc1 = B + A*(1+R1)^(prd(tt) - prd(rt)).
     * 2. Bc2 = B + A*(1+R1)^(prd(td) - prd(rt))*(1+R2)^(prd(tt) - prd(td + 1))*(1+RF).
     * 3. Bc3 = B + A*(1+R2)^(prd(tt) - prd(rt)).
     * 4. Vc = V - A.
     * 5. Fc = F + A*(1+R1)^(prd(td) - prd(rt))*RF.
     *
     * Where:
     *
     * - Bc1, Bc2, Bc3 are the corrected (new) tracked balance of a loan in the following cases:
     * - Bc1 -- the loan is NOT overdue,
     * - Bc2 -- the loan is overdue but the repayment to undone happened before the overdue timestamp,
     * - Bc3 -- the loan is overdue and the repayment to undone happened after the overdue timestamp;
     * - B is the tracked balance of a loan before the repayment undoing;
     * - A is the amount of the undoing repayment;
     * - R1 is the primary interest rate;
     * - R2 is the secondary interest rate;
     * - prd() is the function that returns the loan period index by a timestamp;
     * - tt is the tracked timestamp of a loan;
     * - rt is the timestamp of a repayment to undo;
     * - td is the last timestamp of a loan, when it is still considered NOT overdue;
     * - Vc is the corrected (new) repaid amount of a loan;
     * - V is the repaid amount of a loan before the repayment undoing;
     * - Fc is the corrected (new) late fee amount of a loan that is overdue;
     * - F is the late fee amount of a loan before the repayment undoing.
     *
     * Notes:
     *
     * 1. If a loan is not overdue then (Fc = F).
     * 2. If the repayment to undo is the last for a loan then (Bc = B + A) and (Vc = V - A).
     * 3. The formulas cannot be used for a loan that was frozen and then unfrozen.
     * 4. The formulas can be used for a loan that was only frozen, in that case the tt is the freezing timestamp.
     * 5. After undoing a repayment, the values of the tracked balance and late fee amount fields of a loan
     * may differ from the expected values by plus or minus one least significant bit due to rounding.
     * 6. There are final and ordinary repayments to undo. The final repayment is one that caused closing of a loan.
     * 7. To properly undo a final repayment the caller must provide the tracked balance of the loan before
     * the repayment instead of the final repayment amount.
     * To get the right tracked balance the following steps should be used:
     * * a. Determine the block of the final repayment: `B`.
     * * b. Determine the timestamp of the `B` block: `BT`.
     * * c. Determine the timestamp in the timezone of the lending contract: `BTZ`.
     * E.g. for `America/Sao_Paulo` timezone: `BTZ = BT - 3 * 60 * 60`.
     * * d. Call the `getLoanPreview()` function at the `B-1` block with the `BTZ` timestamp.
     * * e. Use the trackedBalance field of the returned structure as the `repaymentAmount` parameter
     * to undo the final repayment.
     * 8. The recommended algorithm for selecting the value of parameter `repaymentAmount`:
     * * a. If the being undone repayment is NOT a final one use its repayment amount as the value.
     * * b. Otherwise the repayment is a final one and so use the tracked balance of the loan before
     * the repayment as the value. See the previous note for details.
     *
     * @param loanId The unique identifier of the loan.
     * @param repaymentAmount The amount of the repayment to undo.
     * @param repaymentTimestamp The timestamp of the repayment in the lending market time zone.
     * @param receiver The address of the receiver of the tokens due to the repayment undoing.
     */
    function undoRepaymentFor(
        uint256 loanId, // Tools: prevent Prettier one-liner
        uint256 repaymentAmount,
        uint256 repaymentTimestamp,
        address receiver
    ) external;

    /**
     * @dev Freezes an ordinary loan or a sub-loan.
     * @param loanId The unique identifier of the loan to freeze.
     */
    function freeze(uint256 loanId) external;

    /**
     * @dev Unfreezes an ordinary loan or a sub-loan.
     * @param loanId The unique identifier of the loan to unfreeze.
     */
    function unfreeze(uint256 loanId) external;

    /**
     * @dev Updates the duration of an ordinary loan or a sub-loan.
     * @param loanId The unique identifier of the loan whose duration is to update.
     * @param newDurationInPeriods The new duration of the loan, specified in periods.
     */
    function updateLoanDuration(uint256 loanId, uint256 newDurationInPeriods) external;

    /**
     * @dev Updates the primary interest rate of an ordinary loan or a sub-loan.
     * @param loanId The unique identifier of the loan whose primary interest rate is to update.
     * @param newInterestRate The new primary interest rate of the loan.
     */
    function updateLoanInterestRatePrimary(uint256 loanId, uint256 newInterestRate) external;

    /**
     * @dev Updates the secondary interest rate of an ordinary loan or a sub-loan.
     * @param loanId The unique identifier of the loan whose secondary interest rate is to update.
     * @param newInterestRate The new secondary interest rate of the loan.
     */
    function updateLoanInterestRateSecondary(uint256 loanId, uint256 newInterestRate) external;

    // ------------------ View functions -------------------------- //

    /**
     * @dev Gets the credit line associated with a program.
     * @param programId The unique identifier of the program to check.
     * @return The address of the credit line associated with the program.
     */
    function getProgramCreditLine(uint32 programId) external view returns (address);

    /**
     * @dev Gets the liquidity pool associated with a program.
     * @param programId The unique identifier of the program to check.
     * @return The address of the liquidity pool associated with the program.
     */
    function getProgramLiquidityPool(uint32 programId) external view returns (address);

    /**
     * @dev Gets the stored state of a given ordinary loan or a sub-loan.
     * @param loanId The unique identifier of the loan to check.
     * @return The stored state of the loan (see the `Loan.State` struct).
     */
    function getLoanState(uint256 loanId) external view returns (Loan.State memory);

    /**
     * @dev Gets the preview of an ordinary loan or a sub-loan at a specific timestamp.
     * @param loanId The unique identifier of the loan to check.
     * @param timestamp The timestamp to get the loan preview for.
     * @return The preview state of the loan (see the `Loan.Preview` struct).
     */
    function getLoanPreview(uint256 loanId, uint256 timestamp) external view returns (Loan.Preview memory);

    /**
     * @dev Gets the loan extended preview at a specific timestamp for a batch of ordinary loans or sub-loans.
     * @param loanIds The unique identifiers of the loans to check.
     * @param timestamp The timestamp to get the loan preview for. If 0, the current timestamp is used.
     * @return The extended previews of the loans (see the `Loan.PreviewExtended` struct).
     */
    function getLoanPreviewExtendedBatch(
        uint256[] calldata loanIds,
        uint256 timestamp
    ) external view returns (Loan.PreviewExtended[] memory);

    /**
     * @dev Gets the preview of an installment loan at a specific timestamp.
     *
     * This function can be called for an ordinary loan as well, but the resulting data will be slightly different.
     * See additional comments for the the `Loan.InstallmentLoanPreview` structure
     *
     * @param loanId The unique identifier of any sub-loan of the installment loan to check.
     * @param timestamp The timestamp to get the installment loan preview for. If 0, the current timestamp is used.
     * @return The preview state of the installment loan (see the `Loan.InstallmentLoanPreview` structure).
     */
    function getInstallmentLoanPreview(
        uint256 loanId,
        uint256 timestamp
    ) external view returns (Loan.InstallmentLoanPreview memory);

    /// @dev Returns the rate factor used to for interest rate calculations.
    function interestRateFactor() external view returns (uint256);

    /// @dev Returns the duration of a loan period specified in seconds.
    function periodInSeconds() external view returns (uint256);

    /**
     * @dev Returns time offset and whether it's positive (`true`) or negative (`false`).
     * The time offset is used to adjust current period of the loan.
     */
    function timeOffset() external view returns (uint256, bool);

    /// @dev Returns the total number of loans taken.
    function loanCounter() external view returns (uint256);

    /// @dev Returns the total number of lending programs.
    function programCounter() external view returns (uint256);
}

/**
 * @title ILendingMarketConfiguration interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The configuration part of the lending market contract interface.
 */
interface ILendingMarketConfiguration {
    // ------------------ Events ---------------------------------- //

    /**
     * @dev Emitted when a new credit line is registered.
     *
     * NOTES:
     *
     * 1. This event is deprecated since version 1.9.0 and in no longer used. Kept for historical reason.
     * 2. Registration of credit lines before creating lending programs is no longer required.
     * 3. All previously registered credit lines have been unregistered without an event since version 1.9.0.
     *
     * @param lender The address of the lender who registered the credit line.
     * @param creditLine The address of the credit line registered.
     */
    event CreditLineRegistered(
        address indexed lender, // Tools: prevent Prettier one-liner
        address indexed creditLine
    );

    /**
     * @dev Emitted when a new liquidity pool is registered.
     * @param lender The address of the lender who registered the liquidity pool.
     * @param liquidityPool The address of the liquidity pool registered.
     *
     * NOTES:
     *
     * 1. This event is deprecated since version 1.9.0 and in no longer used. Kept for historical reason.
     * 2. Registration of liquidity pools before creating lending programs is no longer required.
     * 3. All previously registered liquidity pools have been unregistered without an event since version 1.9.0.
     *
     */
    event LiquidityPoolRegistered(
        address indexed lender, // Tools: prevent Prettier one-liner
        address indexed liquidityPool
    );

    /**
     * @dev Emitted when a new program is created.
     * @param lender The address of the lender who created the program.
     * @param programId The unique identifier of the program.
     */
    event ProgramCreated(
        address indexed lender, // Tools: prevent Prettier one-liner
        uint32 indexed programId
    );

    /**
     * @dev Emitted when a program is updated.
     * @param programId The unique identifier of the program.
     * @param creditLine The address of the credit line associated with the program.
     * @param liquidityPool The address of the liquidity pool associated with the program.
     */
    event ProgramUpdated(
        uint32 indexed programId, // Tools: prevent Prettier one-liner
        address indexed creditLine,
        address indexed liquidityPool
    );

    /**
     * @dev Emitted when a lender alias is configured.
     *
     * NOTES:
     *
     * 1. This event is deprecated since version 1.9.0 and in no longer used. Kept for historical reason.
     * 2. Aliases logic has been replaced with granting of the admin role.
     * 3. All previously configured aliases have been revoked with an appropriate event since version 1.9.0.
     *
     * @param lender The address of the lender account.
     * @param account The address of the alias account.
     * @param isAlias True if the account is configured as an alias, otherwise false.
     */
    event LenderAliasConfigured(
        address indexed lender, // Tools: prevent Prettier one-liner
        address indexed account,
        bool isAlias
    );

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Creates a new program.
     * @param creditLine The address of the credit line to associate with the program.
     * @param liquidityPool The address of the liquidity pool to associate with the program.
     */
    function createProgram(address creditLine, address liquidityPool) external;

    /**
     * @dev Updates an existing program.
     * @param programId The unique identifier of the program to update.
     * @param creditLine The address of the credit line to associate with the program.
     * @param liquidityPool The address of the liquidity pool to associate with the program.
     */
    function updateProgram(uint32 programId, address creditLine, address liquidityPool) external;
}

/**
 * @title ILendingMarketErrors interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the custom errors used in the lending market contract.
 */
interface ILendingMarketErrors {
    /// @dev Thrown when the addon treasury address is zero.
    error AddonTreasuryAddressZero();

    /// @dev Thrown when the loan ID exceeds the maximum allowed value.
    error LoanIdExcess();

    /// @dev Thrown when the loan does not exist.
    error LoanNotExist();

    /// @dev Thrown when the loan is not frozen.
    error LoanNotFrozen();

    /// @dev Thrown when the loan is already repaid.
    error LoanAlreadyRepaid();

    /// @dev Thrown when the loan is already frozen.
    error LoanAlreadyFrozen();

    /**
     * @dev Thrown when the loan type according to the provided ID does not match the expected one.
     * @param actualType The actual type of the loan.
     * @param expectedType The expected type of the loan.
     */
    error LoanTypeUnexpected(Loan.Type actualType, Loan.Type expectedType);

    /// @dev Thrown when provided interest rate is inappropriate.
    error InappropriateInterestRate();

    /// @dev Thrown when provided loan duration is inappropriate.
    error InappropriateLoanDuration();

    /// @dev Thrown when the credit line is not configured for the provided lending program.
    error ProgramCreditLineNotConfigured();

    /// @dev Thrown when the liquidity pool is not configured for the provided lending program.
    error ProgramLiquidityPoolNotConfigured();

    /// @dev Thrown when the program does not exist.
    error ProgramNotExist();

    /// @dev Thrown when the lending program ID exceeds the maximum allowed value.
    error ProgramIdExcess();

    /// @dev Thrown when the provided duration array is invalid.
    error DurationArrayInvalid();

    /// @dev Thrown when the installment count exceeds the maximum allowed value.
    error InstallmentCountExcess();

    /// @dev Thrown when the provided repayment timestamp is invalid.
    error RepaymentTimestampInvalid();
}

/**
 * @title ILendingMarket interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The full interface of the lending market contract.
 */
interface ILendingMarket is ILendingMarketPrimary, ILendingMarketConfiguration, ILendingMarketErrors {
    /// @dev Proves the contract is the lending market one. A marker function.
    function proveLendingMarket() external pure;
}
