// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

/**
 * @title TODO
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev TODO
 */
library LoanV2 {
    /**
     * @dev TODO.
     */
    enum SubLoanStatus {
        Nonexistent,
        Active,
        FullyRepaid,
        Revoked
    }

    /**
     * @dev The status of a loan or sub-loan operation.
     *
     * Possible values: TODO
     */
    enum OperationStatus {
        Nonexistent,
        Pending,
        Executed,
        Skipped
    }

    /**
     * @dev The type of a loan or sub-loan operation.
     *
     * Possible values: TODO
     */
    enum OperationKind {
        Nonexistent,
        Repayment,
        Discounting,
        Revocation,
        Freezing,
        Unfreezing,
        ChangeInInterestRateRemuneratory,
        ChangeInInterestRateMoratory,
        ChangeInLateFeeRate,
        ChangeInDuration,
        NonexistentLimit
    }

    /**
     * @dev TODO
     *
     * Possible values: TODO
     */
    enum SubLoanPartKind {
        Principal,
        InterestRemuneratory,
        InterestMoratory,
        LateFee
    }


    /**
     * @dev TODO
     */
    struct SubLoan {
        // Slot1
        uint24 programId; // V2-NOTE: former 'uint32', TODO: can be uint16
        uint64 borrowedAmount;
        uint64 addonAmount;
        uint40 firstSubLoanId; // V2-NOTE: former `firstInstallmentId`
        uint16 subLoanCount; // V2-NOTE: former `installmentCount`
        uint32 startTimestamp;
        uint16 initialDuration; // V2-NOTE: former 'uint32 durationInPeriods'
        // No reserve until the end of the storage slot

        // V2-NOTE: the `token` field has been moved to the market config

        // Slot 2
        address borrower;
        uint32 initialInterestRateRemuneratory;
        uint32 initialInterestRateMoratory;
        uint32 initialLateFeeRate;
        // No reserve until the end of the storage slot

        // Slot3
        SubLoanStatus status;
        uint32 interestRateRemuneratory;
        uint32 interestRateMoratory;
        uint32 lateFeeRate;
        uint16 duration;
        uint32 trackedTimestamp;
        uint32 freezeTimestamp;
        uint64 discountAmount;
        // uint8 __reserved; // Reserved until the end of the storage slot

        // Slot 4
        uint64 trackedPrincipal;
        uint64 trackedInterestRemuneratory;
        uint64 trackedInterestMoratory;
        uint64 trackedLateFee;
        // No reserve until the end of the storage slot

        // Slot 5
        uint64 repaidPrincipal;
        uint64 repaidInterestRemuneratory;
        uint64 repaidInterestMoratory;
        uint64 repaidLateFee;
        // No reserve until the end of the storage slot
    }

    /**
     * @dev TODO
     */
    struct Operation {
        // Slot1
        OperationStatus status;
        OperationKind kind;
        uint16 nextOperationId;
        uint16 prevOperationId;
        uint32 timestamp;
        uint64 parameter1;
        uint64 parameter2;
        // uint48 __reserved; // Reserved until the end of the storage slot

        // Slot2
        address parameter3;
        // uint96 __reserved; // Reserved until the end of the storage slot
    }

    /**
     * @dev TODO
     */
    struct ProcessingOperation {
        uint256 id;
        uint256 status;
        uint256 kind;
        uint256 timestamp;
        uint256 parameter1;
        uint256 parameter2;
        address parameter3;
    }

    /**
     * @dev TODO
     */
    struct OperationalState {
        // Slot 1
        uint16 operationCount;
        uint16 earliestOperationId;
        uint16 latestOperationId;
        uint16 pastOperationId;
        // uint192 __reserved; // Reserved until the end of the storage slot

        // Slot 2
        mapping(uint256 operationIndex => Operation) operations;
    }

    /**
     * @dev TODO
     */
    struct ProcessingSubLoan {
        uint256 id;
        uint256 status;
        uint256 programId;
        uint256 flags; // TODO: use it to mark fields that actually changed during processing
        uint256 startTimestamp;
        uint256 duration;
        uint256 interestRateRemuneratory;
        uint256 interestRateMoratory;
        uint256 lateFeeRate;
        uint256 trackedPrincipal;
        uint256 trackedInterestRemuneratory;
        uint256 trackedInterestMoratory;
        uint256 trackedLateFee;
        uint256 repaidPrincipal;
        uint256 repaidInterestRemuneratory;
        uint256 repaidInterestMoratory;
        uint256 repaidLateFee;
        uint256 trackedTimestamp;
        uint256 freezeTimestamp;
        uint256 discountAmount;
    }

    /**
     * @dev A struct that defines the terms of a loan.
     * TODO
     */
    struct Terms {
        uint256 duration;
        uint256 interestRateRemuneratory;
        uint256 interestRateMoratory;
        uint256 lateFeeRate;
    }

    /**
     * @dev A struct that defines the preview of a sub-loan.
     * TODO
     */
    struct SubLoanPreview {
        uint256 day;
        address borrower;
        uint256 programId;
        uint256 borrowedAmount;
        uint256 addonAmount;
        uint256 previewTimestamp;
        uint256 startTimestamp;
        uint256 trackedTimestamp;
        uint256 freezeTimestamp;
        uint256 durationInDays;
        uint256 interestRateRemuneratory;
        uint256 interestRateMoratory;
        uint256 lateFeeRate;
        uint256 firstInstallmentId;
        uint256 installmentCount;
        uint256 trackedPrincipal;
        uint256 trackedInterestRemuneratory;
        uint256 trackedInterestMoratory;
        uint256 lateFeeAmount;
        uint256 discountAmount;
        uint256 repaidPrincipal;
        uint256 repaidInterestRemuneratory;
        uint256 repaidInterestMoratory;
        uint256 repaidLateFee;
        uint256 nextIndexInOperationQueue;
        // TODO: reorder and add more fields
    }

    /**
     * @dev A struct that defines the preview of a loan.
     * TODO
     *
     * Notes:
     *
     * 1. The `totalTrackedBalance` fields calculates as the sum of tracked balances of all installments.
     * 2. The `totalOutstandingBalance` fields calculates as the sum of outstanding balances of all installments.
     * 3. The outstanding balance is the tracked balance rounded according to the accuracy factor with math rules.
     */
    struct LoanPreview {
        uint256 firstInstallmentId;
        uint256 installmentCount;
        uint256 periodIndex;
        uint256 totalTrackedBalance;
        uint256 totalOutstandingBalance;
        uint256 totalBorrowedAmount;
        uint256 totalAddonAmount;
        uint256 totalRepaidAmount;
        uint256 totalLateFeeAmount;
        uint256 totalDiscountAmount;
        SubLoanPreview[] subLoanPreviews;
        // TODO: reorder and add more fields
    }
}
