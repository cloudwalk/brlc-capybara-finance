// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import { AccessControlExtUpgradeable } from "./base/AccessControlExtUpgradeable.sol";
import { PausableExtUpgradeable } from "./base/PausableExtUpgradeable.sol";
import { UUPSExtUpgradeable } from "./base/UUPSExtUpgradeable.sol";
import { Versionable } from "./base/Versionable.sol";

import { Loan } from "./libraries/Loan.sol";
import { Error } from "./libraries/Error.sol";
import { Rounding } from "./libraries/Rounding.sol";
import { Constants } from "./libraries/Constants.sol";
import { InterestMath } from "./libraries/InterestMath.sol";
import { SafeCast } from "./libraries/SafeCast.sol";

import { ICreditLine } from "./interfaces/ICreditLine.sol"; // TODO V2
import { ILendingMarketV2 } from "./interfaces/ILendingMarketV2.sol";
import { ILendingMarketConfigurationV2 } from "./interfaces/ILendingMarketV2.sol";
import { ILendingMarketPrimaryV2 } from "./interfaces/ILendingMarketV2.sol";
import { ILiquidityPool } from "./interfaces/ILiquidityPool.sol"; // TODO V2

import { LendingMarketStorageLayoutV2 } from "./LendingMarketStorageLayoutV2.sol";

/**
 * @title LendingMarket contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Implementation of the lending market contract.
 *
 * See additional notes in the comments of the interface `ILendingMarket.sol`.
 */
contract LendingMarketV2 is
    LendingMarketStorageLayoutV2,
    Initializable,
    AccessControlExtUpgradeable,
    PausableExtUpgradeable,
    ILendingMarketV2,
    Versionable,
    UUPSExtUpgradeable
{
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    // ------------------ Constants ------------------------------- //

    /// @dev The role of an admin that is allowed to execute loan-related functions.
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // ------------------ Constructor ----------------------------- //

    /**
     * @dev Constructor that prohibits the initialization of the implementation of the upgradeable contract.
     *
     * See details
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
     * @param owner_ The owner of the contract.
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
     */
    function initialize(address owner_) external initializer {
        __AccessControlExt_init_unchained();
        __PausableExt_init_unchained();
        __UUPSExt_init_unchained();

        _setRoleAdmin(ADMIN_ROLE, GRANTOR_ROLE);
        _grantRole(OWNER_ROLE, owner_);
    }

    // ----------- Configuration transactional functions ---------- //

    /// @inheritdoc ILendingMarketConfiguration
    function createProgram(
        address creditLine, // Tools: this comment prevents Prettier from formatting into a single line.
        address liquidityPool
    ) external whenNotPaused onlyRole(OWNER_ROLE) {
        _checkCreditLineAndLiquidityPool(creditLine, liquidityPool);

        if (_getLendingMarketStorage().programIdCounter >= type(uint24).max) {
            revert ProgramIdExcess();
        }
        uint32 programId;
        unchecked {
            programId = ++_getLendingMarketStorage().programIdCounter;
        }

        emit ProgramCreated(msg.sender, programId);
        emit ProgramUpdated(programId, creditLine, liquidityPool);

        _getLendingMarketStorage().programCreditLines[programId] = creditLine;
        _getLendingMarketStorage().programLiquidityPools[programId] = liquidityPool;
    }

    /// @inheritdoc ILendingMarketConfiguration
    function updateProgram(
        uint32 programId, // Tools: this comment prevents Prettier from formatting into a single line.
        address creditLine,
        address liquidityPool
    ) external whenNotPaused onlyRole(OWNER_ROLE) {
        if (programId == 0) {
            revert ProgramNotExist();
        }
        _checkCreditLineAndLiquidityPool(creditLine, liquidityPool);
        if (
            _getLendingMarketStorage().programCreditLines[programId] == creditLine &&
            _getLendingMarketStorage().programLiquidityPools[programId] == liquidityPool
        ) {
            revert Error.AlreadyConfigured();
        }

        emit ProgramUpdated(programId, creditLine, liquidityPool);

        _getLendingMarketStorage().programCreditLines[programId] = creditLine;
        _getLendingMarketStorage().programLiquidityPools[programId] = liquidityPool;
    }

    // -------------- Primary transactional functions ------------- //

    /// @inheritdoc ILendingMarketPrimary
    // TODO: Here and in similar functions remove `For` in the name
    function takeLoanFor(
        address borrower,
        uint32 programId,
        uint256[] calldata borrowedAmounts,
        uint256[] calldata addonAmounts,
        uint256[] calldata durationsInPeriods
    ) external whenNotPaused onlyRole(ADMIN_ROLE) returns (uint256 firstSubLoanId, uint256 subLoanCount) {
        uint256 totalBorrowedAmount = _sumArray(borrowedAmounts);
        uint256 totalAddonAmount = _sumArray(addonAmounts);
        subLoanCount = borrowedAmounts.length;

        _checkMainLoanParameters(borrower, programId, totalBorrowedAmount, totalAddonAmount);
        _checkDurationArray(durationsInPeriods);
        _checkSubLoanCount(subLoanCount);
        if (addonAmounts.length != subLoanCount || durationsInPeriods.length != subLoanCount) {
            revert Error.ArrayLengthMismatch();
        }
        // Arrays are not checked for emptiness because if the loan amount is zero, the transaction is reverted earlier

        for (uint256 i = 0; i < subLoanCount; ++i) {
            if (borrowedAmounts[i] == 0) {
                revert Error.InvalidAmount();
            }
            uint256 subLoanId = _takeSubLoan(
                borrower, // Tools: this comment prevents Prettier from formatting into a single line.
                programId,
                borrowedAmounts[i],
                addonAmounts[i],
                durationsInPeriods[i]
            );
            if (i == 0) {
                firstSubLoanId = subLoanId;
            }
            _updateLoanPartsData(subLoanId, firstSubLoanId, subLoanCount);
        }

        emit LoanTaken(
            firstSubLoanId,
            borrower,
            programId,
            subLoanCount,
            totalBorrowedAmount,
            totalAddonAmount
        );

        _transferTokensOnLoanTaking(firstSubLoanId, totalBorrowedAmount, totalAddonAmount);
    }

    /// @inheritdoc ILendingMarketPrimary
    function repaySubLoanForBatch(
        uint256[] calldata subLoanIds,
        uint256[] calldata repaymentAmounts,
        address repayer
    ) external whenNotPaused onlyRole(ADMIN_ROLE) {
        uint256 len = subLoanIds.length;
        if (len != repaymentAmounts.length) {
            revert Error.ArrayLengthMismatch();
        }
        if (repayer == address(0)) {
            revert Error.ZeroAddress();
        }
        for (uint256 i = 0; i < len; ++i) {
            uint256 subLoanId = subLoanIds[i];
            _repaySubLoan(subLoanId, repaymentAmounts[i], repayer);
        }
    }

    /// @inheritdoc ILendingMarketPrimary
    function revokeLoanFor(uint256 subLoanId) external whenNotPaused onlyRole(ADMIN_ROLE) {
        LoanV2.SubLoan storage subLoanStored = _getExitingSubLoanInStorage(subLoanId);

        uint256 firstSubLoanId = subLoanStored.firstSubLoanId;
        uint256 subLoanCount = subLoanStored.subLoanCount;
        uint256 ongoingSubLoanCount = 0;
        LoanV2.ProcessingSubLoan memory subLoan;

        for (uint256 i = 0; i < subLoanCount; ++i) {
            subLoan = _getExistingSubLoanInMemory(firstSubLoanId + i);
            if (!_isRepaid(subLoan)) {
                ++ongoingSubLoanCount;
            }
            _revokeSubLoan(subLoan);
        }

        // If all the sub-loans are repaid the revocation is prohibited
        if (ongoingSubLoanCount == 0) {
            revert LoanAlreadyRepaid();
        }

        emit LoanRevoked(
            firstSubLoanId, // Tools: this comment prevents Prettier from formatting into a single line.
            subLoanCount
        );

        LoanV2.LoanPreview memory loanPreview = _getLoanPreview(firstSubLoanId, 0);
        _transferTokensOnLoanRevocation(
            subLoan,
            loanPreview.totalBorrowedAmount,
            loanPreview.totalAddonAmount,
            loanPreview.totalRepaidAmount
        );
    }

    /// @inheritdoc ILendingMarketPrimary
    function discountLoanForBatch(
        uint256[] calldata loanIds, // Tools: this comment prevents Prettier from formatting into a single line.
        uint256[] calldata discountAmounts
    ) external whenNotPaused onlyRole(ADMIN_ROLE) {
        uint256 len = loanIds.length;
        if (len != discountAmounts.length) {
            revert Error.ArrayLengthMismatch();
        }
        for (uint256 i = 0; i < len; ++i) {
            uint256 loanId = loanIds[i];
            _discountLoan(loanId, discountAmounts[i]);
        }
    }

    /// @inheritdoc ILendingMarketPrimary
    function addOperation(
        uint256 subLoanId,
        uint256 kind,
        uint256 timestamp,
        uint256 parameterOfAmount,
        address parameterOfAccount,
        address counterparty
    ) external {
        LoanV2.ProcessingSubLoan memory subLoan = _getOngoingSubLoanInMemory(subLoanId);
        uint256 currentTimestamp = _blockTimestamp();
        if (timestamp == 0) {
            timestamp = currentTimestamp;
        }
        _addOperation(
            subLoanId,
            kind,
            timestamp,
            parameterOfAmount,
            parameterOfAccount
        );
        if (timestamp < currentTimestamp) {
            if (kind == LoanV2.OperationKind.Revocation) {
                revert OperationKindUnacceptable();
            }
            _replayOperationsInTransaction(subLoan, counterparty);
        } else {
            _processOperationsInTransaction(subLoan);
        }
    }

    /// @inheritdoc ILendingMarketPrimary
    function changeOperation(
        uint256 subLoanId,
        uint256 operationId,
        uint256 newParameterOfAmount,
        address counterparty
    ) external {
        LoanV2.ProcessingSubLoan memory subLoan = _getUnrevokedSubLoanInMemory(subLoanId);
        LoanV2.ProcessingOperation memory operation = _getExistingOperationInMemory(operationId);
        _changeOperation(subLoanId, operationId, newParameterOfAmount);
        if (operation.timestamp < _blockTimestamp()) {
            _replayOperationsInTransaction(subLoan, counterparty);
        } else {
            _processOperationsInTransaction(subLoan);
        }
    }

    // ------------------ View functions -------------------------- //

    /// @inheritdoc ILendingMarketPrimary
    function getProgramCreditLine(uint32 programId) external view returns (address) {
        return _programCreditLines[programId];
    }

    /// @inheritdoc ILendingMarketPrimary
    function getProgramLiquidityPool(uint32 programId) external view returns (address) {
        return _programLiquidityPools[programId];
    }

    /// @inheritdoc ILendingMarketPrimary
    function getLoanState(uint256 loanId) external view returns (Loan.State memory) {
        return _loans[loanId];
    }

    /// @inheritdoc ILendingMarketPrimary
    function getLoanPreview(uint256 loanId, uint256 timestamp) external view returns (Loan.Preview memory) {
        if (timestamp == 0) {
            timestamp = _blockTimestamp();
        }

        return _getLoanPreview(loanId, timestamp);
    }

    /// @inheritdoc ILendingMarketPrimary
    function getLoanPreviewExtendedBatch(
        uint256[] calldata loanIds,
        uint256 timestamp
    ) external view returns (Loan.PreviewExtended[] memory) {
        if (timestamp == 0) {
            timestamp = _blockTimestamp();
        }

        uint256 len = loanIds.length;
        Loan.PreviewExtended[] memory previews = new Loan.PreviewExtended[](len);
        for (uint256 i = 0; i < len; ++i) {
            previews[i] = _getSubLoanPreview(loanIds[i], timestamp);
        }

        return previews;
    }

    /// @inheritdoc ILendingMarketPrimary
    function getInstallmentLoanPreview(
        uint256 loanId,
        uint256 timestamp
    ) external view returns (Loan.InstallmentLoanPreview memory) {
        return _getLoanPreview(loanId, timestamp);
    }

    /// @inheritdoc ILendingMarketPrimary
    function interestRateFactor() external pure returns (uint256) {
        return Constants.INTEREST_RATE_FACTOR;
    }

    /// @inheritdoc ILendingMarketPrimary
    function periodInSeconds() external pure returns (uint256) {
        return Constants.PERIOD_IN_SECONDS;
    }

    /// @inheritdoc ILendingMarketPrimary
    function timeOffset() external pure returns (uint256, bool) {
        return (Constants.NEGATIVE_TIME_OFFSET, false);
    }

    /// @inheritdoc ILendingMarketPrimary
    function loanCounter() external view returns (uint256) {
        return _loanIdCounter;
    }

    /// @inheritdoc ILendingMarketPrimary
    function programCounter() external view returns (uint256) {
        return _programIdCounter;
    }

    // ------------------ Pure functions -------------------------- //

    /**
     * @dev Calculates the period index that corresponds the specified timestamp.
     * @param timestamp The timestamp to calculate the period index.
     * @param periodInSeconds_ The period duration in seconds.
     */
    function calculatePeriodIndex(uint256 timestamp, uint256 periodInSeconds_) external pure returns (uint256) {
        return _periodIndex(timestamp, periodInSeconds_);
    }

    /**
     * @dev Calculates the tracked balance of a loan.
     * @param originalBalance The balance of the loan at the beginning.
     * @param numberOfPeriods The number of periods to calculate the tracked balance.
     * @param interestRate The interest rate applied to the loan.
     * @param interestRateFactor_ The interest rate factor.
     */
    function calculateTrackedBalance(
        uint256 originalBalance,
        uint256 numberOfPeriods,
        uint256 interestRate,
        uint256 interestRateFactor_
    ) external pure returns (uint256) {
        return
            InterestMath.calculateTrackedBalance(
                originalBalance, // Tools: this comment prevents Prettier from formatting into a single line.
                numberOfPeriods,
                interestRate,
                interestRateFactor_
            );
    }

    /// @inheritdoc ILendingMarket
    function proveLendingMarket() external pure {}

    // ------------------ Internal functions ---------------------- //

    /**
     * @dev Takes a sub-loan for a provided account internally.
     * @param borrower The account for whom the loan is taken.
     * @param programId The identifier of the program to take the loan from.
     * @param borrowedAmount The desired amount of tokens to borrow.
     * @param addonAmount The off-chain calculated addon amount (extra charges or fees) for the loan.
     * @param durationInDays The desired duration of the loan in days.
     * @return The unique identifier of the loan.
     */
    function _takeSubLoan(
        address borrower,
        uint32 programId,
        uint256 borrowedAmount,
        uint256 addonAmount,
        uint256 durationInDays
    ) internal returns (uint256) {
        address creditLine = _getLendingMarketStorage().programCreditLines[programId];
        if (creditLine == address(0)) {
            revert ProgramCreditLineNotConfigured();
        }

        address liquidityPool = _getLendingMarketStorage().programLiquidityPools[programId];
        if (liquidityPool == address(0)) {
            revert ProgramLiquidityPoolNotConfigured();
        }

        uint256 id = _getLendingMarketStorage().subLoanIdCounter++;
        _checkLoanId(id);

        LoanV2.Terms memory terms = _determineLoanTerms(
            borrower, // Tools: this comment prevents Prettier from formatting into a single line.
            borrowedAmount,
            durationInDays
        );

        uint256 principalAmount = borrowedAmount + addonAmount;
        uint32 blockTimestamp = _blockTimestamp().toUint32();

        LoanV2.SubLoan storage subLoan = _getLendingMarketStorage().subLoans[id];

        // Slot1
        subLoan.programId = programId;
        subLoan.borrowedAmount = uint64(borrowedAmount); // Safe cast due to prior checks
        subLoan.addonAmount = uint64(addonAmount); // Safe cast due to prior checks
        subLoan.startTimestamp = blockTimestamp;
        subLoan.initialDuration = uint16(terms.duration); // Safe cast due to prior checks
        // Other loan fields are zero: firstSubLoanId, subLoanCount

        // Slot 2
        subLoan.borrower = borrower;
        subLoan.initialInterestRateRemuneratory = uint32(terms.interestRateRemuneratory); // Safe cast
        subLoan.initialInterestRateMoratory = uint32(terms.interestRateMoratory); // Safe cast due to prior checks
        subLoan.initialLateFeeRate = uint32(terms.lateFeeRate); // Safe cast due to prior checks

        // Slot 3
        subLoan.status = LoanV2.SubLoanStatus.Active;
        subLoan.interestRateRemuneratory = uint32(terms.interestRateRemuneratory); // Safe cast due to prior checks
        subLoan.interestRateMoratory = uint32(terms.interestRateSecondary);
        subLoan.lateFeeRate = uint32(terms.lateFeeRate); // Safe cast due to prior checks
        subLoan.duration = uint16(terms.duration); // Safe cast due to prior checks
        subLoan.trackedTimestamp = blockTimestamp;
        // Other loan fields are zero: freezeTimestamp, discountAmount

        // Slot 4
        subLoan.trackedPrincipal = uint64(borrowedAmount + addonAmount); // Safe cast due to prior checks
        // Other loan fields are zero: trackedInterestRemuneratory, trackedInterestMoratory, lateFeeAmount

        // Slot 5
        // All fields are zero: repaidPrincipal, repaidInterestRemuneratory, repaidInterestMoratory, repaidLateFee

        ICreditLine(creditLine).onBeforeLoanTaken(id);
        ILiquidityPool(liquidityPool).onBeforeLoanTaken(id);

        emit SubLoanTaken(
            id,
            borrower,
            programId,
            borrowedAmount,
            addonAmount,
            terms.duration
        );

        return id;
    }

    /**
     * @dev TODO
     */
    // TODO: Replace by taking from the credit line contract
    function _determineLoanTerms(
        address borrower,
        uint256 borrowedAmount,
        uint256 duration
    ) public view returns (LoanV2.Terms memory terms) {
        if (borrower == address(0)) {
            revert Error.ZeroAddress();
        }
        if (borrowedAmount == 0) {
            revert Error.InvalidAmount();
        }
        if (duration > type(uint16).max) {
            revert DurationInvalid();
        }

        terms.duration = duration;
        terms.interestRateRemuneratory = Constants.INTEREST_RATE_FACTOR / 100; // 1%
        terms.interestRateMoratory = Constants.INTEREST_RATE_FACTOR / 50; // 2%
        terms.lateFeeRate = Constants.INTEREST_RATE_FACTOR / 1000; // 0.1%
    }

    /**
     * @dev Updates the loan state and makes the necessary transfers when repaying a sub-loan.
     * @param subLoanId The unique identifier of the sub-loan to repay.
     * @param repaymentAmount The amount to repay.
     * @param repayer The token source for the repayment or zero if the source is the loan borrower themself.
     */
    function _repaySubLoan(
        uint256 subLoanId, // Tools: this comment prevents Prettier from formatting into a single line.
        uint256 repaymentAmount,
        address repayer
    ) internal {
        LoanV2.ProcessingSubLoan memory subLoan = _getOngoingSubLoanInMemory(subLoanId);
        _addOperation(
            subLoanId,
            LoanV2.OperationKind.Repayment,
            _blockTimestamp(),
            repaymentAmount,
            repayer
        );
        _processOperationsInTransaction(subLoan);
    }

    /**
     * @dev TODO
     */
    function _addOperation(
        uint256 subLoanId,
        uint256 kind,
        uint256 timestamp,
        uint256 parameterOfAmount,
        address parameterOfAccount
    ) internal returns (uint256) {
        _checkOperationParameters(kind, timestamp, parameterOfAmount, parameterOfAccount);
        LoanV2.OperationalState storage opState = _getLendingMarketStorage().subLoanOperationalStates[subLoanId];
        uint256 operationId = uint256(opState.operationCount) + 1;
        _checkOperationId(operationId);
        opState.operationCount = operationId;
        uint256 prevOperationId = _findEarlierOperation(opState, operationId, timestamp);
        uint256 nextOperationId;
        if (prevOperationId == 0) {
            // Add at the beginning of the operation list
            nextOperationId = opState.earliestOperationId;
            opState.operations[nextOperationId].prevOperationId = operationId;
            opState.earliestOperationId = operationId;
        } else {
            // Insert in the middle or at the end of the operation list
            if (prevOperationId == opState.latestOperationId) {
                // Add at the end of the operation list
                opState.operations[prevOperationId].nextOperationId = operationId;
                opState.latestOperationId = operationId;
            } else {
                nextOperationId = opState.operations[prevOperationId].nextOperationId;
                opState.operations[prevOperationId].nextOperationId = operationId;
                opState.operations[nextOperationId].prevOperationId = operationId;
            }
        }
        LoanV2.Operation storage operation = opState.operations[operationId];
        operation.prevOperationId = uint16(prevOperationId); // Safe cast due to prior checks
        operation.nextOperationId = uint16(nextOperationId); // Safe cast due to prior checks
        operation.status = LoanV2.OperationStatus.Pending;
        operation.kind = uint8(kind);
        operation.parameterOfAmount = parameterOfAmount;
        if (parameterOfAccount != address(0)) {
            operation.parameterOfAccount = parameterOfAccount;
        }

        emit OperationAdded(
            subLoanId,
            operationId,
            kind,
            timestamp,
            parameterOfAmount,
            parameterOfAccount,
            "" // addendum
        );

        return operationId;
    }

    /**
     * @dev TODO
     */
    function _changeOperation(
        uint256 subLoanId,
        uint256 operationId,
        uint256 newParameterOfAmount
    ) internal {
        LoanV2.Operation storage operation = _getExistingOperationInStorage(operationId);
        uint256 oldParameterOfAmount = operation.parameterOfAmount;
        if (oldParameterOfAmount == newParameterOfAmount) {
            revert OperationUnchanged();
        }

        emit OperationChanged(
            subLoanId,
            operationId,
            operation.kind,
            operation.timestamp,
            newParameterOfAmount,
            oldParameterOfAmount,
            "" // addendum
        );
    }

    /// TODO @dev
    function _processOperationsInTransaction(
        LoanV2.ProcessingSubLoan memory subLoan
    ) internal {
        LoanV2.OperationalState storage opState = _getLendingMarketStorage().subLoanOperationalStates[subLoan.id];
        uint256 pastOperationId = opState.pastOperationId;
        uint256 operationId = opState.operations[pastOperationId].nextOperationId;
        uint256 currentTimestamp = _blockTimestamp();
        while (operationId != 0) {
            LoanV2.ProcessingOperation memory operation = _getExistingOperationInMemory(operationId);
            _processOperation(subLoan, operation, currentTimestamp);
            if (operation.status != uint256(LoanV2.OperationStatus.Pending)) {
                pastOperationId = operationId;
            } else {
                break;
            }
            _postProcessOperation(subLoan, operation);
        }
        opState.pastOperationId = pastOperationId;
        _applyChangesInSubLoan(subLoan);
    }

    /// TODO: @dev
    function _replayOperationsInTransaction(LoanV2.ProcessingSubLoan memory subLoan, address counterparty) internal {
        LoanV2.OperationalState storage opState = _getLendingMarketStorage().subLoanOperationalStates[subLoan.id];
        _initiateSubLoan(subLoan);
        uint256 operationId = opState.earliestOperationId;
        uint256 pastOperationId = 0;
        uint256 currentTimestamp = _blockTimestamp();
        while (operationId != 0) {
            LoanV2.ProcessingOperation memory operation = _getExistingOperationInMemory(operationId);
            _processOperation(subLoan, operation, currentTimestamp);
            if (operation.status != uint256(LoanV2.OperationStatus.Pending)) {
                pastOperationId = operationId;
            } else {
                break;
            }
        }
        opState.pastOperationId = pastOperationId;
        _postProcessRepaymentChanges(subLoan);
        _applyChangesInSubLoan(subLoan);
    }

    /**
     * @dev TODO
     */
    function _processOperation(
        LoanV2.ProcessingSubLoan memory subLoan,
        LoanV2.ProcessingOperation memory operation,
        uint256 currentTimestamp
    ) internal pure {
        if (
            operation.status == uint256(LoanV2.OperationStatus.Nonexistent) ||
            operation.status == uint256(LoanV2.OperationStatus.Skipped) ||
            operation.kind == uint256(LoanV2.OperationKind.Nonexistent) ||
            operation.kind > uint256(LoanV2.OperationKind.NonexistentLimit)
        ) {
            return;
        }
        if (operation.timestamp <= subLoan.trackedTimestamp) {
            revert OperationTimestampInvalid();
        }
        if (operation.timestamp <= currentTimestamp) {
            _accrueInterest(subLoan, operation.timestamp);
            _applyOperation(subLoan, operation);
        }
    }

    function _applyOperation(
        LoanV2.ProcessingSubLoan memory subLoan,
        LoanV2.ProcessingOperation memory operation
    ) internal pure {
        uint256 notExecuted;
        uint256 operationKind = operation.kind;
        if (operationKind == uint256(LoanV2.OperationKind.Repayment)) {
            _applyRepaymentOrDiscount(subLoan, operation.parameterOfAmount, operationKind);
        } else if (operationKind == uint256(LoanV2.OperationKind.Discounting)) {
            subLoan.discountAmount += _applyRepaymentOrDiscount(subLoan, operation.parameterOfAmount, operationKind);
        } else if (operationKind == uint256(LoanV2.OperationKind.Revocation)) {
            _applyRevocation(subLoan);
        } else {
            notExecuted = 1;
        }

        if (notExecuted != 0) {
            operation.status = LoanV2.OperationStatus.Executed;
        }
    }

    function _applyRepaymentOrDiscount(
        LoanV2.ProcessingSubLoan memory subLoan,
        uint256 amount,
        uint256 operationKind
    ) internal pure returns (uint256 actualAmount) {
        if (amount != _roundMath(amount) && amount < type(uint64).max) {
            revert RepaymentOrDiscountAmountInvalid();
        }
        uint256 initialAmount = amount;
        amount = _repayOrDiscountPartial(subLoan, amount, LoanV2.SubLoanPartKind.InterestMoratory, operationKind);
        amount = _repayOrDiscountPartial(subLoan, amount, LoanV2.SubLoanPartKind.LateFee, operationKind);
        amount = _repayOrDiscountPartial(subLoan, amount, LoanV2.SubLoanPartKind.InterestRemuneratory, operationKind);
        amount = _repayOrDiscountPartial(subLoan, amount, LoanV2.SubLoanPartKind.Principal, operationKind);

        if (amount > 0 && initialAmount < type(uint64).max) {
            revert RepaymentOrDiscountAmountInvalid();
        }

        if (_getTrackedBalance(subLoan) == 0) {
            subLoan.status = uint256(LoanV2.SubLoanStatus.FullyRepaid);
        }

        return initialAmount - amount;
    }

    function _repayOrDiscountPartial(
        LoanV2.ProcessingSubLoan memory subLoan,
        uint256 amount,
        uint256 subLoanPartKind,
        uint256 operationKind
    ) internal pure returns (uint256 newRepaymentAmount){
        if (amount == 0) {
            return 0;
        }
        // Discounting must not be applied to the principal part of a sub-loan
        // TODO: Discuss this with the team
        if (
            subLoanPartKind == uint256(LoanV2.SubLoanPartKind.Principal) &&
            operationKind == uint256(LoanV2.OperationKind.Discounting)
        ) {
            return amount;
        }
        uint256 trackedPartAmount;
        uint256 repaidPartAmount;

        // TODO: Can be optimized through the assembler language
        if (subLoanPartKind == uint256(LoanV2.SubLoanPartKind.Principal)) {
            trackedPartAmount = subLoan.trackedPrincipal;
            repaidPartAmount = subLoan.repaidPrincipal;
        } else if (subLoanPartKind == uint256(LoanV2.SubLoanPartKind.InterestRemuneratory)) {
            trackedPartAmount = subLoan.trackedInterestRemuneratory;
            repaidPartAmount = subLoan.repaidInterestRemuneratory;
        } else if (subLoanPartKind == uint256(LoanV2.SubLoanPartKind.InterestMoratory)) {
            trackedPartAmount = subLoan.trackedInterestMoratory;
            repaidPartAmount = subLoan.repaidInterestMoratory;
        } else {
            trackedPartAmount = subLoan.trackedLateFee;
            repaidPartAmount = subLoan.repaidLateFee;
        }

        // TODO: Review the rounding logic if a loan part is being fully repaid
        uint256 roundedTrackedPartAmount = _roundMath(trackedPartAmount);
        if (roundedTrackedPartAmount <= amount) {
            unchecked {
                amount -= roundedTrackedPartAmount;
                if (operationKind == uint256(LoanV2.OperationKind.Repayment)) {
                    repaidPartAmount += roundedTrackedPartAmount;
                }
                trackedPartAmount = 0;
            }
        } else {
            trackedPartAmount -= amount;
            if (operationKind == uint256(LoanV2.OperationKind.Repayment)) {
                repaidPartAmount += amount;
            }
        }

        // TODO: Can be optimized through the assembler language
        if (subLoanPartKind == uint256(LoanV2.SubLoanPartKind.Principal)) {
            subLoan.trackedPrincipal = trackedPartAmount;
            subLoan.repaidPrincipal = repaidPartAmount;
        } else if (subLoanPartKind == uint256(LoanV2.SubLoanPartKind.InterestRemuneratory)) {
            subLoan.trackedInterestRemuneratory = trackedPartAmount;
            subLoan.repaidInterestRemuneratory = repaidPartAmount;
        } else if (subLoanPartKind == uint256(LoanV2.SubLoanPartKind.InterestMoratory)) {
            subLoan.trackedInterestMoratory = trackedPartAmount;
            subLoan.repaidInterestMoratory = repaidPartAmount;
        } else {
            subLoan.repaidLateFee = repaidPartAmount;
            subLoan.trackedLateFee = trackedPartAmount;
        }

        return amount;
    }

    function _applyRevocation(LoanV2.ProcessingSubLoan subLoan) internal pure {
        subLoan.trackedPrincipal = 0;
        subLoan.trackedInterestRemuneratory = 0;
        subLoan.trackedInterestMoratory = 0;
        subLoan.trackedLateFee = 0;
        subLoan.status = LoanV2.SubLoanStatus.Revoked;
    }

    /**
     * @dev TODO
     */
    function _accrueInterest(
        LoanV2.ProcessingSubLoan subLoan,
        uint256 finishTimestamp
    ) internal view {
        {
            uint256 freezeTimestamp = subLoan.freezeTimestamp;
            if (freezeTimestamp != 0 && freezeTimestamp < finishTimestamp) {
                finishTimestamp = freezeTimestamp;
            }
        }

        uint256 finishDay = _dayIndex(finishTimestamp);
        uint256 startDay = _dayIndex(subLoan.trackedTimestamp);

        if (finishDay > startDay) {
            uint256 dueDay =  _dayIndex(subLoan.startTimestamp) + subLoan.duration;
            if (startDay <= dueDay) {
                if (finishDay <= dueDay) {
                    _updateInterestRemuneratory(subLoan, finishDay - startDay);
                } else {
                    _updateInterestRemuneratory(subLoan, finishDay - startDay);
                    _calculateLateFee(subLoan);
                    _updateInterestMoratory(subLoan, finishDay - dueDay);
                }
            } else {
                _updateInterestMoratory(subLoan, finishDay - dueDay);
            }
        }
    }

    /**
     * @dev TODO
     */
    function _updateInterestRemuneratory(LoanV2.ProcessingSubLoan memory subLoan, uint256 dayCount) internal view {
        uint256 oldTrackedBalance = subLoan.trackedPrincipal + subLoan.trackedInterestRemuneratory;
        uint256 newTrackedBalance = InterestMath.calculateTrackedBalance(
            oldTrackedBalance,
            dayCount,
            subLoan.interestRateRemuneratory,
            Constants.INTEREST_RATE_FACTOR
        );
        subLoan.interestRateRemuneratory += newTrackedBalance - oldTrackedBalance;
    }

    /**
     * @dev TODO
     */
    function _updateInterestMoratory(LoanV2.ProcessingSubLoan memory subLoan, uint256 dayCount) internal {
        subLoan.interestRateMoratory += _calculateSimpleInterest(
            subLoan.trackedPrincipal,
            dayCount,
            subLoan.interestRateMoratory
        );
    }

    /**
     * @dev TODO
     */
    function _postProcessOperation(
        LoanV2.ProcessingSubLoan memory subLoan,
        LoanV2.ProcessingOperation memory operation
    ) internal pure {
        uint256 operationKind = operation.kind;
        if (operation.status != uint256(LoanV2.OperationStatus.Executed)) {
            return;
        } else if (
            operationKind == uint256(LoanV2.OperationKind.Repayment) ||
            operationKind == uint256(LoanV2.OperationKind.Discounting)
        ) {
            _postProcessRepaymentOrDiscount(subLoan, operation);
        } else if (operationKind == uint256(LoanV2.OperationKind.Revocation)) {
            _postProcessRevocation(subLoan, operation);
        }

        emit OperationExecuted(
            subLoan.id,
            operation.id,
            operation.kind,
            operation.timestamp,
            operation.parameterOfAmount,
            operation.parameterOfAccount,
            "" // addendum
        );
    }

    /**
     * @dev TODO
     */
    function _postProcessRepaymentOrDiscount(
        LoanV2.ProcessingSubLoan memory subLoan,
        LoanV2.ProcessingOperation memory operation
    ) internal {
        (address creditLine, address liquidityPool) = _getCreditLineAndLiquidityPool(subLoan);
        address repayer = operation.parameterOfAccount;
        uint256 repaymentAmount = operation.parameterOfAmount;
        if (operation.kind == LoanV2.OperationKind.Discounting) {
            repaymentAmount = 0; // To trigger needed actions in other contracts if the sub-loan is fully repaid
        }

        if (operation.kind == LoanV2.OperationKind.Repayment) {
            IERC20(_getLendingMarketStorage().token).safeTransferFrom(repayer, liquidityPool, repaymentAmount);
        }

        uint256 subLoanId = subLoan.id;
        ILiquidityPool(liquidityPool).onAfterLoanPayment(subLoanId, repaymentAmount);
        ICreditLine(creditLine).onAfterLoanPayment(subLoanId, repaymentAmount);
    }

    function _getCreditLineAndLiquidityPool(
        LoanV2.ProcessingSubLoan memory subLoan
    ) internal view returns (address, address) {
        uint256 programId = subLoan.programId;
        address creditLine = _getLendingMarketStorage().programCreditLines[subLoan.programId];
        address liquidityPool = _getLendingMarketStorage().programLiquidityPools[subLoan.programId];
        return (creditLine, liquidityPool);
    }

    /**
     * @dev TODO
     */
    function _postProcessRevocation(
        LoanV2.ProcessingSubLoan memory subLoan
    ) internal {
        uint256 programId = subLoan.programId;
        (address creditLine, address liquidityPool) = _getCreditLineAndLiquidityPool(subLoan);

        ILiquidityPool(liquidityPool).onAfterLoanRevocation(subLoan.id);
        ICreditLine(creditLine).onAfterLoanRevocation(subLoan.id);
    }

    function _postProcessRepaymentChanges(
        LoanV2.ProcessingSubLoan memory subLoan,
        address counterparty
    ) internal {
        uint256 oldTotalRepayment = _getTotalRepaymentInStorage(subLoan.id);
        uint256 newTotalRepayment = _getTotalRepaymentInMemory(subLoan);
        if (oldTotalRepayment == newTotalRepayment) {
            return;
        }
        address liquidityPool = _getLendingMarketStorage().programLiquidityPools[subLoan.programId];
        address token = _getLendingMarketStorage().token;
        if (newTotalRepayment < oldTotalRepayment) {
            uint256 repaymentDiff = oldTotalRepayment - newTotalRepayment;
            ILiquidityPool(liquidityPool).onAfterLoanRepaymentUndoing(subLoan.id, repaymentDiff);
            IERC20(token).safeTransferFrom(liquidityPool, counterparty, repaymentDiff);
        } else {
            uint256 repaymentDiff = newTotalRepayment - oldTotalRepayment;
            ILiquidityPool(liquidityPool).onAfterLoanPayment(subLoan.id, repaymentDiff);
            IERC20(token).safeTransferFrom(counterparty, liquidityPool, repaymentDiff);
        }
    }

    /**
     * @dev Updates the loan state and makes the necessary transfers when revoking a loan.
     * @param loanId The unique identifier of the loan to revoke.
     * @param loan The storage state of the loan to update.
     */
    function _revokeSubLoan(LoanV2.ProcessingSubLoan memory subLoan) internal {
        _addOperation(
            subLoan.id,
            LoanV2.OperationKind.Repayment,
            _blockTimestamp(),
            0,
            address(0)
        );
        _processOperationsInTransaction(subLoan);
    }

    /**
     * @dev Discounts a sub-loan.
     * @param subLoanId The unique identifier of the sub-loan to discount.
     * @param discountAmount The amount of the discount.
     */
    function _discountLoan(
        uint256 subLoanId, // Tools: this comment prevents Prettier from formatting into a single line.
        uint256 discountAmount
    ) internal {
        LoanV2.ProcessingSubLoan memory subLoan = _getExistingNonRepaidSubLoan(subLoanId);
        _addOperation(
            subLoanId,
            LoanV2.OperationKind.Repayment,
            _blockTimestamp(),
            discountAmount,
            _msgSender()
        );
        _processOperationsInTransaction(subLoan);
    }


    /**
     * @dev Validates the main parameters of the loan.
     * @param borrower The address of the borrower.
     * @param programId The ID of the lending program.
     * @param borrowedAmount The amount to borrow.
     * @param addonAmount The addon amount of the loan.
     */
    function _checkMainLoanParameters(
        address borrower,
        uint32 programId,
        uint256 borrowedAmount,
        uint256 addonAmount
    ) internal pure {
        if (programId == 0) {
            revert ProgramNotExist();
        }
        if (borrower == address(0)) {
            revert Error.ZeroAddress();
        }
        if (borrowedAmount == 0) {
            revert Error.InvalidAmount();
        }
        if (borrowedAmount > type(uint64).max) {
            revert Error.InvalidAmount();
        }
        if (borrowedAmount != Rounding.roundMath(borrowedAmount, Constants.ACCURACY_FACTOR)) {
            revert Error.InvalidAmount();
        }
        if (addonAmount != Rounding.roundMath(addonAmount, Constants.ACCURACY_FACTOR)) {
            revert Error.InvalidAmount();
        }
        if (addonAmount > type(uint64).max) {
            revert Error.InvalidAmount();
        }
        if (borrowedAmount > type(uint64).max) {
            revert Error.InvalidAmount();
        }
        if (addonAmount + borrowedAmount > type(uint64).max) {
            revert Error.InvalidAmount();
        }
    }

    /**
     * @dev Calculates the sum of all elements in an calldata array.
     * @param values Array of amounts to sum.
     * @return The total sum of all array elements.
     */
    function _sumArray(uint256[] calldata values) internal pure returns (uint256) {
        uint256 len = values.length;
        uint256 sum = 0;
        for (uint256 i = 0; i < len; ++i) {
            sum += values[i];
        }
        return sum;
    }

    /**
     * @dev Validates the loan durations in the array.
     * @param durationsInPeriods Array of loan durations in periods.
     */
    function _checkDurationArray(uint256[] calldata durationsInPeriods) internal pure {
        uint256 len = durationsInPeriods.length;
        uint256 previousDuration = durationsInPeriods[0];
        for (uint256 i = 1; i < len; ++i) {
            uint256 duration = durationsInPeriods[i];
            if (duration < previousDuration) {
                revert DurationArrayInvalid();
            }
            previousDuration = duration;
        }
    }

    /**
     * @dev Ensures the sub-loan count is within the valid range.
     * @param installmentCount The number of sub-loans to check.
     */
    function _checkSubLoanCount(uint256 installmentCount) internal view {
        if (installmentCount > _subLoanCountMax()) {
            revert InstallmentCountExcess();
        }
    }

    /**
     * @dev Updates the loan parts data in storage.
     * @param subLoanId The ID of the sub-loan to update.
     * @param firstSubLoanId The ID of the first sub-loan.
     * @param subLoanCount The total number of sub-loans.
     */
    function _updateLoanPartsData(
        uint256 subLoanId, // Tools: this comment prevents Prettier from formatting into a single line.
        uint256 firstSubLoanId,
        uint256 subLoanCount
    ) internal {
        LoanV2.SubLoan storage subLoan = _getLendingMarketStorage().subLoans[subLoanId];
        subLoan.firstSubLoanId = uint40(firstSubLoanId); // Unchecked conversion is safe due to contract logic
        subLoan.subLoanCount = uint16(subLoanCount); // Unchecked conversion is safe due to contract logic
    }

    /**
     * @dev Validates that the loan ID is within the valid range.
     * @param id The loan ID to check.
     */
    function _checkLoanId(uint256 id) internal pure {
        if (id > type(uint40).max) {
            revert LoanIdExcess();
        }
    }

    /**
     * @dev Checks if a loan with the specified ID is ongoing.
     * @param loanId The ID of the loan.
     */
    function _checkIfLoanOngoing(uint256 loanId) internal view {
        Loan.State storage loan = _loans[loanId];
        _checkLoanExistence(loan);
        if (_isRepaid(loan)) {
            revert LoanAlreadyRepaid();
        }
    }

    /**
     * @dev Checks if the undoing repayment parameters are valid.
     * @param loan The storage state of the loan.
     * @param repaymentAmount The repayment amount to check.
     * @param repaymentTimestamp The repayment timestamp to check in the lending market time zone.
     */
    function _checkUndoingRepaymentParameters(
        Loan.State storage loan,
        uint256 repaymentAmount,
        uint256 repaymentTimestamp
    ) internal view {
        uint256 roundedRepaymentAmount = Rounding.roundMath(repaymentAmount, Constants.ACCURACY_FACTOR);
        if (repaymentAmount == 0 || roundedRepaymentAmount > loan.repaidAmount) {
            revert Error.InvalidAmount();
        }
        if (repaymentTimestamp < loan.startTimestamp) {
            revert RepaymentTimestampInvalid();
        }
    }

    /**
     * @dev Calculates the tracked balance of a loan.
     * @param loan The storage state of the loan to calculate the tracked balance for.
     * @param timestamp The timestamp to calculate the tracked balance at.
     * @return trackedBalance The new calculated tracked balance of the loan at the specified timestamp.
     * @return lateFeeAmount The late fee amount or zero if the loan is not defaulted at the specified timestamp.
     */
    function _calculateTrackedBalance(
        Loan.State storage loan,
        uint256 timestamp
    ) internal view returns (uint256 trackedBalance, uint256 lateFeeAmount) {
        return _calculateCustomTrackedBalance(loan, loan.trackedBalance, loan.trackedTimestamp, timestamp);
    }

    /**
     * @dev Calculates the tracked balance of a loan with additional parameters.
     * @param loan The storage state of the loan to calculate the tracked balance for.
     * @param initialBalance The initial balance for the calculation.
     * @param startTimestamp The start timestamp for the calculation.
     * @param finishTimestamp The finish timestamp for the calculation.
     * @return trackedBalance The new calculated tracked balance of the loan at the specified timestamp.
     * @return lateFeeAmount The late fee amount or zero if the loan is not defaulted at the specified timestamp.
     */
    function _calculateCustomTrackedBalance(
        Loan.State storage loan,
        uint256 initialBalance,
        uint256 startTimestamp,
        uint256 finishTimestamp
    ) internal view returns (uint256 trackedBalance, uint256 lateFeeAmount) {
        trackedBalance = initialBalance;

        {
            uint256 freezeTimestamp = loan.freezeTimestamp;
            if (freezeTimestamp != 0 && freezeTimestamp < finishTimestamp) {
                finishTimestamp = freezeTimestamp;
            }
        }

        uint256 finishPeriodIndex = _periodIndex(finishTimestamp, Constants.PERIOD_IN_SECONDS);
        uint256 startPeriodIndex = _periodIndex(startTimestamp, Constants.PERIOD_IN_SECONDS);

        if (trackedBalance != 0 && finishPeriodIndex > startPeriodIndex) {
            uint256 duePeriodIndex = _getDuePeriodIndex(loan);
            if (startPeriodIndex <= duePeriodIndex) {
                if (finishPeriodIndex <= duePeriodIndex) {
                    trackedBalance = InterestMath.calculateTrackedBalance(
                        trackedBalance,
                        finishPeriodIndex - startPeriodIndex,
                        loan.interestRatePrimary,
                        Constants.INTEREST_RATE_FACTOR
                    );
                } else {
                    trackedBalance = InterestMath.calculateTrackedBalance(
                        trackedBalance,
                        duePeriodIndex - startPeriodIndex,
                        loan.interestRatePrimary,
                        Constants.INTEREST_RATE_FACTOR
                    );
                    lateFeeAmount = _calculateLateFee(trackedBalance, loan);
                    trackedBalance += lateFeeAmount;
                    trackedBalance = InterestMath.calculateTrackedBalance(
                        trackedBalance,
                        finishPeriodIndex - duePeriodIndex,
                        loan.interestRateSecondary,
                        Constants.INTEREST_RATE_FACTOR
                    );
                }
            } else {
                trackedBalance = InterestMath.calculateTrackedBalance(
                    trackedBalance,
                    finishPeriodIndex - startPeriodIndex,
                    loan.interestRateSecondary,
                    Constants.INTEREST_RATE_FACTOR
                );
            }
        }
    }


    /**
     * @dev Calculates the loan extended preview.
     * @param loanId The ID of the loan.
     * @param timestamp The timestamp to calculate the preview at.
     * @return The loan extended preview.
     */
    function _getSubLoanPreview(
        uint256 loanId,
        uint256 timestamp
    ) internal view returns (Loan.PreviewExtended memory) {
        Loan.PreviewExtended memory preview;
        Loan.State storage loan = _loans[loanId];

        preview.periodIndex = _periodIndex(timestamp, Constants.PERIOD_IN_SECONDS);
        (preview.trackedBalance, preview.lateFeeAmount) = _calculateTrackedBalance(loan, timestamp);
        preview.outstandingBalance = Rounding.roundMath(preview.trackedBalance, Constants.ACCURACY_FACTOR);
        preview.borrowedAmount = loan.borrowedAmount;
        preview.addonAmount = loan.addonAmount;
        preview.repaidAmount = loan.repaidAmount;
        preview.lateFeeAmount += loan.lateFeeAmount;
        preview.discountAmount = loan.discountAmount;
        preview.programId = loan.programId;
        preview.borrower = loan.borrower;
        preview.previewTimestamp = timestamp;
        preview.startTimestamp = loan.startTimestamp;
        preview.trackedTimestamp = loan.trackedTimestamp;
        preview.freezeTimestamp = loan.freezeTimestamp;
        preview.durationInPeriods = loan.durationInPeriods;
        preview.interestRatePrimary = loan.interestRatePrimary;
        preview.interestRateSecondary = loan.interestRateSecondary;
        preview.firstInstallmentId = loan.firstInstallmentId;
        preview.installmentCount = loan.installmentCount;

        return preview;
    }

    /**
     * @dev Calculates the preview of a loan.
     * @param loanId The ID of the loan.
     * @param timestamp The timestamp to calculate the preview at.
     * @return The installment loan preview.
     */
    function _getLoanPreview(
        uint256 loanId,
        uint256 timestamp
    ) internal view returns (Loan.InstallmentLoanPreview memory) {
        if (timestamp == 0) {
            timestamp = _blockTimestamp();
        }
        Loan.State storage loan = _loans[loanId];
        Loan.InstallmentLoanPreview memory preview;
        preview.installmentCount = loan.installmentCount;
        uint256 loanCount = 1;
        if (preview.installmentCount > 0) {
            loanId = loan.firstInstallmentId;
            preview.firstInstallmentId = loanId;
            loanCount = preview.installmentCount;
        } else {
            preview.firstInstallmentId = loanId;
        }
        preview.installmentPreviews = new Loan.PreviewExtended[](loanCount);

        Loan.PreviewExtended memory singleLoanPreview;
        for (uint256 i = 0; i < loanCount; ++i) {
            singleLoanPreview = _getSubLoanPreview(loanId, timestamp);
            preview.totalTrackedBalance += singleLoanPreview.trackedBalance;
            preview.totalOutstandingBalance += singleLoanPreview.outstandingBalance;
            preview.totalBorrowedAmount += singleLoanPreview.borrowedAmount;
            preview.totalAddonAmount += singleLoanPreview.addonAmount;
            preview.totalRepaidAmount += singleLoanPreview.repaidAmount;
            preview.totalLateFeeAmount += singleLoanPreview.lateFeeAmount;
            preview.totalDiscountAmount += singleLoanPreview.discountAmount;
            preview.installmentPreviews[i] = singleLoanPreview;
            ++loanId;
        }
        preview.periodIndex = singleLoanPreview.periodIndex;

        return preview;
    }

    /**
     * @dev Calculates the due period index for a loan.
     * @param loan The storage state of the loan.
     * @return The due period index.
     */
    function _getDuePeriodIndex(Loan.State storage loan) internal view returns (uint256) {
        uint256 startPeriodIndex = _periodIndex(loan.startTimestamp, Constants.PERIOD_IN_SECONDS);
        return startPeriodIndex + loan.durationInPeriods;
    }

    /**
     * @dev Calculates the due timestamp for a loan.
     * @param loan The storage state of the loan.
     * @return The due timestamp.
     */
    function _getDueTimestamp(Loan.State storage loan) internal view returns (uint256) {
        return _getDuePeriodIndex(loan) * Constants.PERIOD_IN_SECONDS + Constants.PERIOD_IN_SECONDS - 1;
    }

    /**
     * @dev Checks if the loan is repaid.
     * @param loan The storage state of the loan.
     * @return True if the loan is repaid, false otherwise.
     */
    function _isRepaid(Loan.State storage loan) internal view returns (bool) {
        return loan.trackedBalance == 0;
    }

    /**
     * @dev TODO
     */
    function _isRepaid(LoanV2.ProcessingSubLoan memory subLoan) internal view returns (bool) {
        return uint256(subLoan.status) != uint256(LoanV2.SubLoanStatus.FullyRepaid);
    }

    /// @dev Calculates the period index that corresponds the specified timestamp.
    function _periodIndex(uint256 timestamp, uint256 periodInSeconds_) internal pure returns (uint256) {
        return (timestamp / periodInSeconds_);
    }

    /// @dev Calculates the day index that corresponds the specified timestamp.
    function _dayIndex(uint256 timestamp) internal pure returns (uint256) {
        return (timestamp / 1 days);
    }

    /// @dev Returns the current block timestamp with the time offset applied.
    // TODO: 1. Rename to currentTimestamp or whatever. 2. Consider use timestamps without the offset
    function _blockTimestamp() internal view virtual returns (uint256) {
        return block.timestamp - Constants.NEGATIVE_TIME_OFFSET;
    }

    /// @dev Returns the maximum number of sub-loans for a loan. Can be overridden for testing purposes.
    function _subLoanCountMax() internal view virtual returns (uint256) {
        return Constants.INSTALLMENT_COUNT_MAX;
    }

    /// TODO
    function _calculateLateFee(LoanV2.ProcessingSubLoan subLoan) internal view {
        // The equivalent formula: round(trackedPrincipal * lateFeeRate / INTEREST_RATE_FACTOR)
        // Where division operator `/` takes into account the fractional part and
        // the `round()` function returns an integer rounded according to standard mathematical rules.
        uint256 product = subLoan.trackedPrincipal * subLoan.lateFeeRate;
        uint256 remainder = product % Constants.INTEREST_RATE_FACTOR;
        uint256 result = product / Constants.INTEREST_RATE_FACTOR;
        if (remainder >= (Constants.INTEREST_RATE_FACTOR / 2)) {
            ++result;
        }
        subLoan.trackedLateFee = uint64(_roundMath(result)); // Safe cast due to prior checks
    }

    /// TODO
    function _roundMath(uint256 value) internal pure returns (uint256) {
        return Rounding.roundMath(value, Constants.ACCURACY_FACTOR);
    }

    /**
     * @dev Calculates the late fee amount for a loan.
     * @param trackedBalance The tracked balance of the loan.
     * @param loan The storage state of the loan.
     * @return The late fee amount.
     */
    function _calculateLateFee(
        uint256 trackedBalance, // Tools: this comment prevents Prettier from formatting into a single line.
        Loan.State storage loan
    ) internal view returns (uint256) {
        address creditLine = _programCreditLines[loan.programId];
        // The `creditLine` variable is not checked because it is always non-zero according to the contract logic.
        return ICreditLine(creditLine).determineLateFeeAmount(loan.borrower, trackedBalance);
    }


    /**
     * @dev Checks if the credit line and liquidity pool are valid.
     * @param creditLine The address of the credit line.
     * @param liquidityPool The address of the liquidity pool.
     */
    function _checkCreditLineAndLiquidityPool(address creditLine, address liquidityPool) internal view {
        if (creditLine == address(0)) {
            revert Error.ZeroAddress();
        }
        if (creditLine.code.length == 0) {
            revert Error.ContractAddressInvalid();
        }
        try ICreditLine(creditLine).proveCreditLine() {} catch {
            revert Error.ContractAddressInvalid();
        }

        if (liquidityPool == address(0)) {
            revert Error.ZeroAddress();
        }
        if (liquidityPool.code.length == 0) {
            revert Error.ContractAddressInvalid();
        }
        try ILiquidityPool(liquidityPool).proveLiquidityPool() {} catch {
            revert Error.ContractAddressInvalid();
        }
    }

    /**
     * @dev Transfers tokens from the liquidity pool to the borrower and the addon treasury.
     * @param subLoanId The ID of the loan.
     * @param borrowedAmount The amount of tokens to borrow.
     * @param addonAmount The addon amount of the loan.
     */
    function _transferTokensOnLoanTaking(uint256 subLoanId, uint256 borrowedAmount, uint256 addonAmount) internal {
        LoanV2.SubLoan storage subLoan = _getLendingMarketStorage().subLoans[subLoanId];
        address liquidityPool = _getLendingMarketStorage().programLiquidityPools[subLoan.programId];
        address token = _getLendingMarketStorage().token;
        address addonTreasury = ILiquidityPool(liquidityPool).addonTreasury();
        if (addonTreasury == address(0)) {
            revert AddonTreasuryAddressZero();
        }
        IERC20(token).safeTransferFrom(liquidityPool, subLoan.borrower, borrowedAmount);
        if (addonAmount != 0) {
            IERC20(token).safeTransferFrom(liquidityPool, addonTreasury, addonAmount);
        }
    }

    /**
     * @dev Transfers tokens from the borrower and the addon treasury back to the liquidity pool.
     * @param loan The storage state of the loan.
     * @param borrowedAmount The amount of tokens to borrow.
     * @param addonAmount The addon amount of the loan.
     * @param repaidAmount The repaid amount of the loan.
     */
    function _transferTokensOnLoanRevocation(
        LoanV2.ProcessingSubLoan memory subLoan,
        uint256 borrowedAmount,
        uint256 addonAmount,
        uint256 repaidAmount
    ) internal {
        address liquidityPool = _getLendingMarketStorage().programLiquidityPools[subLoan.programId];
        address token = _getLendingMarketStorage().token;
        address addonTreasury = ILiquidityPool(liquidityPool).addonTreasury();
        if (addonTreasury == address(0)) {
            revert AddonTreasuryAddressZero();
        }
        if (repaidAmount < borrowedAmount) {
            IERC20(token).safeTransferFrom(subLoan.borrower, liquidityPool, borrowedAmount - repaidAmount);
        } else if (repaidAmount != borrowedAmount) {
            IERC20(token).safeTransferFrom(liquidityPool, subLoan.borrower, repaidAmount - borrowedAmount);
        }
        if (addonAmount != 0) {
            IERC20(token).safeTransferFrom(addonTreasury, liquidityPool, addonAmount);
        }
    }

    /**
     * @dev The upgrade validation function for the UUPSExtUpgradeable contract.
     * @param newImplementation The address of the new implementation.
     */
    function _validateUpgrade(address newImplementation) internal view override onlyRole(OWNER_ROLE) {
        try ILendingMarketV2(newImplementation).proveLendingMarket() {} catch {
            revert Error.ImplementationAddressInvalid();
        }
    }
}
