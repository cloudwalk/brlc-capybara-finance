// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { LoanV2 } from "../libraries/LoanV2.sol";
import {IERC20} from "../../flatten/LendingMarketFlat.sol";

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
        // TODO: Ask if more parameters are needed: rates, etc.
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
        uint256 totalBorrowedAmount,
        uint256 totalAddonAmount,
        uint256 subLoanCount
    );

    /**
     * @dev Emitted when a loan is fully revoked by revocation of all its sub-loans.
     * @param firstSubLoanId The ID of the first sub-loan of the  loan.
     * @param borrower TODO.
     * @param subLoanCount The total number of sub-loans.
     */
    event LoanRevoked(
        uint256 indexed firstSubLoanId, // Tools: this comment prevents Prettier from formatting into a single line.
        address indexed borrower,
        uint256 subLoanCount
    );

    /**
     * @dev Emitted when the repaid amount of a sub-loan is updated.
     * 
     * Notes about the event parameters:
     *
     * 1. The `packedMainParameters` value is a bitfield with the following bits:
     * 
     * - 8 bits from 0 to 7: the sub-loan status.
     * - 8 bits from 8 to 15: reserved.
     * - 16 bits from 16 to 31: the sub-loan duration.
     * - 32 bits from 32 to 63: the remuneratory interest rate.
     * - 32 bits from 64 to 95: the moratory interest rate.
     * - 32 bits from 96 to 127: the late fee rate.
     * - 32 bits from 128 to 159: the tracked timestamp.
     * - 32 bits from 160 to 191: the freeze timestamp.
     * - 40 bits from 192 to 231: the first sub-loan ID.
     * - 16 bits from 232 to 247: the sub-loan count.
     * 
     * 2. Any `...packed...Parts` value is a bitfield with the following bits:
     * 
     * - 64 bits from 0 to 63: the principal.
     * - 64 bits from 64 to 127: the remuneratory interest.
     * - 64 bits from 128 to 191: the moratory interest.
     * - 64 bits from 192 to 255: the late fee.
     * 
     * @param subLoanId The unique identifier of the sub-loan.
     * @param borrower The address of the borrower of the loan.
     * @param packedMainParameters The packed main parameters of the sub-loan.
     * @param packedRepaidParts The packed repaid parts of the sub-loan.
     * @param packedDiscountParts The packed discount parts of the sub-loan.
     * @param packedTrackedParts The packed tracked parts of the sub-loan.
     * @param newRepaidAmount The new repaid amount as a sum of all repaid parts.
     * @param oldRepaidAmount The old repaid amount as a sum of all repaid parts.
     * @param oldPackedRepaidParts The old packed repaid parts of the sub-loan.
     */
    event SubLoanRepaymentUpdated (
        uint256 indexed subLoanId,
        address indexed borrower,
        bytes32 packedMainParameters,
        bytes32 packedRepaidParts,
        bytes32 packedDiscountParts,
        bytes32 packedTrackedParts,
        uint256 newRepaidAmount,
        uint256 oldRepaidAmount,
        bytes32 oldPackedRepaidParts
    );

    /**
     * @dev Emitted when the discount amount of a sub-loan is updated.
     * 
     * See notes about the event parameters in the `SubLoanRepaymentUpdated` event.
     * 
     * @param subLoanId The unique identifier of the sub-loan.
     * @param borrower The address of the borrower of the loan.
     * @param packedMainParameters The packed main parameters of the sub-loan.
     * @param packedRepaidParts The packed repaid parts of the sub-loan.
     * @param packedDiscountParts The packed discount parts of the sub-loan.
     * @param packedTrackedParts The packed tracked parts of the sub-loan.
     * @param newDiscountAmount The new discount amount as a sum of all discount parts.
     * @param oldDiscountAmount The old discount amount as a sum of all discount parts.
     * @param oldPackedDiscountParts The old packed discount parts of the sub-loan.
     */
    event SubLoanDiscountUpdated (
        uint256 indexed subLoanId,
        address indexed borrower,
        bytes32 packedMainParameters,
        bytes32 packedRepaidParts,
        bytes32 packedDiscountParts,        
        bytes32 packedTrackedParts,
        uint256 newDiscountAmount,
        uint256 oldDiscountAmount,
        bytes32 oldPackedDiscountParts
    );

    /**
     * @dev Emitted when the remuneratory interest rate of a sub-loan is updated.
     * 
     * See notes about the event parameters in the `SubLoanRepaymentUpdated` event.
     * 
     * @param subLoanId The unique identifier of the sub-loan.
     * @param borrower The address of the borrower of the loan.
     * @param packedMainParameters The packed main parameters of the sub-loan.
     * @param packedRepaidParts The packed repaid parts of the sub-loan.
     * @param packedDiscountParts The packed discount parts of the sub-loan.
     * @param packedTrackedParts The packed tracked parts of the sub-loan.
     * @param newRate The new remuneratory interest rate.
     * @param oldRate The old remuneratory interest rate.
     */
    event SubLoanInterestRateRemuneratoryUpdated(
        uint256 indexed subLoanId,
        address indexed borrower,
        bytes32 packedMainParameters,
        bytes32 packedRepaidParts,
        bytes32 packedDiscountParts,
        bytes32 packedTrackedParts,
        uint256 newRate,
        uint256 oldRate
    );

    /**
     * @dev Emitted when the moratory interest rate of a sub-loan is updated.
     * 
     * See notes about the event parameters in the `SubLoanRepaymentUpdated` event.
     * 
     * @param subLoanId The unique identifier of the sub-loan.
     * @param borrower The address of the borrower of the loan.
     * @param packedMainParameters The packed main parameters of the sub-loan.
     * @param packedRepaidParts The packed repaid parts of the sub-loan.
     * @param packedDiscountParts The packed discount parts of the sub-loan.
     * @param packedTrackedParts The packed tracked parts of the sub-loan.
     * @param newRate The new moratory interest rate.
     * @param oldRate The old moratory interest rate.
     */
    event SubLoanInterestRateMoratoryUpdated(
        uint256 indexed subLoanId,
        address indexed borrower,
        bytes32 packedMainParameters,
        bytes32 packedRepaidParts,
        bytes32 packedDiscountParts,
        bytes32 packedTrackedParts,
        uint256 newRate,
        uint256 oldRate
    );

    /**
     * @dev Emitted when the late fee rate of a sub-loan is updated.
     * 
     * See notes about the event parameters in the `SubLoanRepaymentUpdated` event.
     * 
     * @param subLoanId The unique identifier of the sub-loan.
     * @param borrower The address of the borrower of the loan.
     * @param packedMainParameters The packed main parameters of the sub-loan.
     * @param packedRepaidParts The packed repaid parts of the sub-loan.
     * @param packedDiscountParts The packed discount parts of the sub-loan.
     * @param packedTrackedParts The packed tracked parts of the sub-loan.
     * @param newRate The new late fee rate.
     * @param oldRate The old late fee rate.
     */
    event SubLoanLateFeeRateUpdated(
        uint256 indexed subLoanId,
        address indexed borrower,
        bytes32 packedMainParameters,
        bytes32 packedRepaidParts,
        bytes32 packedDiscountParts,
        bytes32 packedTrackedParts,
        uint256 newRate,
        uint256 oldRate
    );

    /**
     * @dev Emitted when the duration in days of a sub-loan is updated.
     * 
     * See notes about the event parameters in the `SubLoanRepaymentUpdated` event.
     * 
     * @param subLoanId The unique identifier of the sub-loan.
     * @param borrower The address of the borrower of the loan.
     * @param packedMainParameters The packed main parameters of the sub-loan.
     * @param packedRepaidParts The packed repaid parts of the sub-loan.
     * @param packedDiscountParts The packed discount parts of the sub-loan.
     * @param packedTrackedParts The packed tracked parts of the sub-loan.
     * @param newDuration The new duration.
     * @param oldDuration The old duration.
     */
    event SubLoanDurationUpdated(
        uint256 indexed subLoanId,
        address indexed borrower,
        bytes32 packedMainParameters,
        bytes32 packedRepaidParts,
        bytes32 packedDiscountParts,
        bytes32 packedTrackedParts,
        uint256 newDuration,
        uint256 oldDuration
    );

    /**
     * @dev Emitted when a sub-loan is frozen.
     * 
     * See notes about the event parameters in the `SubLoanRepaymentUpdated` event.
     * 
     * @param subLoanId The unique identifier of the sub-loan.
     * @param borrower The address of the borrower of the loan.
     * @param packedMainParameters The packed main parameters of the sub-loan.
     * @param packedRepaidParts The packed repaid parts of the sub-loan.
     * @param packedDiscountParts The packed discount parts of the sub-loan.
     * @param packedTrackedParts The packed tracked parts of the sub-loan.
     */
    event SubLoanFrozen(
        uint256 indexed subLoanId,
        address indexed borrower,
        bytes32 packedMainParameters,
        bytes32 packedRepaidParts,
        bytes32 packedDiscountParts,
        bytes32 packedTrackedParts
    );

    /**
     * @dev Emitted when a sub-loan is frozen.
     * 
     * See notes about the event parameters in the `SubLoanRepaymentUpdated` event.
     * 
     * @param subLoanId The unique identifier of the sub-loan.
     * @param borrower The address of the borrower of the loan.
     * @param packedMainParameters The packed main parameters of the sub-loan.
     * @param packedRepaidParts The packed repaid parts of the sub-loan.
     * @param packedDiscountParts The packed discount parts of the sub-loan.
     * @param packedTrackedParts The packed tracked parts of the sub-loan.
     */
    event SubLoanUnfrozen(
        uint256 indexed subLoanId,
        address indexed borrower,
        bytes32 packedMainParameters,
        bytes32 packedRepaidParts,
        bytes32 packedDiscountParts,
        bytes32 packedTrackedParts
    );

    /**
     * @dev Emitted when a sub-loan is revoked.
     * 
     * See notes about the event parameters in the `SubLoanRepaymentUpdated` event.
     * 
     * There is no tracked amounts due to they are all zero for a revoked sub-loan.
     * 
     * @param subLoanId The unique identifier of the sub-loan.
     * @param borrower The address of the borrower of the loan.
     * @param packedMainParameters The packed main parameters of the sub-loan.
     * @param packedRepaidParts The packed repaid parts of the sub-loan.
     * @param packedDiscountParts The packed discount parts of the sub-loan.
     */
    event SubLoanRevoked(
        uint256 indexed subLoanId,
        address indexed borrower,
        bytes32 packedMainParameters,
        bytes32 packedRepaidParts,
        bytes32 packedDiscountParts
    );


    // TODO: We don't have any events for individual sub-loan value changes. Ask what we need to add.

    /**
     * @dev TODO
     */
    event OperationPended(
        uint256 indexed subLoanId,
        uint256 indexed operationId,
        uint256 indexed kind,
        uint256 timestamp,
        uint256 parameter, //TODO: consider another name, same for similar events
        address account //TODO: consider another name, same for similar events
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
        uint256 appliedValue
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
        address counterparty,
        uint256 appliedValue,
        uint256 previousStatus
    );

    // TODO: add more events if needed
    // TODO: add more parameters to the existing events if needed
    // TODO: consider replacing a single repaymentAmount with its parts, same for

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
     */
    function takeLoan(
        address borrower,
        uint32 programId,
        uint256[] calldata borrowedAmounts,
        uint256[] calldata addonAmounts,
        uint256[] calldata durations
    ) external returns (uint256 firstSubLoanId);

    /**
     * @dev Repays a batch of sub-loans.
     *
     * Can be called only by an account with a special role.
     * Using `type(uint256).max` for the `repaymentAmount` will repay the remaining balance of the loan.
     *
     * @param subLoanIds The unique identifiers of the sub-loans to repay.
     * @param repaymentAmounts The amounts to repay for each sub-loan in the batch.
     * @param repayers The addresses of the token sources for the repayments (borrower or third-party).
     */
    function repaySubLoanBatch(
        uint256[] calldata subLoanIds,
        uint256[] calldata repaymentAmounts,
        address[] calldata repayers // TODO: if address is zero, then it's a borrower
    ) external;

    /**
     * @dev Discounts a batch of sub-loans.
     *
     * Can be called only by an account with a special role.
     * Using `type(uint256).max` for the `discountAmount` will discount the remaining balance of the sub-loan.
     *
     * @param subLoanIds The unique identifiers of the sub-loans to discount.
     * @param discountAmounts The amounts to discount for each sub-loan in the batch.
     */
    function discountSubLoanBatch( // TODO: Ask if discount can be greater than the principal amount
        uint256[] calldata subLoanIds, // Tools: this comment prevents Prettier from formatting into a single line.
        uint256[] calldata discountAmounts
    ) external;

    /**
     * @dev Revokes a loan by the ID of any of its sub-loans.
     * @param subLoanId The unique identifier of the sub-loan to revoke.
     */
    function revokeLoan(uint256 subLoanId) external;

    /**
     * @dev Modifies a batch of operations.
     * @param voidOperationRequests The requests to void the operations.
     * @param addedOperationRequests The requests to add the operations.
     */
    function modifyOperationBatch(
        LoanV2.VoidOperationRequest[] calldata voidOperationRequests,
        LoanV2.AddedOperationRequest[] calldata addedOperationRequests
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
    function getSubLoanStateBatch(uint256[] calldata subLoanIds) external view returns (LoanV2.SubLoan[] memory);

    /**
     * @dev Gets the sub-loan preview at a specific timestamp for a batch of sub-loans.
     * @param subLoanIds The unique identifiers of the sub-loans to get.
     * @param timestamp The timestamp to get the sub-loan preview for. If 0, the current timestamp is used.
     * @return The previews of the sub-loans (see the `LoanV2.SubLoanPreview` struct).
     */
    function getSubLoanPreviewBatch(
        uint256[] calldata subLoanIds,
        uint256 timestamp
    ) external view returns (LoanV2.SubLoanPreview[] memory);

    /**
     * @dev Gets the preview of a loan at a specific timestamp.
     *
     * @param subLoanIds The unique identifiers of any sub-loan of the loan to get.
     * @param timestamp The timestamp to get the loan preview for. If 0, the current timestamp is used.
     * @return The preview state of the loan (see the `LoanV2.LoanPreview` structure).
     */
    function getLoanPreviewBatch(
        uint256[] calldata subLoanIds,
        uint256 timestamp
    ) external view returns (LoanV2.LoanPreview[] memory);

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

    /// @dev Thrown when the addon treasury address is zero.
    error AddonTreasuryAddressZero();

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

    /// @dev Thrown when the provided duration array is invalid.
    error DurationArrayInvalid();

    /// @dev Thrown when the provided sub-loan duration is invalid.
    error DurationInvalid();

    /// @dev Thrown when the sub-loan count exceeds the maximum allowed value.
    error SubLoanCountExcess();

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
    error RepaymentOrDiscountAmountExcess(); // TODO: add parameters

    /// @dev TODO
    error RateValueInvalid(); // TODO: add parameters

    /// @dev TODO
    error OperationIdExcess(); // TODO: add parameters

    /// @dev TODO
    error OperationNonexistent(); // TODO: add parameters

    /// @dev TODO
    error OperationVoidedAlready(); // TODO: add parameters

    /// @dev TODO
    error SubLoanStatusFullyRepaid();

    /// @dev TODO
    error SubLoanStatusRevoked();

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
