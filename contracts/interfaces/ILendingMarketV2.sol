// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { LoanV2 } from "../libraries/LoanV2.sol";

/**
 * @title ILendingMarketPrimaryV2 interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The primary part of the lending market contract interface.
 *
 * TODO
 */
interface ILendingMarketPrimaryV2 {
    // ------------------ Events ---------------------------------- //

    /**
     * @dev Emitted when a sub-loan is taken.
     * @param subLoanId The unique identifier of the sub-loan.
     * @param borrower The address of the borrower of the sub-loan.
     * @param programId TODO
     * @param borrowedAmount TODO
     * @param addonAmount TODO
     * @param duration The duration of the sub-loan in days.
     */
    event SubLoanTaken(
        uint256 indexed subLoanId, // Tools: this comment prevents Prettier from formatting into a single line.
        address indexed borrower,
        uint256 indexed programId,
        uint256 borrowedAmount,
        uint256 addonAmount,
        uint256 duration
        // TODO: add more parameters if needed
    );

    /**
     * @dev Emitted when a loan is taken in the form of multiple sub-loans.
     * @param firstSubLoanId The ID of the first sub-loan of the loan.
     * @param borrower The address of the borrower.
     * @param programId The ID of the lending program.
     * @param subLoanCount The total number of sub-loans.
     * @param totalBorrowedAmount The total amount borrowed in the loan.
     * @param totalAddonAmount The total addon amount of the loan.
     */
    event LoanTaken(
        uint256 indexed firstSubLoanId,
        address indexed borrower,
        uint256 indexed programId,
        uint256 subLoanCount,
        uint256 totalBorrowedAmount,
        uint256 totalAddonAmount
    );

    /**
     * @dev Emitted when a loan is fully revoked by revocation of all its sub-loans.
     * @param firstSubLoanId The ID of the first sub-loan of the  loan.
     * @param subLoanCount The total number of sub-loans.
     */
    event LoanRevoked(
        uint256 indexed firstSubLoanId, // Tools: this comment prevents Prettier from formatting into a single line.
        uint256 subLoanCount
    );

    /**
     * @dev TODO
     */
    event OperationAdded(
        uint256 indexed subLoanId,
        uint256 indexed operationId,
        uint256 indexed kind,
        uint256 timestamp,
        uint256 parameter, //TODO: consider another name, same for similar events
        address account, //TODO: consider another name, same for similar events
        bytes addendum
    );

    /**
     * @dev TODO
     */
    event OperationApplied(
        uint256 indexed subLoanId,
        uint256 indexed operationId,
        uint256 indexed kind,
        uint256 timestamp,
        uint256 parameter,
        address account,
        // TODO: add more subLoan fields here
        bytes addendum
    );

    /**
     * @dev TODO
     */
    event OperationChanged(
        uint256 indexed subLoanId,
        uint256 indexed operationId,
        uint256 indexed kind,
        uint256 timestamp,
        uint256 newParameter,
        uint256 oldParameter,
        bytes addendum
    );

    /**
     * @dev TODO
     */
    event OperationVoided(
        uint256 indexed subLoanId,
        uint256 indexed operationId,
        uint256 indexed kind,
        uint256 timestamp,
        uint256 parameter,
        bytes addendum
    );

    // TODO: add more events

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Takes a loan with multiple sub-loans for a provided account.
     *
     * Can be called only by an account with a special role.
     *
     * @param borrower The account for whom the loan is taken.
     * @param programId The identifier of the program to take the loan from.
     * @param borrowedAmounts The desired amounts of tokens to borrow for each sub-loan.
     * @param addonAmounts The off-chain calculated addon amounts for each sub-loan.
     * @param durations The desired duration of each sub-loan in days.
     * @return firstSubLoanId The unique identifier of the first sub-loan of the loan.
     * @return subLoanCount The total number of sub-loans.
     */
    function takeLoanFor(
        address borrower,
        uint32 programId,
        uint256[] calldata borrowedAmounts,
        uint256[] calldata addonAmounts,
        uint256[] calldata durations
    ) external returns (uint256 firstSubLoanId, uint256 subLoanCount);

    /**
     * @dev Repays a batch of sub-loans.
     *
     * Can be called only by an account with a special role.
     * Using `type(uint256).max` for the `repaymentAmount` will repay the remaining balance of the loan.
     *
     * @param subLoanIds The unique identifiers of the sub-loans to repay.
     * @param repaymentAmounts The amounts to repay for each sub-loan in the batch.
     * @param repayer The address of the token source for the repayments (borrower or third-party).
     */
    function repaySubLoanForBatch(
        uint256[] calldata subLoanIds,
        uint256[] calldata repaymentAmounts,
        address repayer
    ) external;

    /**
     * @dev Revokes a loan by the ID of any of its sub-loans.
     * @param subLoanId The unique identifier of the sub-loan to revoke.
     */
    function revokeLoanFor(uint256 subLoanId) external;

    /**
     * @dev Discounts a batch of sub-loans.
     *
     * Can be called only by an account with a special role.
     * Using `type(uint256).max` for the `discountAmount` will discount the remaining balance of the sub-loan.
     *
     * @param subLoanIds The unique identifiers of the sub-loans to discount.
     * @param discountAmounts The amounts to discount for each sub-loan in the batch.
     */
    function discountSubLoanForBatch(
        uint256[] calldata subLoanIds, // Tools: this comment prevents Prettier from formatting into a single line.
        uint256[] calldata discountAmounts
    ) external;

    /**
     * @dev TODO
     */
    function addOperation(
        uint256 subLoanId,
        uint256 kind,
        uint256 timestamp,
        uint256 parameter,
        address repayer
    ) external;

    /**
     * @dev TODO
     */
    function changeOperation(
        uint256 subLoanId,
        uint256 operationId,
        uint256 newParameter,
        address counterparty
    ) external;

    /**
     * @dev TODO
     */
    function voidOperation(
        uint256 subLoanId,
        uint256 operationId,
        address counterparty
    ) external;

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
     * @dev Gets the stored state for a batch of sub-loans.
     * @param subLoanIds The unique identifiers of the sub-loans to get
     * @return The stored states of the sub-loans
     */
    function getSubLoanBatch(uint256[] calldata subLoanIds) external view returns (LoanV2.SubLoan[] memory);

    /**
     * @dev Gets the sub-loan preview at a specific timestamp for a batch of sub-loans.
     * @param subLoanIds The unique identifiers of the sub-loans to get.
     * @param timestamp The timestamp to get the sub-loan preview for. If 0, the current timestamp is used.
     * @return The previews of the sub-loans (see the `LoanV2.SubLoanPreview` struct).
     */
    function getLoanPreviewBatch(
        uint256[] calldata subLoanIds,
        uint256 timestamp
    ) external view returns (LoanV2.SubLoanPreview[] memory);

    /**
     * @dev Gets the preview of a loan at a specific timestamp.
     *
     * @param subLoanId The unique identifier of any sub-loan of the loan to check.
     * @param timestamp The timestamp to get the loan preview for. If 0, the current timestamp is used.
     * @return The preview state of the loan (see the `LoanV2.LoanPreview` structure).
     */
    function getLoanPreview(
        uint256 subLoanId,
        uint256 timestamp
    ) external view returns (LoanV2.LoanPreview memory);

    /// @dev TODO
    // TODO: Consider using a separate structure to return
    function getSubLoanOperations(uint256 subLoanId) external view returns (LoanV2.ProcessingOperation[] memory);

    /// @dev Returns the rate factor used to for interest rate calculations.
    function interestRateFactor() external view returns (uint256);

    /**
     * @dev Returns time offset and whether it's positive (`true`) or negative (`false`).
     * The time offset is used to adjust current day of a loan.
     */
    function timeOffset() external view returns (uint256, bool);

    /// @dev Returns the total number of sub-loans taken.
    function subLoanCounter() external view returns (uint256);

    /// @dev Returns the total number of lending programs.
    function programCounter() external view returns (uint256);
}

/**
 * @title ILendingMarketConfiguration interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The configuration part of the lending market contract interface.
 */
interface ILendingMarketConfigurationV2 {
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
        address indexed lender, // Tools: this comment prevents Prettier from formatting into a single line.
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
        address indexed lender, // Tools: this comment prevents Prettier from formatting into a single line.
        address indexed liquidityPool
    );

    /**
     * @dev Emitted when a new program is created.
     * @param lender The address of the lender who created the program.
     * @param programId The unique identifier of the program.
     */
    event ProgramCreated(
        address indexed lender, // Tools: this comment prevents Prettier from formatting into a single line.
        uint32 indexed programId
    );

    /**
     * @dev Emitted when a program is updated.
     * @param programId The unique identifier of the program.
     * @param creditLine The address of the credit line associated with the program.
     * @param liquidityPool The address of the liquidity pool associated with the program.
     */
    event ProgramUpdated(
        uint32 indexed programId, // Tools: this comment prevents Prettier from formatting into a single line.
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
        address indexed lender, // Tools: this comment prevents Prettier from formatting into a single line.
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
interface ILendingMarketErrorsV2 {
    /// @dev Thrown when the addon treasury address is zero.
    error AddonTreasuryAddressZero();

    /// @dev Thrown when the loan ID exceeds the maximum allowed value.
    error LoanIdExcess();

    /// @dev TODO
    error SubLoanIdExcess();

    /// @dev Thrown when the loan does not exist.
    error LoanNotExist();

    /// @dev Thrown when the sub-loan does not exist.
    error SubLoanNotExist();

    /// @dev Thrown when the loan is not frozen.
    error LoanNotFrozen();

    /// @dev Thrown when the loan is already repaid.
    error LoanAlreadyRepaid();

    /// @dev Thrown when the sub-loan is already repaid.
    error SubLoanAlreadyRepaid();

    /// @dev Thrown when the loan is already frozen.
    error LoanAlreadyFrozen();

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

    /// @dev Thrown when the provided sub-loan duration is invalid.
    error DurationInvalid();

    /// @dev Thrown when the installment count exceeds the maximum allowed value.
    error InstallmentCountExcess();

    /// @dev Thrown when the provided repayment timestamp is invalid.
    error RepaymentTimestampInvalid();

    /// @dev TODO
    error OperationTimestampInvalid(); // TODO: add parameters

    /// @dev TODO
    error OperationKindUnacceptable(); // TODO: add parameters

    /// @dev TODO
    error OperationKindInvalid(); // TODO: add parameters

    /// @dev TODO
    error OperationParameterInvalid(); // TODO: add parameters

    /// @dev TODO
    error OperationTimestampTooEarly(); // TODO: add parameters

    /// @dev TODO
    error OperationUnchanged(); // TODO: add parameters

    /// @dev TODO
    error RapayerAddressZero(); // TODO: add parameters

    /// @dev TODO
    error RepaymentOrDiscountAmountInvalid(); // TODO: add parameters

    /// @dev TODO
    error RepaymentOrDiscountAmountExcess(); // TODO: add parameters

    /// @dev TODO
    error RateValueInvalid(); // TODO: add parameters

    /// @dev TODO
    error OperationIdExcess(); // TODO: add parameters

    /// @dev TODO
    error OperationNonexistent(); // TODO: add parameters

    /// @dev TODO
    error OperationAlreadySkipped(); // TODO: add parameters

    /// @dev TODO
    error SubLoanRevoked(); // TODO: add parameters

    /// @dev TODO
    error SubLoanFullyRepaid(); // TODO: add parameters

    /// @dev TODO
    error OperationParameterNotZero(); // TODO: add parameters
}

/**
 * @title ILendingMarket interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The full interface of the lending market contract.
 */
interface ILendingMarketV2 is ILendingMarketPrimaryV2, ILendingMarketConfigurationV2, ILendingMarketErrorsV2 {
    /// @dev Proves the contract is the lending market one. A marker function.
    function proveLendingMarket() external pure;
}
