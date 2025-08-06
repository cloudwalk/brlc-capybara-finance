// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

/**
 * @title LoanV2 library
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev This library contains the core data structures and enums used in the LendingMarketV2 contract.
 */
library LoanV2 {
    /**
     * @dev TODO.
     */
    enum SubLoanStatus {
        Nonexistent,
        Ongoing,
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
        Applied,
        Skipped, // TODO Unused, but need to reserve value 3 for future usage, because statuses >3 are voided
        Canceled,
        Revoked
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
        Freezing, // TODO implement
        Unfreezing, // TODO implement
        SetInterestRateRemuneratory, // TODO implement
        SetInterestRateMoratory, // TODO implement
        SetLateFeeRate, // TODO implement
        SetDuration // TODO implement
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
        uint8 revision; // TODO: make uint16, do not forget to check conversion statements
        uint16 duration;
        uint32 interestRateRemuneratory;
        uint32 interestRateMoratory;
        uint32 lateFeeRate;
        uint32 trackedTimestamp;
        uint32 freezeTimestamp;
        uint16 operationCount;
        uint16 earliestOperationId;
        uint16 pastOperationId; //TODO: rename to recentOperationId
        uint16 latestOperationId; //TODO: consider removing this field as redundant
        // No reserve until the end of the storage slot

        // Slot 4 //trackedBalance
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

        // Slot 6
        uint64 discountPrincipal; // Must not be used, just for alignment
        uint64 discountInterestRemuneratory;
        uint64 discountInterestMoratory;
        uint64 discountLateFee;
        // No reserve until the end of the storage slot
    }

    /**
     * @dev TODO
     */
    struct ProcessingSubLoan {
        uint256 id;
        uint256 status;
        uint256 revision;
        uint256 programId;
        address borrower;
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
        uint256 discountPrincipal;
        uint256 discountInterestRemuneratory;
        uint256 discountInterestMoratory;
        uint256 discountLateFee;
        uint256 trackedTimestamp;
        uint256 freezeTimestamp;
        address counterparty;
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
        uint64 inputValue;
        // uint112 __reserved; // Reserved until the end of the storage slot

        // Slot2
        address account;
        // uint96 __reserved; // Reserved until the end of the storage slot
    }

    /**
     * @dev TODO
     */
    struct ProcessingOperation {
        uint256 id;
        uint256 initialStatus;
        uint256 status;
        uint256 kind;
        uint256 timestamp;
        uint256 inputValue;
        address account;
        uint256 oldSubLoanValue;
        uint256 newSubLoanValue;
        uint256 initialSubLoanStatus; // TODO: try to remove this field, if possible
    }

    /**
     * @dev TODO
     */
    struct OperationView {
        uint256 id;
        uint256 status;
        uint256 kind;
        uint256 timestamp;
        uint256 inputValue;
        address account;
    }

    /**
     * @dev TODO
     */
    struct RepaymentRequest {
        uint256 subLoanId;
        uint256 timestamp;
        uint256 repaymentAmount;
        address repayer;
    }

    /**
     * @dev TODO
     */
    struct DiscountRequest {
        uint256 subLoanId;
        uint256 timestamp;
        uint256 discountAmount;
    }

    /**
     * @dev TODO
     */
    struct SubLoanOperationRequest {
        uint256 subLoanId;
        uint256 timestamp;
        uint256 value;
    }

    /**
     * @dev TODO
     */
    struct VoidOperationRequest {
        uint256 subLoanId;
        uint256 operationId;
        address counterparty;
    }

    /**
     * @dev TODO
     */
    struct AddedOperationRequest {
        uint256 subLoanId;
        uint256 kind;
        uint256 timestamp;
        uint256 inputValue;
        address account;
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
        uint256 startTimestamp;
        uint256 trackedTimestamp;
        uint256 freezeTimestamp;
        uint256 duration;
        uint256 interestRateRemuneratory;
        uint256 interestRateMoratory;
        uint256 lateFeeRate;
        uint256 firstInstallmentId;
        uint256 subLoanCount;
        uint256 trackedPrincipal;
        uint256 trackedInterestRemuneratory;
        uint256 trackedInterestMoratory;
        uint256 trackedLateFee;
        uint256 outstandingBalance;
        uint256 repaidPrincipal;
        uint256 repaidInterestRemuneratory;
        uint256 repaidInterestMoratory;
        uint256 repaidLateFee;
        uint256 discountInterestRemuneratory;
        uint256 discountInterestMoratory;
        uint256 discountLateFee;
        // TODO: reorder and add more fields if needed
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
        uint256 firstSubLoanId;
        uint256 subLoanCount;
        uint256 day;
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
