// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

/**
 * @title ICreditLineTypes interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines types that are used in the credit line V2 contract.
 */
interface ICreditLineTypesV2 {
    /**
     * @dev Defines the available borrowing policies.
     *
     * Possible values:
     *
     *
     * - SingleActiveLoan = 0 -------- Only one active loan is allowed; additional loan requests will be rejected.
     * - MultipleActiveLoans = 1 ----- Multiple active loans are allowed, with no limit on the total borrowed amount.
     * - TotalActiveAmountLimit = 2 -- Multiple active loans are allowed, but their total borrowed amount cannot
     *                                 exceed the maximum borrowed amount of a single loan specified for the borrower.
     *
     * Note: In all cases, each individual loan must comply with the maximum amount limit.
     */
    // TODO use 0 for a prohibited account
    enum BorrowingPolicy {
        SingleActiveLoan,
        MultipleActiveLoans,
        TotalActiveAmountLimit
    }

    /**
     * @dev A struct that defines borrower configuration.
     *
     * Fields:
     *
     * - borrowingPolicy ---- The borrowing policy to be applied to the borrower.
     * - maxBorrowedAmount -- The maximum amount of tokens the borrower can take as a loan or several ones.
     */
    struct BorrowerConfig {
        // Slot 1
        BorrowingPolicy borrowingPolicy;
        uint64 maxBorrowedAmount;
        // uint184 __reserved; // Reserved until the end of the storage slot.
    }

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

    /**
     * @dev Defines the view of a borrower configuration.
     *
     * This struct is used as the return type of the appropriate view functions.
     *
     * Fields:
     *
     * - borrowingPolicy ---- The borrowing policy to be applied to the borrower.
     * - maxBorrowedAmount -- The maximum amount of tokens the borrower can take as a loan or several ones.
     */
    struct BorrowerConfigView {
        BorrowingPolicy borrowingPolicy;
        uint256 maxBorrowedAmount;
    }

    /**
     * @dev Defines the view of a borrower state.
     *
     * This struct is used as the return type of the appropriate view functions.
     *
     * Fields:
     *
     * - activeLoanCount -------- the number of active loans currently held by the borrower.
     * - closedLoanCount -------- the number of loans that have been closed, with or without a full repayment.
     * - totalActiveLoanAmount -- the total amount borrowed across all active loans.
     * - totalClosedLoanAmount -- the total amount that was borrowed across all closed loans.
     */
    struct BorrowerStateView {
        uint256 activeLoanCount;
        uint256 closedLoanCount;
        uint256 totalActiveLoanAmount;
        uint256 totalClosedLoanAmount;
    }
}

/**
 * @title ICreditLinePrimary interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The primary part of the credit line contract interface.
 */
interface ICreditLinePrimaryV2 is ICreditLineTypesV2 {
    // ------------------ Events ---------------------------------- //

    /**
     * @dev Emitted when a borrower is configured.
     * @param borrower The address of the borrower being configured.
     * @param borrowingPolicy The borrowing policy assigned to the borrower.
     * @param maxBorrowedAmount The maximum amount of tokens the borrower can take as a loan or several ones.
     */
    event BorrowerConfigured(
        address indexed borrower,
        BorrowingPolicy borrowingPolicy,
        uint256 maxBorrowedAmount
    );

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Configures a borrower.
     *
     * Can only be called by accounts with the admin role.
     *
     * Emits a {BorrowerConfigured} event.
     *
     * @param borrower The address of the borrower to configure.
     * @param borrowingPolicy The the borrowing police to be applied to the borrower.
     * @param maxBorrowedAmount The the maximum amount of tokens the borrower can take as loans.
     */
    function configureBorrower(
        address borrower,
        BorrowingPolicy borrowingPolicy,
        uint256 maxBorrowedAmount
    ) external;

    // ------------------ View functions -------------------------- //

    /**
     * @dev Retrieves the configuration of a borrower.
     * @param borrower The address of the borrower to check.
     * @return The structure containing the borrower configuration.
     */
    function getBorrowerConfiguration(address borrower) external view returns (BorrowerConfigView memory);

    /**
     * @dev Retrieves the state of a borrower combined from the current credit line and the linked credit line if any.
     * @param borrower The address of the borrower to check.
     * @return The structure containing the borrower state.
     */
    function getBorrowerState(address borrower) external view returns (BorrowerStateView memory);
}

/**
 * @title ICreditLineConfiguration interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The configuration part of the credit line contract interface.
 */
interface ICreditLineConfigurationV2 is ICreditLineTypesV2 {
    // ------------------ Events ---------------------------------- //

    /**
     * @dev Emitted when the linked credit line is changed.
     * @param newLinkedCreditLine The address of the new linked credit line.
     * @param oldLinkedCreditLine The address of the old linked credit line.
     */
    event LinkedCreditLineChanged(
        address newLinkedCreditLine,
        address oldLinkedCreditLine
    );

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Sets the linked credit line.
     *
     * Can only be called by accounts with the owner role.
     *
     * Emits a {LinkedCreditLineChanged} event.
     *
     * @param newLinkedCreditLine The address of the new linked credit line to set.
     */
    function setLinkedCreditLine(address newLinkedCreditLine) external;

    // ------------------ View functions -------------------------- //

    /**
     * @dev Retrieves the address of the linked credit line.
     *
     * The linked credit line is used to take into account the state of a borrower on it within the current credit line.
     * 
     * 
     *
     * @return The address of the linked credit line.
     */
    function linkedCreditLine() external returns (address);
}

/**
 * @title ICreditLineHooks interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The hooks part of the credit line contract interface.
 */
interface ICreditLineHooksV2 {
    /**
     * @dev A hook that is triggered by a loan operator before a loan is opened or reopened
     * @param borrower The address of the borrower.
     * @param borrowedAmount The borrowed amount of the loan.
     */
    function onBeforeLoanOpened(address borrower, uint256 borrowedAmount) external;

    /**
     * @dev A hook that is triggered by a loan operator after a loan is closed due to full repayment or revocation.
     * @param borrower The address of the borrower.
     * @param borrowedAmount The borrowed amount of the loan.
     */
    function onAfterLoanClosed(address borrower, uint256 borrowedAmount) external;
}

/**
 * @title ICreditLineErrors interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the custom errors used in the credit line contract.
 */
interface ICreditLineErrorsV2 {
    // TODO Order alphabetically

    /// @dev Thrown when the borrower configuration is invalid.
    error CreditLine_BorrowerConfigurationInvalid();

    /// @dev TODO
    error CreditLine_LinkedCreditLineUnchanged();

    /// @dev TODO
    error CreditLine_LinkedCreditLineNotContract();

    /// @dev TODO
    error CreditLine_LinkedCreditLineContractInvalid();

    /// @dev TODO
    error CreditLine_LinkedCreditLineVersionInvalid();

    /// @dev TODO
    error CreditLine_BorrowerAddressZero();

    /// @dev TODO
    error CreditLine_MaxBorrowedAmountZero();

    /// @dev TODO
    error CreditLine_MaxBorrowedAmountExcess();

    /// @dev Thrown when another loan is requested by an account but only one active loan is allowed.
    error CreditLine_LimitViolationOnSingleActiveLoan();

    /// @dev Thrown when the total borrowed amount of active loans exceeds the maximum borrowed amount of a single loan.
    error CreditLone_LimitViolationOnTotalActiveLoanAmount(uint256 newTotalActiveLoanAmount);

    /// @dev Thrown when the borrower state counters or amounts would overflow their maximum values.
    error CreditLine_BorrowerStateOverflow();
}

/**
 * @title ICreditLineV2 interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the full interface of the credit line V2 contract.
 */
interface ICreditLineV2 is ICreditLinePrimaryV2, ICreditLineConfigurationV2, ICreditLineHooksV2, ICreditLineErrorsV2 {
    /// @dev Proves the contract is the credit line one. A marker function.
    function proveCreditLine() external pure;
}
