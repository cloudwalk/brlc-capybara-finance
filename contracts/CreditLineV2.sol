// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { AccessControlExtUpgradeable } from "./base/AccessControlExtUpgradeable.sol";
import { PausableExtUpgradeable } from "./base/PausableExtUpgradeable.sol";
import { UUPSExtUpgradeable } from "./base/UUPSExtUpgradeable.sol";
import { Versionable } from "./base/Versionable.sol";

import { ICreditLineV1 } from "./interfaces/ICreditLineV1.sol";
import { ICreditLineV2 } from "./interfaces/ICreditLineV2.sol";
import { ICreditLineConfigurationV2 } from "./interfaces/ICreditLineV2.sol";
import { ICreditLineHooksV2 } from "./interfaces/ICreditLineV2.sol";
import { ICreditLinePrimaryV2 } from "./interfaces/ICreditLineV2.sol";
import { IVersionable } from "./interfaces/IVersionable.sol";

import { CreditLineStorageLayoutV2 } from "./storage/CreditLineStorageLayoutV2.sol";

/**
 * @title CreditLineV2 contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The upgradeable credit line contract.
 */
contract CreditLineV2 is
    CreditLineStorageLayoutV2,
    AccessControlExtUpgradeable,
    PausableExtUpgradeable,
    Versionable,
    UUPSExtUpgradeable,
    ICreditLineV2
{

    // ------------------ Constants ------------------------------- //

    /// @dev The role of an loan operator that is allowed to call hook functions.
    bytes32 public constant LOAN_OPERATOR_ROLE = keccak256("LOAN_OPERATOR_ROLE");

    /// @dev The role of an admin that is allowed to configure borrowers.
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // ------------------ Constructor ----------------------------- //

    /**
     * @dev Constructor that prohibits the initialization of the implementation of the upgradeable contract.
     *
     * See details:
     * https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable#initializing_the_implementation_contract
     *
     * @custom:oz-upgrades-unsafe-allow constructor
     */
    constructor() {
        _disableInitializers();
    }

    // ------------------ Initializers ---------------------------- //

    /**
     * @dev Initializer of the upgradeable contract.
     * See details https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable.
     */
    function initialize( ) external initializer {
        __AccessControlExt_init_unchained();
        __PausableExt_init_unchained();
        __UUPSExt_init_unchained();

        _setRoleAdmin(ADMIN_ROLE, GRANTOR_ROLE);
        _setRoleAdmin(LOAN_OPERATOR_ROLE, GRANTOR_ROLE);
        _grantRole(OWNER_ROLE, _msgSender());
    }

    // ----------- Configuration transactional functions ---------- //

    /// @inheritdoc ICreditLineConfigurationV2
    function setLinkedCreditLine(address newLinkedCreditLine) external onlyRole(OWNER_ROLE) {
        CreditLineStorageV2 storage $ = _getCreditLineStorage();
        address oldLinkedCreditLine = $.linkedCreditLine;
        if (newLinkedCreditLine == oldLinkedCreditLine) {
            revert CreditLine_LinkedCreditLineUnchanged();
        }
        if (newLinkedCreditLine != address(0)) {
            if (newLinkedCreditLine.code.length == 0) {
                revert CreditLine_LinkedCreditLineNotContract();
            }
            try ICreditLineV1(newLinkedCreditLine).proveCreditLine() {} catch {
                revert CreditLine_LinkedCreditLineContractInvalid();
            }

            if (IVersionable(newLinkedCreditLine).$__VERSION().major != 1) {
                revert CreditLine_LinkedCreditLineVersionInvalid();
            }
        }

        $.linkedCreditLine = newLinkedCreditLine;

        emit LinkedCreditLineChanged(newLinkedCreditLine, oldLinkedCreditLine);
    }

    // -------------- Primary transactional functions ------------- //

    /// @inheritdoc ICreditLinePrimaryV2
    function configureBorrower(
        address borrower,
        BorrowingPolicy borrowingPolicy,
        uint256 maxBorrowedAmount
    ) external whenNotPaused onlyRole(ADMIN_ROLE) {
        _configureBorrower(borrower, uint256(borrowingPolicy), maxBorrowedAmount);
    }

    // ------------------ Hook transactional functions ------------ //

    /// @inheritdoc ICreditLineHooksV2
    function onBeforeLoanOpened(
        address borrower,
        uint256 borrowedAmount
    ) external whenNotPaused onlyRole(LOAN_OPERATOR_ROLE) {
        _openLoan(borrower, borrowedAmount);
    }

    /// @inheritdoc ICreditLineHooksV2
    function onAfterLoanClosed(
        address borrower,
        uint256 borrowedAmount
    ) external whenNotPaused onlyRole(LOAN_OPERATOR_ROLE) {
        _closeLoan(borrower, borrowedAmount);
    }

    // ------------------ View functions -------------------------- //

    /// @inheritdoc ICreditLineConfigurationV2
    function linkedCreditLine() external view returns (address) {
        return _getCreditLineStorage().linkedCreditLine;
    }

    /// @inheritdoc ICreditLinePrimaryV2
    function getBorrowerConfiguration(address borrower) external view returns (BorrowerConfigView memory) {
        BorrowerConfig storage borrowerConfig = _getBorrowerConfig(borrower);
        return BorrowerConfigView({
            borrowingPolicy: borrowerConfig.borrowingPolicy,
            maxBorrowedAmount: borrowerConfig.maxBorrowedAmount
        });
    }

    /// @inheritdoc ICreditLinePrimaryV2
    function getBorrowerState(address borrower) external view returns (BorrowerStateView memory) {
        return _gatherBorrowerState(borrower);
    }

    // ------------------ Pure functions -------------------------- //

    /// @inheritdoc ICreditLineV2
    function proveCreditLine() external pure {}

    // ------------------ Internal functions ---------------------- //

    /**
     * @dev Updates the configuration of a borrower. TODO
     */
    function _configureBorrower(
        address borrower,
        uint256 borrowingPolicy,
        uint256 maxBorrowedAmount
    ) internal {
        if (borrower == address(0)) {
            revert CreditLine_BorrowerAddressZero();
        }
        if (maxBorrowedAmount == 0) {
            revert CreditLine_MaxBorrowedAmountZero();
        }
        if (maxBorrowedAmount >= type(uint64).max) {
            revert CreditLine_MaxBorrowedAmountExcess();
        }

        BorrowerConfig storage borrowerConfig = _getBorrowerConfig(borrower);
        borrowerConfig.borrowingPolicy = BorrowingPolicy(borrowingPolicy);
        borrowerConfig.maxBorrowedAmount = uint64(maxBorrowedAmount);

        emit BorrowerConfigured(
            borrower, // Tools: prevent Prettier one-liner
            BorrowingPolicy(borrowingPolicy),
            maxBorrowedAmount
        );
    }

    /**
     * @dev Executes additional checks and updates the borrower structures when a loan is opened. TODO
     */
    function _openLoan(
        address borrower,
        uint256 borrowedAmount
    ) internal {
        BorrowerStateView memory borrowerStateLinked = _getBorrowerStateOnLinkedCreditLine(borrower);
        BorrowerState storage borrowerState = _getBorrowerState(borrower);
        BorrowerConfig storage borrowerConfig = _getBorrowerConfig(borrower);

        unchecked {
            uint256 newActiveLoanCount = uint256(borrowerState.activeLoanCount) + 1;
            uint256 newTotalActiveLoanAmount = uint256(borrowerState.totalActiveLoanAmount) + borrowedAmount;
            uint256 aggregatedActiveLoanAmount = newTotalActiveLoanAmount + borrowerStateLinked.totalActiveLoanAmount;

            if (borrowerConfig.borrowingPolicy == BorrowingPolicy.SingleActiveLoan) {
                if (newActiveLoanCount + borrowerStateLinked.activeLoanCount > 1) {
                    revert CreditLine_LimitViolationOnSingleActiveLoan();
                }
            } else if (borrowerConfig.borrowingPolicy == BorrowingPolicy.TotalActiveAmountLimit) {
                if (aggregatedActiveLoanAmount > borrowerConfig.maxBorrowedAmount) {
                    revert CreditLone_LimitViolationOnTotalActiveLoanAmount(aggregatedActiveLoanAmount);
                }
            } else if (borrowerConfig.borrowingPolicy == BorrowingPolicy.MultipleActiveLoans) {
                // Do nothing
            } else {
                // Loan are prohibited for the requested borrower
                revert CreditLine_LoansProhibited();
            }

            if (
                newActiveLoanCount + borrowerState.closedLoanCount > type(uint16).max ||
                newTotalActiveLoanAmount + borrowerState.totalClosedLoanAmount > type(uint64).max
            ) {
                revert CreditLine_BorrowerStateOverflow();
            }
            borrowerState.activeLoanCount = uint16(newActiveLoanCount);
            borrowerState.totalActiveLoanAmount = uint64(newTotalActiveLoanAmount);
        }
    }

    /**
     * @dev Updates the borrower structures when a loan is closed. TODO
     */
    function _closeLoan(
        address borrower,
        uint256 borrowedAmount
    ) internal {
        BorrowerState storage borrowerState = _getBorrowerState(borrower);

        // Do not check explicitly check overflow here, because we did it in the `_openLoan()` function.
        borrowerState.activeLoanCount -= uint16(1);
        borrowerState.closedLoanCount += uint16(1);
        borrowerState.totalActiveLoanAmount -= uint64(borrowedAmount);
        borrowerState.totalClosedLoanAmount += uint64(borrowedAmount);
    }

    /**
     * @dev Returns the stored configuration of a borrower.
     * @param borrower The address of the borrower.
     * @return The configuration of a borrower.
     */
    function _getBorrowerConfig(address borrower) internal view returns (BorrowerConfig storage) {
        return _getCreditLineStorage().borrowerConfigs[borrower];
    }

    /**
     * @dev Returns the stored state of a borrower.
     * @param borrower The address of the borrower.
     * @return The state of a borrower.
     */
    function _getBorrowerState(address borrower) internal view returns (BorrowerState storage) {
        return _getCreditLineStorage().borrowerStates[borrower];
    }

    /**
     * @dev Returns the state of a borrower on the linked credit line.
     * @param borrower The address of the borrower.
     * @return The state of a borrower.
     */
    function _getBorrowerStateOnLinkedCreditLine(address borrower) internal view returns (BorrowerStateView memory) {
        CreditLineStorageV2 storage $ = _getCreditLineStorage();
        address linkedLine = $.linkedCreditLine;
        if (linkedLine == address(0)) {
            return BorrowerStateView({
                activeLoanCount: 0,
                closedLoanCount: 0,
                totalActiveLoanAmount: 0,
                totalClosedLoanAmount: 0
            });
        } else {
            ICreditLineV1.BorrowerState memory linkedBorrowerState = ICreditLineV1(linkedLine).getBorrowerState(borrower);
            return BorrowerStateView({
                activeLoanCount: linkedBorrowerState.activeLoanCount,
                closedLoanCount: linkedBorrowerState.closedLoanCount,
                totalActiveLoanAmount: linkedBorrowerState.totalActiveLoanAmount,
                totalClosedLoanAmount: linkedBorrowerState.totalClosedLoanAmount
            });
        }
    }

    /**
     * @dev Gathers the state of a borrower from the linked credit line and the current credit line.
     * @param borrower The address of the borrower.
     * @return The state of a borrower.
     */
    function _gatherBorrowerState(address borrower) internal view returns (BorrowerStateView memory) {
        BorrowerStateView memory borrowerStateView = _getBorrowerStateOnLinkedCreditLine(borrower);
        BorrowerState storage borrowerState = _getBorrowerState(borrower);

        borrowerStateView.activeLoanCount += uint256(borrowerState.activeLoanCount);
        borrowerStateView.closedLoanCount += uint256(borrowerState.closedLoanCount);
        borrowerStateView.totalActiveLoanAmount += uint256(borrowerState.totalActiveLoanAmount);
        borrowerStateView.totalClosedLoanAmount += uint256(borrowerState.totalClosedLoanAmount);

        return borrowerStateView;
    }

    /**
     * @dev The upgrade validation function for the UUPSExtUpgradeable contract.
     * @param newImplementation The address of the new implementation.
     *
     */
    function _validateUpgrade(address newImplementation) internal view override onlyRole(OWNER_ROLE) {
        try ICreditLineV2(newImplementation).proveCreditLine() {} catch {
            revert CreditLine_ImplementationAddressInvalid();
        }
    }
}
