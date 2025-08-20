// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title ICreditLineV1 interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The simplified version of the credit line V1 contract interface.
 */
interface ICreditLineV1 {
    // ------------------ Types ---------------------------------- //

    /**
     * @dev Defines a borrower state.
     *
     * Fields:
     *
     * - activeLoanCount -------- the number of active loans currently held by the borrower.
     * - closedLoanCount -------- the number of loans that have been closed, with or without a full repayment.
     * - totalActiveLoanAmount -- the total amount borrowed across all active loans.
     * - totalClosedLoanAmount -- the total amount that was borrowed across all closed loans.
     */
    struct BorrowerState {
        // Slot 1
        uint16 activeLoanCount;
        uint16 closedLoanCount;
        uint64 totalActiveLoanAmount;
        uint64 totalClosedLoanAmount;
        // uint96 __reserved; // Reserved until the end of the storage slot.
    }

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Retrieves the state of a borrower.
     * @param borrower The address of the borrower to check.
     * @return The structure containing the borrower state.
     */
    function getBorrowerState(address borrower) external view returns (BorrowerState memory);
}
