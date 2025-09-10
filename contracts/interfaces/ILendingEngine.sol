// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { ILendingMarketTypesV2 } from "./ILendingMarketV2.sol";

/**
 * @title ILendingEngine interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The lending engine contract interface.
 *
 * TODO
 *
 * All engine functions must be called through `delegatecall` from the `LendingMarket` contract.
 */
interface ILendingEngine is ILendingMarketTypesV2 {
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

    /**-
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

    // ------------------ Pure functions ------------------ //

    /// @dev Proves the contract is the lending market engine one. A marker function.
    function proveLendingEngine() external pure;
}

