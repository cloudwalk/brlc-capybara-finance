// SPDX-License-Identifier: MIT

//TODO: fix here and everywhere the version pragma
pragma solidity 0.8.24;

import { ILendingMarketTypesV2 } from "./ILendingMarketTypesV2.sol";

/**
 * @title ILendingMarketPrimaryEventsV2 interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The primary events of the lending market contract interface.
 *
 * TODO
 */
interface ILendingMarketPrimaryEventsV2 is ILendingMarketTypesV2 {
    /**
     * @dev Emitted when a loan is taken in the form of multiple sub-loans.
     *
     * @param firstSubLoanId The ID of the first sub-loan of the loan.
     * @param borrower The address of the borrower.
     * @param programId The ID of the lending program that was used to take the loan.
     * @param totalBorrowedAmount The total amount borrowed in the loan as the sum of all sub-loans.
     * @param totalAddonAmount The total addon amount of the loan as the sum of all sub-loans.
     * @param subLoanCount The total number of sub-loans.
     * @param creditLine The address of the credit line that was used to take the loan.
     * @param liquidityPool The address of the liquidity pool that was used to take the loan.
     */
    event LoanTaken(
        uint256 indexed firstSubLoanId,
        address indexed borrower,
        uint256 indexed programId,
        uint256 totalBorrowedAmount,
        uint256 totalAddonAmount,
        uint256 subLoanCount,
        address creditLine,
        address liquidityPool
    );

    /**
     * @dev Emitted when a loan is fully revoked by revocation of all its sub-loans.
     *
     * @param firstSubLoanId The ID of the first sub-loan of the  loan.
     * @param subLoanCount The total number of sub-loans.
     */
    event LoanRevoked(
        uint256 indexed firstSubLoanId, // Tools: prevent Prettier one-liner
        uint256 subLoanCount
    );

    /**
     * @dev Emitted when a sub-loan is taken.
     *
     * @param subLoanId The unique identifier of the sub-loan.
     * @param borrowedAmount The amount of tokens borrowed for the sub-loan.
     * @param addonAmount The addon amount of the sub-loan.
     * @param startTimestamp The timestamp when the sub-loan was created.
     * @param duration The duration of the sub-loan in days.
     * @param packedRates The packed rates of the sub-loan. A bitfield with the following bits:
     *
     * - 64 bits from 0 to 63: the remuneratory interest rate.
     * - 64 bits from 64 to 127: the moratory interest rate.
     * - 64 bits from 128 to 191: the late fee rate.
     */
    event SubLoanTaken(
        uint256 indexed subLoanId, // Tools: prevent Prettier one-liner
        uint256 borrowedAmount,
        uint256 addonAmount,
        uint256 startTimestamp,
        uint256 duration,
        bytes32 packedRates
    );

    /**
     * @dev Emitted when a sub-loan is revised or after the sub-loan is taken for the first time.
     *
     * @param subLoanId The unique identifier of the sub-loan.
     * @param subLoanRevision The revision number of the sub-loan.
     */
    event SubLoanRevision(
        uint256 indexed subLoanId, // Tools: prevent Prettier one-liner
        uint256 indexed subLoanRevision
    );

    /**
     * @dev Emitted when the tracked balance of a sub-loan is updated.
     *
     * This event accompanies all other sub-loan events with the revision field except the following:
     *
     * - `SubLoanDurationUpdated`
     * - `SubLoanFrozen`
     *
     * See notes about the event packed parameters in the `SubLoanRepaymentUpdated` event.
     *
     * @param subLoanId The unique identifier of the sub-loan.
     * @param subLoanRevision The revision number of the sub-loan.
     * @param trackedTimestamp The tracked timestamp of the sub-loan when its tracked balance was updated.
     * @param packedTrackedParts The current packed tracked parts of the sub-loan.
     */
    event SubLoanTrackedBalanceUpdated(
        uint256 indexed subLoanId,
        uint256 indexed subLoanRevision,
        uint256 trackedTimestamp,
        bytes32 packedTrackedParts
    );

    /**
     * @dev Emitted when a sub-loan is repaid.
     *
     * Notes about the event parameters:
     *
     *  Any `...packed...Parts` value is a bitfield with the following bits:
     *
     * - 64 bits from 0 to 63: related to the principal.
     * - 64 bits from 64 to 127: related to the remuneratory interest.
     * - 64 bits from 128 to 191: related to the moratory interest.
     * - 64 bits from 192 to 255: related to the late fee.
     *
     * @param subLoanId The unique identifier of the sub-loan.
     * @param subLoanRevision The revision number of the sub-loan.
     * @param trackedTimestamp The tracked timestamp of the sub-loan when it was repaid.
     * @param newPackedRepaidParts The current packed repaid parts of the sub-loan.
     * @param oldPackedRepaidParts The previous packed repaid parts of the sub-loan.
     */
    event SubLoanRepayment(
        uint256 indexed subLoanId,
        uint256 indexed subLoanRevision,
        uint256 trackedTimestamp,
        bytes32 newPackedRepaidParts,
        bytes32 oldPackedRepaidParts
    );

    /**
     * @dev Emitted when a sub-loan is discounted.
     *
     * See notes about the event packed parameters in the `SubLoanRepaymentUpdated` event.
     *
     * @param subLoanId The unique identifier of the sub-loan.
     * @param subLoanRevision The revision number of the sub-loan.
     * @param trackedTimestamp The tracked timestamp of the sub-loan when it was discounted.
     * @param newPackedDiscountParts The current packed discount parts of the sub-loan.
     * @param oldPackedDiscountParts The previous packed discount parts of the sub-loan.
     */
    event SubLoanDiscount(
        uint256 indexed subLoanId,
        uint256 indexed subLoanRevision,
        uint256 trackedTimestamp,
        bytes32 newPackedDiscountParts,
        bytes32 oldPackedDiscountParts
    );

    /**
     * @dev Emitted when the duration in days of a sub-loan is updated.
     *
     * @param subLoanId The unique identifier of the sub-loan.
     * @param subLoanRevision The revision number of the sub-loan.
     * @param trackedTimestamp The tracked timestamp of the sub-loan when its duration was updated.
     * @param newDuration The current duration.
     * @param oldDuration The previous duration.
     */
    event SubLoanDurationUpdated(
        uint256 indexed subLoanId,
        uint256 indexed subLoanRevision,
        uint256 trackedTimestamp,
        uint256 newDuration,
        uint256 oldDuration
    );

    /**
     * @dev Emitted when the remuneratory interest rate of a sub-loan is updated.
     *
     * @param subLoanId The unique identifier of the sub-loan.
     * @param subLoanRevision The revision number of the sub-loan.
     * @param trackedTimestamp The tracked timestamp of the sub-loan when its remuneratory interest rate was updated.
     * @param newRate The current remuneratory interest rate.
     * @param oldRate The previous remuneratory interest rate.
     */
    event SubLoanInterestRateRemuneratoryUpdated(
        uint256 indexed subLoanId,
        uint256 indexed subLoanRevision,
        uint256 trackedTimestamp,
        uint256 newRate,
        uint256 oldRate
    );

    /**
     * @dev Emitted when the moratory interest rate of a sub-loan is updated.
     *
     * @param subLoanId The unique identifier of the sub-loan.
     * @param subLoanRevision The revision number of the sub-loan.
     * @param trackedTimestamp The tracked timestamp of the sub-loan when its moratory interest rate was updated.
     * @param newRate The current moratory interest rate.
     * @param oldRate The previous moratory interest rate.
     */
    event SubLoanInterestRateMoratoryUpdated(
        uint256 indexed subLoanId,
        uint256 indexed subLoanRevision,
        uint256 trackedTimestamp,
        uint256 newRate,
        uint256 oldRate
    );

    /**
     * @dev Emitted when the late fee rate of a sub-loan is updated.
     *
     * @param subLoanId The unique identifier of the sub-loan.
     * @param subLoanRevision The revision number of the sub-loan.
     * @param trackedTimestamp The tracked timestamp of the sub-loan when its late fee rate was updated.
     * @param newRate The current late fee rate.
     * @param oldRate The previous late fee rate.
     */
    event SubLoanLateFeeRateUpdated(
        uint256 indexed subLoanId,
        uint256 indexed subLoanRevision,
        uint256 trackedTimestamp,
        uint256 newRate,
        uint256 oldRate
    );

    /**
     * @dev Emitted when a sub-loan is frozen.
     *
     * @param subLoanId The unique identifier of the sub-loan.
     * @param subLoanRevision The revision number of the sub-loan.
     * @param trackedTimestamp The tracked timestamp of the sub-loan when it was frozen.
     */
    event SubLoanFrozen(uint256 indexed subLoanId, uint256 indexed subLoanRevision, uint256 trackedTimestamp);

    /**
     * @dev Emitted when a sub-loan is frozen.
     *
     * @param subLoanId The unique identifier of the sub-loan.
     * @param subLoanRevision The revision number of the sub-loan.
     * @param trackedTimestamp The tracked timestamp of the sub-loan when it was unfrozen.
     */
    event SubLoanUnfrozen(uint256 indexed subLoanId, uint256 indexed subLoanRevision, uint256 trackedTimestamp);

    /**
     * @dev Emitted when a sub-loan is revoked.
     *
     * There is no tracked amounts due to they are all zero for a revoked sub-loan.
     *
     * @param subLoanId The unique identifier of the sub-loan.
     * @param subLoanRevision The revision number of the sub-loan.
     * @param trackedTimestamp The tracked timestamp of the sub-loan when it was revoked.
     */
    event SubLoanStatusUpdated(
        uint256 indexed subLoanId,
        uint256 indexed subLoanRevision,
        SubLoanStatus indexed newStatus,
        uint256 trackedTimestamp,
        SubLoanStatus oldStatus
    );

    /**
     * @dev Emitted when an operation is applied.
     *
     * @param subLoanId The unique identifier of the sub-loan.
     * @param operationId The unique identifier of the operation within the sub-loan.
     * @param kind The kind of the operation like repayment, discount, setting a new rate, etc.
     * @param timestamp The timestamp when the operation was applied.
     * @param inputValue The input value of the operation like the amount to repay, new rate, new duration, etc.
     * @param account The account related to the operation, e.g. the repayer.
     */
    // TODO: Consider replacing operationId => operationTimestamp
    event OperationApplied(
        uint256 indexed subLoanId,
        uint256 indexed operationId,
        OperationKind indexed kind,
        uint256 timestamp,
        uint256 inputValue, //TODO: consider another name, same for similar events
        address account //TODO: consider another name, same for similar events
    );

    /**
     * @dev Emitted when an operation is added to the list of sub-loan operations, but not yet applied.
     *
     * @param subLoanId The unique identifier of the sub-loan.
     * @param operationId The unique identifier of the operation within the sub-loan.
     * @param kind The kind of the operation like repayment, discount, setting a new rate, etc.
     * @param timestamp The timestamp when the operation will be applied.
     * @param inputValue The input value of the operation like the amount to repay, new rate, new duration, etc.
     * @param account The account related to the operation, e.g. the repayer.
     */
    event OperationPended(
        uint256 indexed subLoanId,
        uint256 indexed operationId,
        OperationKind indexed kind,
        uint256 timestamp,
        uint256 inputValue,
        address account
    );

    /**
     * @dev Emitted when a previously applied operation is voided.
     *
     * @param subLoanId The unique identifier of the sub-loan.
     * @param operationId The unique identifier of the operation.
     * @param kind The kind of the operation like repayment, discount, setting a new rate, etc.
     * @param counterparty The account related to the operation voiding, e.g. the receiver.
     */
    event OperationRevoked(
        uint256 indexed subLoanId,
        uint256 indexed operationId,
        OperationKind indexed kind,
        address counterparty
    );

    /**
     * @dev Emitted when a previously pending operation is voided.
     *
     * @param subLoanId The unique identifier of the sub-loan.
     * @param operationId The unique identifier of the operation within the sub-loan.
     * @param kind The kind of the operation like repayment, discount, setting a new rate, etc.
     */
    event OperationCanceled(uint256 indexed subLoanId, uint256 indexed operationId, OperationKind indexed kind);

    // TODO: add more events if needed
    // TODO: add more parameters to the existing events if needed
    // TODO: consider replacing a single repaymentAmount with its parts, same for
}

/**
 * @title ILendingMarketPrimaryV2 interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The primary part of the lending market contract interface.
 *
 * TODO
 */
interface ILendingMarketPrimaryV2 is ILendingMarketTypesV2, ILendingMarketPrimaryEventsV2 {
    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Takes a loan with multiple sub-loans for a provided borrower.
     *
     * Can be called only by an account with a special role.
     *
     * @param loanTakingRequest TODO
     * @return actualFirstSubLoanId The unique identifier of the first sub-loan of the loan.
     */
    function takeLoan(
        LoanTakingRequest calldata loanTakingRequest,
        SubLoanTakingRequest[] calldata subLoanTakingRequests
    ) external returns (uint256 actualFirstSubLoanId);

    /**
     * @dev Revokes a loan by the ID of any of its sub-loans.
     * @param subLoanId The unique identifier of the sub-loan to revoke.
     */
    function revokeLoan(uint256 subLoanId) external;

    /**
     * @dev Repays a batch of sub-loans.
     *
     * Can be called only by an account with a special role.
     *
     * @param repaymentRequests The request structures to repay the sub-loans.
     */
    function repaySubLoanBatch(RepaymentRequest[] calldata repaymentRequests) external;

    // TODO: Ask if discount can be greater than the principal amount

    /**
     * @dev Discounts a batch of sub-loans.
     *
     * Can be called only by an account with a special role.
     *
     * @param operationRequests The operation request structures to discount the sub-loans.
     */
    function discountSubLoanBatch(SubLoanOperationRequest[] calldata operationRequests) external;

    /**
     * @dev Sets the duration of a batch of sub-loans.
     *
     * Can be called only by an account with a special role.
     *
     * @param operationRequests The operation request structures to set the duration of the sub-loans.
     */
    function setSubLoanDurationBatch(SubLoanOperationRequest[] calldata operationRequests) external;

    /**
     * @dev Sets the remuneratory interest rate of a batch of sub-loans.
     *
     * Can be called only by an account with a special role.
     *
     * @param operationRequests The operation request structures to set the remuneratory interest rate of the sub-loans.
     */
    function setSubLoanInterestRateRemuneratoryBatch(
        SubLoanOperationRequest[] calldata operationRequests
    ) external;

    /**
     * @dev Sets the moratory interest rate of a batch of sub-loans.
     *
     * Can be called only by an account with a special role.
     *
     * @param operationRequests The operation request structures to set the moratory interest rate of the sub-loans.
     */
    function setSubLoanInterestRateMoratoryBatch(SubLoanOperationRequest[] calldata operationRequests) external;

    /**
     * @dev Sets the late fee rate of a batch of sub-loans.
     *
     * Can be called only by an account with a special role.
     *
     * @param operationRequests The operation request structures to set the late fee rate of the sub-loans.
     */
    function setSubLoanLateFeeRateBatch(SubLoanOperationRequest[] calldata operationRequests) external;

    /**
     * @dev Freezes a batch of sub-loans.
     *
     * Can be called only by an account with a special role.
     *
     * @param operationRequests The operation request structures to freeze the sub-loans.
     */
    function freezeSubLoanBatch(SubLoanOperationRequest[] calldata operationRequests) external;

    /**
     * @dev Unfreezes a batch of sub-loans.
     *
     * Can be called only by an account with a special role.
     *
     * @param operationRequests The operation request structures to unfreeze the sub-loans.
     */
    function unfreezeSubLoanBatch(SubLoanOperationRequest[] calldata operationRequests) external;

    /**
     * @dev Voids a batch of operations.
     *
     * Can be called only by an account with a special role.
     *
     * This function performs the following steps:
     * 1. Voids all operations specified in the void requests
     * 2. Recalculates affected sub-loan states if needed and emits corresponding events
     *
     * This atomic batch operation ensures data consistency when voiding multiple operations simultaneously.
     *
     * @param voidOperationRequests The requests to void the operations.
     */
    function voidOperationBatch(OperationVoidingRequest[] calldata voidOperationRequests) external;

    // ------------------ View functions -------------------------- //

    /**
     * @dev Gets the credit line and liquidity pool associated with a lending program.
     * @param programId The unique identifier of the lending program to check.
     * @return creditLine The address of the credit line associated with the lending program.
     * @return liquidityPool The address of the liquidity pool associated with the lending program.
     */
    function getProgramCreditLineAndLiquidityPool(
        uint32 programId
    ) external view returns (address creditLine, address liquidityPool);

    /**
     * @dev Gets the stored state for a batch of sub-loans.
     * @param subLoanIds The unique identifiers of the sub-loans to get
     * @return The stored states of the sub-loans
     */
    function getSubLoanStateBatch(uint256[] calldata subLoanIds) external view returns (SubLoan[] memory);

    /**
     * @dev Gets the sub-loan preview at a specific timestamp for a batch of sub-loans.
     * @param subLoanIds The unique identifiers of the sub-loans to get.
     * @param timestamp The timestamp to get the sub-loan preview for. If 0, the current timestamp is used.
     * @return The previews of the sub-loans.
     */
    function getSubLoanPreviewBatch(
        uint256[] calldata subLoanIds,
        uint256 timestamp
    ) external view returns (SubLoanPreview[] memory);

    /**
     * @dev Gets the preview of a loan at a specific timestamp.
     *
     * @param subLoanIds The unique identifiers of any sub-loan of the loan to get.
     * @param timestamp The timestamp to get the loan preview for. If 0, the current timestamp is used.
     * @return The preview state of the loan.
     */
    function getLoanPreviewBatch(
        uint256[] calldata subLoanIds,
        uint256 timestamp
    ) external view returns (LoanPreview[] memory);

    /**
     * @dev Gets the list of operations for a sub-loan in the order of their timestamp.
     *
     * @param subLoanId The unique identifier of the sub-loan to get the operations for.
     * @return The list of operations for the sub-loan.
     */
    function getSubLoanOperations(uint256 subLoanId) external view returns (OperationView[] memory);

    /// @dev Returns the rate factor used to for interest rate calculations.
    function interestRateFactor() external view returns (uint256);

    /**
     * @dev Returns time offset in seconds that is used to calculate the day boundary for the lending market.
     *
     * E.g. if the lending market is in the `America/Sao_Paulo` timezone (by default),
     * then the day boundary offset is `-3 * 3600` seconds
     * (3 hours before the UTC time).
     */
    function dayBoundaryOffset() external view returns (int256);

    /// @dev Returns the total number of sub-loans taken.
    function subLoanCounter() external view returns (uint256);

    /// @dev Returns the last autogenerated sub-loan ID.
    function lastSubLoanId() external view returns (uint256);

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
     * @dev Emitted when a new program is created.
     * @param programId The unique identifier of the program.
     */
    event ProgramCreated(uint256 indexed programId);

    /**
     * @dev Emitted when a program is updated.
     * @param programId The unique identifier of the program.
     * @param creditLine The address of the credit line associated with the program.
     * @param liquidityPool The address of the liquidity pool associated with the program.
     */
    event ProgramUpdated(
        uint256 indexed programId, // Tools: prevent Prettier one-liner
        address indexed creditLine,
        address indexed liquidityPool
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
    // TODO: add prefixes to error names, like "LendingMarket_..."
    // TODO: order by names

    /// @dev TODO
    error AlreadyConfigured();

    /// @dev Thrown when the addon treasury address is zero.
    error AddonTreasuryAddressZero();

    /// @dev TODO
    error BorrowerAddressZero();

    /// @dev TODO
    error EngineUnconfigured();

    /// @dev TODO
    error CreditLineAddressZero();

    /// @dev TODO
    error CreditLineAddressInvalid();

    /// @dev TODO
    error LiquidityPoolAddressZero();

    /// @dev TODO
    error LiquidityPoolAddressInvalid();

    /// @dev TODO
    error ImplementationAddressInvalid();

    /// @dev TODO
    error BlockTimestampExcess();

    /// @dev TODO
    error BorrowedAmountInvalidAmount();

    /// @dev TODO
    error AddonAmountInvalid();

    /// @dev TODO
    error PrincipalAmountInvalid();

    /// @dev TODO
    error SubLoanIdExcess();

    /// @dev Thrown when the sub-loan does not exist.
    error SubLoanNonexistent();

    /// @dev Thrown when the sub-loan is not frozen.
    error SubLoanNotFrozen();

    /// @dev Thrown when the loan is already repaid fully.
    error LoanStatusFullyRepaid();

    /// @dev Thrown when the loan is already frozen.
    error SubLoanAlreadyFrozen();

    /// @dev Thrown when the credit line is not configured for the provided lending program.
    error ProgramCreditLineNotConfigured();

    /// @dev Thrown when the liquidity pool is not configured for the provided lending program.
    error ProgramLiquidityPoolNotConfigured();

    /// @dev Thrown when the program does not exist.
    error ProgramNonexistent();

    /// @dev Thrown when the lending program ID exceeds the maximum allowed value.
    error ProgramIdExcess();

    /// @dev Thrown when the provided sub-loan durations are invalid.
    error SubLoanDurationsInvalid();

    /// @dev TODO
    error SubLoanBorrowedAmountInvalid(); // TODO: add parameters if needed

    /// @dev TODO
    error SubLoanDurationExcess(); // TODO: add parameters if needed

    /// @dev Thrown when the provided sub-loan duration is invalid.
    error DurationInvalid();

    /// @dev Thrown when the number of sub-loans to take is zero.
    error SubLoanCountZero();

    /// @dev Thrown when the number of sub-loans within a loan exceeds the maximum allowed value.
    error SubLoanCountExcess();

    /// @dev Thrown when the total number of sub-loans in the contracts exceeds the maximum allowed value.
    error SubLoanCounterExcess();

    /// @dev TODO
    error OperationTimestampInvalid(); // TODO: add parameters

    /// @dev TODO
    error OperationKindUnacceptable(); // TODO: add parameters

    /// @dev TODO
    error OperationKindInvalid(); // TODO: add parameters

    /// @dev TODO
    error OperationTimestampTooEarly(); // TODO: add parameters

    /// @dev TODO
    error OperationUnchanged(); // TODO: add parameters

    /// @dev TODO
    error RapayerAddressZero(); // TODO: add parameters

    /// @dev TODO
    error OperationAccountNotZero(); // TODO: add parameters

    /// @dev TODO
    error RepaymentOrDiscountAmountInvalid(); // TODO: add parameters

    /// @dev TODO
    error RepaymentExcess(); // TODO: add parameters

    /// @dev TODO
    error DiscountExcess(); // TODO: add parameters

    /// @dev TODO
    error RateValueInvalid(); // TODO: add parameters

    /// @dev TODO
    error OperationIdExcess(); // TODO: add parameters

    /// @dev TODO
    error OperationNonexistent(); // TODO: add parameters

    /// @dev TODO
    error OperationCanceledAlready(); // TODO: add parameters

    /// @dev TODO
    error OperationRevokedAlready(); // TODO: add parameters

    /// @dev TODO
    error SubLoanStatusFullyRepaid();

    /// @dev TODO
    error SubLoanStatusRevoked();

    /// @dev TODO
    error OperationInputValueInvalid(); // TODO: add parameters

    /// @dev TODO
    error OperationRequestArrayCounterpartyDifference(); // TODO: select a better name

    /// @dev TODO
    error SubLoanRevisionExcess(); //TODO: add parameters

    /// @dev TODO
    error OperationVoidingProhibited(); //TODO: add parameters

    /// @dev TODO
    error OperationRepaymentOrDiscountProhibitedInFuture(); //TODO: add parameters

    /// @dev TODO
    error UnauthorizedCallContext();

    /// @dev TODO
    error StartTimestampInvalid();

    /// @dev TODO
    error SubLoanExistentAlready(uint256 subLoanId);

    /// @dev TDODO
    error FirstSubLoanIdInvalid();
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
