// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { ABDKMath64x64 } from "../libraries/ABDKMath64x64.sol";

import { LendingMarketStorageLayoutV2 } from "../storage/LendingMarketStorageLayoutV2.sol";

import { ICreditLineV2 } from "../interfaces/ICreditLineV2.sol"; // TODO V2
import { ILendingMarketErrorsV2 } from "../interfaces/ILendingMarketV2.sol";
import { ILendingMarketPrimaryEventsV2 } from "../interfaces/ILendingMarketV2.sol";
import { ILiquidityPool } from "../interfaces/ILiquidityPool.sol"; // TODO V2

/**
 * @title LendingMarketCore contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Internal functions used both in the credit market contract and in its engine.
 */
abstract contract LendingMarketCore is
    LendingMarketStorageLayoutV2,
    ILendingMarketPrimaryEventsV2,
    ILendingMarketErrorsV2
{
    // ------------------ Types ----------------------------------- //

    using SafeERC20 for IERC20;

    /// @dev Represents a sub-loan that is affected by an operation. For internal use only.
    struct OperationAffectedSubLoan {
        uint256 subLoanId;
        uint256 minOperationTimestamp;
        address counterparty;
    }

    // ------------------ Constants ------------------------------- //

    /// @dev The negative time offset in seconds that is used to calculate the day boundary for the lending market.
    uint256 internal constant NEGATIVE_DAY_BOUNDARY_OFFSET = 3 hours;

    /// @dev The rate factor used for the interest rate calculations.
    uint256 internal constant INTEREST_RATE_FACTOR = 10 ** 9;

    /// @dev The accuracy factor used for loan amounts calculation.
    // TODO: provide an appropriate view function to get this value externally
    uint256 internal constant ACCURACY_FACTOR = 10000;

    /// @dev The maximum number of installments. Must not be greater than uint16,
    // TODO: provide an appropriate view function to get this value externally
    uint256 internal constant INSTALLMENT_COUNT_MAX = 255;

    // ------------------ Internal functions ---------------------- //

    /**
     * @dev Takes a sub-loan for a provided account internally. TODO params
     * @return The unique identifier of the loan.
     */
    function _takeSubLoan(
        address borrower,
        uint256 programId,
        uint256 packedRates,
        SubLoanTakingRequest calldata subLoanTakingRequest
    ) internal returns (uint256) {
        {
            (address creditLine,) = _getCreditLineAndLiquidityPool(programId);
            ICreditLineV2(creditLine).onBeforeLoanOpened(borrower, subLoanTakingRequest.borrowedAmount);
        }
        uint256 id = _increaseSubLoanId();
        SubLoan storage subLoan = _getSubLoanInStorage(id);

        // TODO: Check if the following fields are set correctly and comments about zero fields are correct too

        // Set the sub-loan fields and call the hook function in a separate block to avoid the 'stack too deep' error
        {
            uint256 blockTimestamp = _blockTimestamp();
            uint256 borrowedAmount = subLoanTakingRequest.borrowedAmount;
            uint256 principal = borrowedAmount + subLoanTakingRequest.addonAmount;
            uint256 duration = subLoanTakingRequest.duration;
            (uint256 interestRateRemuneratory, uint256 interestRateMoratory, uint256 lateFeeRate) = _unpackRates(
                packedRates
            );

            // Slot1
            subLoan.programId = uint24(programId);
            subLoan.borrowedAmount = uint64(borrowedAmount); // Safe cast due to prior checks
            subLoan.addonAmount = uint64(subLoanTakingRequest.addonAmount); // Safe cast due to prior checks
            subLoan.startTimestamp = uint32(blockTimestamp); // Safe cast due to prior checks
            subLoan.initialDuration = uint16(duration); // Safe cast due to prior checks
            // Other loan fields are zero: firstSubLoanId, subLoanCount

            // Slot 2
            subLoan.borrower = borrower;
            subLoan.initialInterestRateRemuneratory = uint32(interestRateRemuneratory); // Safe cast
            subLoan.initialInterestRateMoratory = uint32(interestRateMoratory); // Safe cast due to prior checks
            subLoan.initialLateFeeRate = uint32(lateFeeRate); // Safe cast due to prior checks

            // Slot 3
            subLoan.status = SubLoanStatus.Ongoing;
            subLoan.revision = 1;
            subLoan.duration = uint16(duration); // Safe cast due to prior checks
            subLoan.interestRateRemuneratory = uint32(interestRateRemuneratory); // Safe cast due to prior checks
            subLoan.interestRateMoratory = uint32(interestRateMoratory);
            subLoan.lateFeeRate = uint32(lateFeeRate); // Safe cast due to prior checks
            subLoan.trackedTimestamp = uint32(blockTimestamp); // Safe cast due to prior checks
            // subLoan.freezeTimestamp = 0;
            // subLoan.firstSubLoanId = 0;
            // subLoan.subLoanCount = 0;
            // subLoan.operationCount = 0;
            // subLoan.earliestOperationId = 0;
            // subLoan.recentOperationId = 0;

            // Slot 4
            subLoan.trackedPrincipal = uint64(principal); // Safe cast due to prior checks
            // Other loan fields are zero: trackedInterestRemuneratory, trackedInterestMoratory, lateFeeAmount

            // Slot 5
            // All fields are zero: repaidPrincipal, repaidInterestRemuneratory, repaidInterestMoratory, repaidLateFee
        }

        emit SubLoanTaken(
            id,
            subLoanTakingRequest.borrowedAmount,
            subLoanTakingRequest.addonAmount,
            subLoanTakingRequest.duration,
            bytes32(packedRates)
        );

        return id;
    }

    /// @dev TODO
    function _executeRepaymentBatch(RepaymentRequest[] calldata repaymentRequests) internal {
        uint256 affectedSubLoanCount = 0;
        uint256 count = repaymentRequests.length;
        OperationAffectedSubLoan[] memory affectedSubLoans = new OperationAffectedSubLoan[](count);
        for (uint256 i = 0; i < count; ++i) {
            RepaymentRequest calldata repaymentRequest = repaymentRequests[i];
            uint256 timestamp = repaymentRequest.timestamp == 0 ? _blockTimestamp() : repaymentRequest.timestamp;
            affectedSubLoanCount = _scheduleOperation(
                repaymentRequest.subLoanId,
                uint256(OperationKind.Repayment),
                timestamp,
                repaymentRequest.repaymentAmount,
                repaymentRequest.repayer,
                affectedSubLoans,
                affectedSubLoanCount
            );
        }
        _processAffectedSubLoans(affectedSubLoans, affectedSubLoanCount);
    }

    /// @dev TODO
    function _executeOperationBatch(
        uint256 operationKind,
        SubLoanOperationRequest[] calldata operationRequests
    ) internal {
        uint256 affectedSubLoanCount = 0;
        uint256 count = operationRequests.length;
        OperationAffectedSubLoan[] memory affectedSubLoans = new OperationAffectedSubLoan[](count);
        for (uint256 i = 0; i < count; ++i) {
            SubLoanOperationRequest calldata operationRequest = operationRequests[i];
            uint256 timestamp = operationRequest.timestamp == 0 ? _blockTimestamp() : operationRequest.timestamp;
            affectedSubLoanCount = _scheduleOperation(
                operationRequest.subLoanId,
                operationKind,
                timestamp,
                operationRequest.value,
                address(0), // account is not needed for these operations
                affectedSubLoans,
                affectedSubLoanCount
            );
        }
        _processAffectedSubLoans(affectedSubLoans, affectedSubLoanCount);
    }

    function _scheduleOperation(
        uint256 subLoanId,
        uint256 kind,
        uint256 timestamp,
        uint256 inputValue,
        address account,
        OperationAffectedSubLoan[] memory affectedSubLoans,
        uint256 affectedSubLoanCount
    ) internal returns (uint256 newAffectedSubLoanCount) {
        _checkOperationParameters(
            kind,
            timestamp,
            inputValue,
            account
        );
        _addOperation(
            subLoanId,
            kind,
            timestamp,
            inputValue,
            account
        );
        return _includeAffectedSubLoan(
            affectedSubLoans,
            affectedSubLoanCount,
            subLoanId,
            timestamp,
            address(0) // counterparty is not needed for added operations
        );
    }

    /// @dev TODO
    function _voidOperationBatch(OperationVoidingRequest[] memory OperationVoidingRequests) internal {
        uint256 affectedSubLoanCount = 0;
        uint256 count = OperationVoidingRequests.length;
        OperationAffectedSubLoan[] memory affectedSubLoans = new OperationAffectedSubLoan[](count);
        for (uint256 i = 0; i < count; ++i) {
            OperationVoidingRequest memory voidingRequest = OperationVoidingRequests[i];
            Operation storage operation = _voidOperation(
                voidingRequest.subLoanId,
                voidingRequest.operationId,
                voidingRequest.counterparty
            );
            affectedSubLoanCount = _includeAffectedSubLoan(
                affectedSubLoans,
                affectedSubLoanCount,
                voidingRequest.subLoanId,
                operation.timestamp,
                voidingRequest.counterparty
            );
        }
        _processAffectedSubLoans(affectedSubLoans, affectedSubLoanCount);
    }

    /**
     * @dev TODO
     */
    function _addOperation(
        uint256 subLoanId,
        uint256 kind,
        uint256 timestamp,
        uint256 inputValue,
        address account
    ) internal returns (uint256) {
        LendingMarketStorageV2 storage storageStruct = _getLendingMarketStorage();
        SubLoan storage subLoan = storageStruct.subLoans[subLoanId];
        if (timestamp < subLoan.startTimestamp) {
            revert OperationTimestampTooEarly();
        }
        uint256 operationId = uint256(subLoan.operationCount) + 1;
        _checkOperationId(operationId);
        subLoan.operationCount = uint16(operationId);
        uint256 prevOperationId = _findEarlierOperation(subLoanId, timestamp);
        uint256 nextOperationId;

        if (prevOperationId == 0) {
            // Add at the beginning of the operation list
            nextOperationId = subLoan.earliestOperationId;
            subLoan.earliestOperationId = uint16(operationId);
        } else {
            // Insert in the middle or at the end of the operation list
            nextOperationId = storageStruct.subLoanOperations[subLoanId][prevOperationId].nextOperationId;
            storageStruct.subLoanOperations[subLoanId][prevOperationId].nextOperationId = uint16(operationId);
        }
        Operation storage operation = storageStruct.subLoanOperations[subLoanId][operationId];
        operation.status = OperationStatus.Pending;
        operation.kind = OperationKind(kind);
        operation.nextOperationId = uint16(nextOperationId); // Safe cast due to prior checks
        operation.timestamp = uint32(timestamp); // Safe cast due to prior checks
        operation.inputValue = uint64(inputValue); // Safe cast due to prior checks

        if (account != address(0)) {
            operation.account = account;
        }

        if (timestamp > _blockTimestamp()) {
            emit OperationPended(
                subLoanId, // Tools: prevent Prettier one-liner
                operationId,
                OperationKind(kind),
                timestamp,
                inputValue,
                account
            );
        }

        return operationId;
    }

    /**
     * @dev TODO
     */
    function _voidOperation(
        uint256 subLoanId,
        uint256 operationId,
        address counterparty
    ) internal returns (Operation storage operation) {
        operation = _getExistingOperationInStorage(subLoanId, operationId);
        uint256 previousStatus = uint256(operation.status);
        if (operation.kind == OperationKind.Revocation) {
            revert OperationVoidingProhibited();
        }
        if (previousStatus == uint256(OperationStatus.Pending)) {
            operation.status = OperationStatus.Canceled;

            emit OperationCanceled(
                subLoanId, // Tools: prevent Prettier one-liner
                operationId,
                operation.kind
            );
        } else if (previousStatus == uint256(OperationStatus.Applied)) {
            operation.status = OperationStatus.Revoked;

            emit OperationRevoked(
                subLoanId, // Tools: prevent Prettier one-liner
                operationId,
                operation.kind,
                counterparty
            );
        } else {
            if (previousStatus == uint256(OperationStatus.Canceled)) {
                revert OperationCanceledAlready();
            } else {
                revert OperationRevokedAlready();
            }
        }
    }

    /**
     * @dev Sets the loan parts data in storage.
     * @param subLoanId The ID of the sub-loan to update.
     * @param firstSubLoanId The ID of the first sub-loan.
     * @param subLoanCount The total number of sub-loans.
     */
    function _setLoanPartsData(
        uint256 subLoanId, // Tools: prevent Prettier one-liner
        uint256 firstSubLoanId,
        uint256 subLoanCount
    ) internal {
        SubLoan storage subLoan = _getSubLoanInStorage(subLoanId);
        subLoan.firstSubLoanId = uint40(firstSubLoanId); // Unchecked conversion is safe due to contract logic
        subLoan.subLoanCount = uint16(subLoanCount); // Unchecked conversion is safe due to contract logic
    }

    /**
     * @dev Transfers tokens from the liquidity pool to the borrower and the addon treasury.
     * @param subLoanId The ID of the loan.
     * @param borrowedAmount The amount of tokens to borrow.
     * @param addonAmount The addon amount of the loan.
     */
    function _transferTokensOnLoanTaking(uint256 subLoanId, uint256 borrowedAmount, uint256 addonAmount) internal {
        SubLoan storage subLoan = _getSubLoanInStorage(subLoanId);
        uint256 programId = subLoan.programId;
        address addonTreasury = _getAndCheckAddonTreasury(programId);
        _transferFromPool(programId, subLoan.borrower, borrowedAmount);
        if (addonAmount != 0) {
            _transferFromPool(programId, addonTreasury, addonAmount);
        }
    }

    /**
     * @dev Transfers tokens from the borrower and the addon treasury back to the liquidity pool.
     * @param firstSubLoanId The ID of the first sub-loan.
     * @param subLoanCount The total number of sub-loans.
     */
    function _transferTokensOnLoanRevocation(
        uint256 firstSubLoanId,
        uint256 subLoanCount
    ) internal {
        SubLoan storage subLoan = _getSubLoanInStorage(firstSubLoanId);
        uint256 totalBorrowedAmount = subLoan.borrowedAmount;
        uint256 totalAddonAmount = subLoan.addonAmount;
        uint256 totalRepaidAmount = subLoan.repaidPrincipal;
        for (uint256 i = 1; i < subLoanCount; ++i) {
            subLoan = _getSubLoanInStorage(firstSubLoanId + i);
            totalBorrowedAmount += subLoan.borrowedAmount;
            totalAddonAmount += subLoan.addonAmount;
            totalRepaidAmount += subLoan.repaidPrincipal;
        }
        uint256 programId = subLoan.programId;
        address borrower = subLoan.borrower;
        address addonTreasury = _getAndCheckAddonTreasury(programId);

        if (totalRepaidAmount < totalBorrowedAmount) {
            _transferToPool(programId, borrower, totalBorrowedAmount - totalRepaidAmount);
        } else if (totalRepaidAmount != totalBorrowedAmount) {
            _transferFromPool( programId, borrower, totalRepaidAmount - totalBorrowedAmount);
        }
        if (totalAddonAmount != 0) {
            _transferToPool( programId, addonTreasury, totalAddonAmount);
        }
    }

    /**
     * @dev TODO
     */
    function _transferTokensOnSubLoanRepayment(
        ProcessingSubLoan memory subLoan,
        ProcessingOperation memory operation
    ) internal {
        uint256 repaymentAmount = _calculateSumAmountByParts(operation.newSubLoanValue);
        repaymentAmount -= _calculateSumAmountByParts(operation.oldSubLoanValue);
        _transferToPool(
            subLoan.programId,
            operation.account,
            repaymentAmount
        );
    }

    /**
     * @dev Transfers tokens from a liquidity pool to a receiver through this contract by a lending program ID.
     * @param programId The ID of the lending program.
     * @param receiver The address of the receiver.
     * @param amount The amount of tokens to transfer.
     */
    function _transferFromPool(uint256 programId, address receiver, uint256 amount) internal {
        (address token, address liquidityPool) = _getTokenAndLiquidityPool(programId);
        ILiquidityPool(liquidityPool).onBeforeLiquidityOut(amount);
        // TODO: Notify the token flow has been changed
        IERC20(token).safeTransferFrom(liquidityPool, address(this), amount);
        IERC20(token).safeTransfer(receiver, amount);
    }

    /**
     * @dev Transfers tokens from a sender to a liquidity pool through this contract by a program ID.
     * @param programId The ID of the lending program.
     * @param sender The address of the sender.
     * @param amount The amount of tokens to transfer.
     */
    function _transferToPool(uint256 programId, address sender, uint256 amount) internal {
        (address token, address liquidityPool) = _getTokenAndLiquidityPool(programId);
        ILiquidityPool(liquidityPool).onBeforeLiquidityIn(amount);
        // TODO: Notify the token flow has been changed
        IERC20(token).safeTransferFrom(sender, address(this), amount);
        IERC20(token).safeTransfer(liquidityPool, amount);
    }

    /**
     * @dev Finds the operation that should come before a new operation with the given timestamp.
     * @param subLoanId The ID of the sub-loan.
     * @param timestamp The timestamp of the operation to be inserted.
     * @return The ID of the operation that should precede the new operation, or 0 if it should be first.
     */
    function _findEarlierOperation(uint256 subLoanId, uint256 timestamp) internal view returns (uint256) {
        LendingMarketStorageV2 storage $ = _getLendingMarketStorage();
        SubLoan storage subLoan = $.subLoans[subLoanId];

        // Start from recentOperationId if available and valid
        uint256 operationId = subLoan.recentOperationId;

        if (operationId != 0 && $.subLoanOperations[subLoanId][operationId].timestamp <= timestamp) {
            // recentOperationId exists and has timestamp <= target
            uint256 nextId = $.subLoanOperations[subLoanId][operationId].nextOperationId;
            if (nextId == 0 || $.subLoanOperations[subLoanId][nextId].timestamp > timestamp) {
                // Either no more operations or next operation has timestamp > target
                // recentOperationId is the correct predecessor
                return operationId;
            }
            // Continue searching from the next operation after recentOperationId
            operationId = nextId;
        } else {
            // Start from the beginning
            operationId = subLoan.earliestOperationId;
        }

        uint256 prevOperationId = 0;

        while (operationId != 0) {
            if ($.subLoanOperations[subLoanId][operationId].timestamp > timestamp) {
                return prevOperationId;
            }
            prevOperationId = operationId;
            operationId = $.subLoanOperations[subLoanId][operationId].nextOperationId;
        }

        return prevOperationId;
    }

    /// @dev TODO
    function _processOperations(ProcessingSubLoan memory subLoan) internal {
        LendingMarketStorageV2 storage storageStruct = _getLendingMarketStorage();
        SubLoan storage subLoanStored = storageStruct.subLoans[subLoan.id];
        uint256 recentOperationId = subLoanStored.recentOperationId;
        uint256 operationId = 0;
        if (recentOperationId == 0) {
            operationId = subLoanStored.earliestOperationId;
        } else {
            operationId = storageStruct.subLoanOperations[subLoan.id][recentOperationId].nextOperationId;
        }
        if (operationId == 0) {
            return;
        }
        uint256 currentTimestamp = _blockTimestamp();
        while (operationId != 0) {
            ProcessingOperation memory operation = _getExistingOperation(subLoan.id, operationId);
            if (operation.status == uint256(OperationStatus.Pending)) {
                break;
            }
            _processSingleOperation(subLoan, operation, currentTimestamp);
            _postProcessOperation(subLoan, operation);
            recentOperationId = operationId;
            if (operation.kind == uint256(OperationKind.Revocation)) {
                break;
            }
            operationId = storageStruct.subLoanOperations[subLoan.id][operationId].nextOperationId;
        }
        subLoanStored.recentOperationId = uint16(recentOperationId); // Safe cast due to prior checks
        _updateSubLoan(subLoan);
    }

    /// @dev TODO
    function _replayOperations(ProcessingSubLoan memory subLoan, address counterparty) internal {
        _initiateSubLoan(subLoan);
        subLoan.counterparty = counterparty;
        _getLendingMarketStorage().subLoans[subLoan.id].recentOperationId = 0;
        _processOperations(subLoan);
    }

    /// @dev TODO
    function _treatOperations(uint256 subLoanId, uint256 timestamp, address counterparty) internal {
        ProcessingSubLoan memory subLoan = _getNonRevokedSubLoan(subLoanId);
        if (timestamp < _blockTimestamp()) {
            _replayOperations(subLoan, counterparty);
        } else {
            _processOperations(subLoan);
        }
    }

    /**
     * @dev TODO
     */
    function _processSingleOperation(
        ProcessingSubLoan memory subLoan,
        ProcessingOperation memory operation,
        uint256 currentTimestamp
    ) internal pure {
        if (
            operation.status != uint256(OperationStatus.Pending) &&
            operation.status != uint256(OperationStatus.Applied)
        ) {
            return;
        }
        uint256 operationTimestamp = operation.timestamp;
        if (operationTimestamp <= subLoan.trackedTimestamp) {
            revert OperationTimestampInvalid();
        }
        if (operationTimestamp <= currentTimestamp) {
            // TODO: We might not accrue the interest for all operations
            _accrueInterest(subLoan, operation.timestamp);
            _applyOperation(subLoan, operation);
        }
    }

    /**
     * @dev TODO
     */
    function _postProcessOperation(
        ProcessingSubLoan memory subLoan,
        ProcessingOperation memory operation
    ) internal {
        uint256 operationStatus = operation.status;
        uint256 operationKind = operation.kind;
        if (
            operationStatus == uint256(OperationStatus.Applied) || // Tools: prevent Prettier one-liner
            operationStatus != operation.initialStatus
        ) {
            _acceptOperationApplying(subLoan, operation);
        }
        if (operationKind == uint256(OperationKind.Repayment)) {
            _emitTrackedBalanceUpdate(subLoan);
            _transferTokensOnSubLoanRepayment(subLoan, operation);
            emit SubLoanRepayment(
                subLoan.id,
                subLoan.revision,
                subLoan.trackedTimestamp,
                bytes32(operation.newSubLoanValue),
                bytes32(operation.oldSubLoanValue)
            );
        } else if (operationKind == uint256(OperationKind.Discounting)) {
            _emitTrackedBalanceUpdate(subLoan);
            emit SubLoanDiscount(
                subLoan.id,
                subLoan.revision,
                subLoan.trackedTimestamp,
                bytes32(operation.newSubLoanValue),
                bytes32(operation.oldSubLoanValue)
            );
        } else if (operationKind == uint256(OperationKind.SetInterestRateRemuneratory)) {
            _emitTrackedBalanceUpdate(subLoan);
            emit SubLoanInterestRateRemuneratoryUpdated(
                subLoan.id,
                subLoan.revision,
                subLoan.trackedTimestamp,
                operation.newSubLoanValue,
                operation.oldSubLoanValue
            );
        } else if (operationKind == uint256(OperationKind.SetInterestRateMoratory)) {
            _emitTrackedBalanceUpdate(subLoan);
            emit SubLoanInterestRateMoratoryUpdated(
                subLoan.id,
                subLoan.revision,
                subLoan.trackedTimestamp,
                operation.newSubLoanValue,
                operation.oldSubLoanValue
            );
        } else if (operationKind == uint256(OperationKind.SetLateFeeRate)) {
            _emitTrackedBalanceUpdate(subLoan);
            emit SubLoanLateFeeRateUpdated(
                subLoan.id,
                subLoan.revision,
                subLoan.trackedTimestamp,
                operation.newSubLoanValue,
                operation.oldSubLoanValue
            );
        } else if (operationKind == uint256(OperationKind.SetDuration)) {
            // no tracked balance update needed
            emit SubLoanDurationUpdated(
                subLoan.id,
                subLoan.revision,
                operation.timestamp,
                operation.newSubLoanValue,
                operation.oldSubLoanValue
            );
        } else if (operationKind == uint256(OperationKind.Freezing)) {
            // no tracked balance update needed
            emit SubLoanFrozen(
                subLoan.id, // Tools: prevent Prettier one-liner
                subLoan.revision,
                operation.timestamp
            );
        } else if (operationKind == uint256(OperationKind.Unfreezing)) {
            _emitTrackedBalanceUpdate(subLoan);
            emit SubLoanUnfrozen(
                subLoan.id, // Tools: prevent Prettier one-liner
                subLoan.revision,
                subLoan.trackedTimestamp
            );
        } else if (operationKind == uint256(OperationKind.Revocation)) {
            _emitTrackedBalanceUpdate(subLoan);
        }

        if (subLoan.status != operation.initialSubLoanStatus) {
            emit SubLoanStatusUpdated(
                subLoan.id,
                subLoan.revision,
                SubLoanStatus(subLoan.status),
                subLoan.trackedTimestamp,
                SubLoanStatus(operation.initialSubLoanStatus)
            );
        }
    }

    /**
     * @dev TODO
     */
    function _initiateSubLoan(ProcessingSubLoan memory subLoan) internal {
        SubLoan storage oldSubLoan = _getSubLoanInStorage(subLoan.id);
        uint256 revision = _increaseRevision(oldSubLoan);
        subLoan.status = uint256(SubLoanStatus.Ongoing);
        subLoan.revision = revision;
        subLoan.duration = oldSubLoan.initialDuration;
        subLoan.interestRateRemuneratory = oldSubLoan.initialInterestRateRemuneratory;
        subLoan.interestRateMoratory = oldSubLoan.initialInterestRateMoratory;
        subLoan.lateFeeRate = oldSubLoan.initialLateFeeRate;
        subLoan.trackedPrincipal = oldSubLoan.borrowedAmount + oldSubLoan.addonAmount;
        subLoan.trackedInterestRemuneratory = 0;
        subLoan.trackedInterestMoratory = 0;
        subLoan.trackedLateFee = 0;
        subLoan.repaidPrincipal = 0;
        subLoan.repaidInterestRemuneratory = 0;
        subLoan.repaidInterestMoratory = 0;
        subLoan.repaidLateFee = 0;
        subLoan.discountInterestRemuneratory = 0;
        subLoan.discountInterestMoratory = 0;
        subLoan.discountLateFee = 0;
        subLoan.trackedTimestamp = subLoan.startTimestamp;
        subLoan.freezeTimestamp = 0;
    }

    /**
     * @dev TODO
     */
    function _accrueInterest(
        ProcessingSubLoan memory subLoan, // Tools: prevent Prettier one-liner
        uint256 finishTimestamp
    ) internal pure {
        uint256 startDay = _dayIndex(subLoan.trackedTimestamp);
        subLoan.trackedTimestamp = finishTimestamp;

        {
            uint256 freezeTimestamp = subLoan.freezeTimestamp;
            if (freezeTimestamp != 0 && freezeTimestamp < finishTimestamp) {
                finishTimestamp = freezeTimestamp;
            }
        }

        uint256 finishDay = _dayIndex(finishTimestamp);

        if (finishDay > startDay) {
            uint256 dueDay = _dayIndex(subLoan.startTimestamp) + subLoan.duration;
            if (startDay <= dueDay) {
                if (finishDay <= dueDay) {
                    _accrueInterestRemuneratory(subLoan, finishDay - startDay);
                } else {
                    _accrueInterestRemuneratory(subLoan, dueDay - startDay);
                    _imposeLateFee(subLoan);
                    _accrueInterestRemuneratory(subLoan, finishDay - dueDay);
                    _accrueInterestMoratory(subLoan, finishDay - dueDay);
                }
            } else {
                _accrueInterestRemuneratory(subLoan, finishDay - startDay);
                _accrueInterestMoratory(subLoan, finishDay - startDay);
            }
        }
    }
    /**
     * @dev TODO
     */
    function _applyOperation(
        ProcessingSubLoan memory subLoan,
        ProcessingOperation memory operation
    ) internal pure {
        uint256 notApplied;
        uint256 operationKind = operation.kind;
        operation.initialSubLoanStatus = subLoan.status;
        if (operationKind == uint256(OperationKind.Repayment)) {
            _applyRepayment(subLoan, operation);
        } else if (operationKind == uint256(OperationKind.Discounting)) {
            _applyDiscount(subLoan, operation);
        } else if (operationKind == uint256(OperationKind.SetDuration)) {
            _applySetDuration(subLoan, operation);
        } else if (operationKind == uint256(OperationKind.SetInterestRateRemuneratory)) {
            _applySetInterestRateRemuneratory(subLoan, operation);
        } else if (operationKind == uint256(OperationKind.SetInterestRateMoratory)) {
            _applySetInterestRateMoratory(subLoan, operation);
        } else if (operationKind == uint256(OperationKind.SetLateFeeRate)) {
            _applySetLateFeeRate(subLoan, operation);
        } else if (operationKind == uint256(OperationKind.Freezing)) {
            _applyFreezing(subLoan, operation);
        } else if (operationKind == uint256(OperationKind.Unfreezing)) {
            _applyUnfreezing(subLoan, operation);
        } else if (operationKind == uint256(OperationKind.Revocation)) {
            _applyRevocation(subLoan, operation);
        } else {
            notApplied = 1;
        }

        if (notApplied != 0) {
            operation.initialStatus = operation.status;
            operation.status = uint256(OperationStatus.Applied);
        }
    }

    /**
     * @dev TODO
     */
    function _repayOrDiscountPartial(
        uint256 changeAmount,
        uint256 trackedPartAmount,
        uint256 repaidOrDiscountPartAmount
    ) internal pure returns (
        uint256 newRepaymentAmount,
        uint256 newTrackedPartAmount,
        uint256 newRepaidOrDiscountPartAmount
    ) {
        // TODO: Review the rounding logic if a aloan part is being fully repaid
        uint256 roundedTrackedPartAmount = _roundMath(trackedPartAmount);
        if (roundedTrackedPartAmount <= changeAmount) {
            unchecked {
                changeAmount -= roundedTrackedPartAmount;
                repaidOrDiscountPartAmount += roundedTrackedPartAmount;
                trackedPartAmount = 0;
            }
        } else {
            unchecked {
                trackedPartAmount -= changeAmount;
                repaidOrDiscountPartAmount += changeAmount;
                changeAmount = 0;
            }
        }

        return (changeAmount, trackedPartAmount, repaidOrDiscountPartAmount);
    }

    /**
     * @dev TODO
     */
    function _accrueInterestRemuneratory(ProcessingSubLoan memory subLoan, uint256 dayCount) internal pure {
        uint256 oldTrackedBalance = subLoan.trackedPrincipal + subLoan.trackedInterestRemuneratory;
        uint256 newTrackedBalance = _calculateTrackedBalance(
            oldTrackedBalance,
            dayCount,
            subLoan.interestRateRemuneratory,
            INTEREST_RATE_FACTOR
        );
        subLoan.trackedInterestRemuneratory += newTrackedBalance - oldTrackedBalance;
    }

    /**
     * @dev TODO
     */
    function _accrueInterestMoratory(ProcessingSubLoan memory subLoan, uint256 dayCount) internal pure {
        subLoan.interestRateMoratory += _calculateSimpleInterest(
            subLoan.trackedPrincipal,
            dayCount,
            subLoan.interestRateMoratory
        );
    }

    /**
     * @dev TODO
     */
    function _imposeLateFee(ProcessingSubLoan memory subLoan) internal pure {
        // The equivalent formula: round(trackedPrincipal * lateFeeRate / INTEREST_RATE_FACTOR)
        // Where division operator `/` takes into account the fractional part and
        // the `round()` function returns an integer rounded according to standard mathematical rules.
        uint256 product = subLoan.trackedPrincipal * subLoan.lateFeeRate;
        uint256 remainder = product % INTEREST_RATE_FACTOR;
        uint256 result = product / INTEREST_RATE_FACTOR;
        if (remainder >= (INTEREST_RATE_FACTOR / 2)) {
            unchecked { ++result; }
        }
        subLoan.trackedLateFee = uint64(_roundMath(result)); // Safe cast due to prior checks
    }

    /**
     * @dev TODO
     */
    function _updateSubLoan(ProcessingSubLoan memory newSubLoan) internal {
        SubLoan storage oldSubLoan = _getSubLoanInStorage(newSubLoan.id);

        // TODO: add events if needed

        _acceptSubLoanStatusChange(newSubLoan, oldSubLoan);
        _acceptRepaymentChange(newSubLoan, oldSubLoan);
        _acceptDiscountChange(newSubLoan, oldSubLoan);
        _acceptSubLoanParametersChange(newSubLoan, oldSubLoan);

        // Update storage with the unchecked type conversion is used for all stored values due to prior checks
        // TODO: use flags in the sub-loan in-memory structure and optimize the saving
        oldSubLoan.status = SubLoanStatus(newSubLoan.status);
        oldSubLoan.revision = uint8(newSubLoan.revision);
        oldSubLoan.duration = uint16(newSubLoan.duration);
        oldSubLoan.interestRateRemuneratory = uint32(newSubLoan.interestRateRemuneratory);
        oldSubLoan.interestRateMoratory = uint32(newSubLoan.interestRateMoratory);
        oldSubLoan.lateFeeRate = uint32(newSubLoan.lateFeeRate);
        oldSubLoan.trackedPrincipal = uint64(newSubLoan.trackedPrincipal);
        oldSubLoan.trackedInterestRemuneratory = uint64(newSubLoan.trackedInterestRemuneratory);
        oldSubLoan.trackedInterestMoratory = uint64(newSubLoan.trackedInterestMoratory);
        oldSubLoan.trackedLateFee = uint64(newSubLoan.trackedLateFee);
        oldSubLoan.repaidPrincipal = uint64(newSubLoan.repaidPrincipal);
        oldSubLoan.repaidInterestRemuneratory = uint64(newSubLoan.repaidInterestRemuneratory);
        oldSubLoan.repaidInterestMoratory = uint64(newSubLoan.repaidInterestMoratory);
        oldSubLoan.repaidLateFee = uint64(newSubLoan.repaidLateFee);
        oldSubLoan.discountInterestRemuneratory = uint64(newSubLoan.discountInterestRemuneratory);
        oldSubLoan.discountInterestMoratory = uint64(newSubLoan.discountInterestMoratory);
        oldSubLoan.discountLateFee = uint64(newSubLoan.discountLateFee);
        oldSubLoan.trackedTimestamp = uint32(newSubLoan.trackedTimestamp);
        oldSubLoan.freezeTimestamp = uint32(newSubLoan.freezeTimestamp);
    }

    /**
     * @dev TODO
     */
    function _applyRepayment(
        ProcessingSubLoan memory subLoan,
        ProcessingOperation memory operation
    ) internal pure returns (uint256) {
        uint256 amount = operation.inputValue;
        uint256 initialAmount = amount;
        operation.oldSubLoanValue = _packRepaidParts(subLoan);

        if (amount != 0) {
            (amount, subLoan.trackedInterestMoratory, subLoan.repaidInterestMoratory) = _repayOrDiscountPartial(
                amount,
                subLoan.trackedInterestMoratory,
                subLoan.repaidInterestMoratory
            );
        }
        if (amount != 0) {
            (amount, subLoan.trackedLateFee, subLoan.repaidLateFee) = _repayOrDiscountPartial(
                amount,
                subLoan.trackedLateFee,
                subLoan.repaidLateFee
            );
        }
        if (amount != 0) {
            (amount, subLoan.trackedInterestRemuneratory, subLoan.repaidInterestRemuneratory) = _repayOrDiscountPartial(
                amount,
                subLoan.trackedInterestRemuneratory,
                subLoan.repaidInterestRemuneratory
            );
        }
        if (amount != 0) {
            (amount, subLoan.trackedPrincipal, subLoan.repaidPrincipal) = _repayOrDiscountPartial(
                amount,
                subLoan.trackedPrincipal,
                subLoan.repaidPrincipal
            );
        }

        // TODO: Consider replacement of repaymentAmount with repaymentLimit, then no special value is needed

        if (amount > 0 && initialAmount < type(uint64).max) {
            revert RepaymentExcess();
        }
        operation.newSubLoanValue = _packRepaidParts(subLoan);
        uint256 newTrackedBalance = _calculateTrackedBalance(subLoan);
        if (newTrackedBalance == 0 && subLoan.status == uint256(SubLoanStatus.Ongoing)) {
            subLoan.status = uint256(SubLoanStatus.FullyRepaid);
        }

        return initialAmount - amount;
    }

    /**
     * @dev TODO
     */
    function _applyDiscount(
        ProcessingSubLoan memory subLoan,
        ProcessingOperation memory operation
    ) internal pure returns (uint256) {
        uint256 amount = operation.inputValue;
        uint256 initialAmount = amount;
        operation.oldSubLoanValue = _packDiscountParts(subLoan);

        if (amount != 0) {
            (amount, subLoan.trackedInterestMoratory, subLoan.discountInterestMoratory) = _repayOrDiscountPartial(
                amount,
                subLoan.trackedInterestMoratory,
                subLoan.discountInterestMoratory
            );
        }
        if (amount != 0) {
            (amount, subLoan.trackedLateFee, subLoan.discountLateFee) = _repayOrDiscountPartial(
                amount,
                subLoan.trackedLateFee,
                subLoan.discountLateFee
            );
        }
        if (amount != 0) {
            (amount, subLoan.trackedInterestRemuneratory, subLoan.discountInterestRemuneratory) =
            _repayOrDiscountPartial(
                amount,
                subLoan.trackedInterestRemuneratory,
                subLoan.discountInterestRemuneratory
            );
        }
        if (amount != 0) {
            (amount, subLoan.trackedPrincipal, subLoan.discountPrincipal) = _repayOrDiscountPartial(
                amount,
                subLoan.trackedPrincipal,
                subLoan.discountPrincipal
            );
        }

        // TODO: Consider replacement of discountAmount with discountLimit, then no special value is needed

        if (amount > 0 && initialAmount < type(uint64).max) {
            revert DiscountExcess();
        }
        operation.newSubLoanValue = _packDiscountParts(subLoan);
        uint256 newTrackedBalance = _calculateTrackedBalance(subLoan);
        if (newTrackedBalance == 0 && subLoan.status == uint256(SubLoanStatus.Ongoing)) {
            subLoan.status = uint256(SubLoanStatus.FullyRepaid);
        }

        return initialAmount - amount;
    }

    /**
     * @dev TODO
     */
    function _applyRevocation(
        ProcessingSubLoan memory subLoan,
        ProcessingOperation memory operation
    ) internal pure {
        operation.oldSubLoanValue = _packTrackedParts(subLoan);
        operation.newSubLoanValue = 0;
        subLoan.status = uint256(SubLoanStatus.Revoked);
    }

    /**
     * @dev TODO
     */
    function _applySetDuration(
        ProcessingSubLoan memory subLoan,
        ProcessingOperation memory operation
    ) internal pure {
        operation.oldSubLoanValue = subLoan.duration;
        subLoan.duration = operation.inputValue;
        operation.newSubLoanValue = subLoan.duration;
    }

    /**
     * @dev TODO
     */
    function _applySetInterestRateRemuneratory(
        ProcessingSubLoan memory subLoan,
        ProcessingOperation memory operation
    ) internal pure {
        operation.oldSubLoanValue = subLoan.interestRateRemuneratory;
        subLoan.interestRateRemuneratory = operation.inputValue;
        operation.newSubLoanValue = subLoan.interestRateRemuneratory;
    }

    /**
     * @dev TODO
     */
    function _applySetInterestRateMoratory(
        ProcessingSubLoan memory subLoan,
        ProcessingOperation memory operation
    ) internal pure {
        operation.oldSubLoanValue = subLoan.interestRateMoratory;
        subLoan.interestRateMoratory = operation.inputValue;
        operation.newSubLoanValue = subLoan.interestRateMoratory;
    }

    /**
     * @dev TODO
     */
    function _applySetLateFeeRate(
        ProcessingSubLoan memory subLoan,
        ProcessingOperation memory operation
    ) internal pure {
        operation.oldSubLoanValue = subLoan.lateFeeRate;
        subLoan.lateFeeRate = operation.inputValue;
        operation.newSubLoanValue = subLoan.lateFeeRate;
    }

    /**
     * @dev TODO
     */
    function _applyFreezing(
        ProcessingSubLoan memory subLoan,
        ProcessingOperation memory operation
    ) internal pure {
        // TODO: Simplify
        operation.oldSubLoanValue = subLoan.freezeTimestamp;
        subLoan.freezeTimestamp = operation.timestamp;
        operation.newSubLoanValue = subLoan.freezeTimestamp;
    }

    /**
     * @dev TODO
     */
    function _applyUnfreezing(
        ProcessingSubLoan memory subLoan,
        ProcessingOperation memory operation
    ) internal pure {
        operation.oldSubLoanValue = subLoan.freezeTimestamp;
        subLoan.freezeTimestamp = 0;
        operation.newSubLoanValue = subLoan.freezeTimestamp;
        // TODO: implement more actions and simplify
    }

    /**
     * @dev TODO
     */
    function _acceptOperationApplying(
        ProcessingSubLoan memory subLoan,
        ProcessingOperation memory operation
    ) internal {
        uint256 operationId = operation.id;
        uint256 subLoanId = subLoan.id;
        Operation storage operationInStorage = _getOperationInStorage(subLoanId, operationId);
        operationInStorage.status = OperationStatus.Applied;

        emit OperationApplied(
            subLoanId,
            operationId,
            OperationKind(operation.kind),
            operation.timestamp,
            operation.inputValue,
            operation.account
        );
    }

    /**
     * @dev TODO
     */
    function _acceptRepaymentChange(
        ProcessingSubLoan memory newSubLoan,
        SubLoan storage oldSubLoan
    ) internal {
        address counterparty = newSubLoan.counterparty;
        if (counterparty == address(0)) {
            return;
        }
        uint256 oldRepaidSumAmount = _calculateRepaidAmountInStorage(oldSubLoan);
        uint256 newRepaidSumAmount = _calculateRepaidAmount(newSubLoan);
        if (newRepaidSumAmount != oldRepaidSumAmount) {
            if (newRepaidSumAmount > oldRepaidSumAmount) {
                uint256 repaymentChange = newRepaidSumAmount - oldRepaidSumAmount;
                _transferFromPool(newSubLoan.programId, counterparty, repaymentChange);
            } else {
                uint256 repaymentChange = oldRepaidSumAmount - newRepaidSumAmount;
                _transferToPool(newSubLoan.programId, counterparty, repaymentChange);
            }
        }
    }

    /**
     * @dev TODO
     */
    function _acceptDiscountChange(
        ProcessingSubLoan memory newSubLoan,
        SubLoan storage oldSubLoan
    ) internal pure {
        newSubLoan; // Prevent unused variable warning
        oldSubLoan; // Prevent unused variable warning
        // do nothing;
        // TODO: remove this function
    }

    /**
     * @dev TODO
     */
    function _acceptSubLoanParametersChange(
        ProcessingSubLoan memory newSubLoan,
        SubLoan storage oldSubLoan
    ) internal pure {
        newSubLoan; // Prevent unused variable warning
        oldSubLoan; // Prevent unused variable warning
        // do nothing;
        // TODO: remove this function
    }

    /**
     * @dev TODO
     */
    function _acceptSubLoanStatusChange(
        ProcessingSubLoan memory newSubLoan,
        SubLoan storage oldSubLoan
    ) internal {
        uint256 newStatus = newSubLoan.status;
        if (newStatus == uint256(oldSubLoan.status)) {
            return;
        }
        (address creditLine,) = _getCreditLineAndLiquidityPool(newSubLoan.programId);
        if (
            newStatus == uint256(SubLoanStatus.Revoked) ||
            newStatus == uint256(SubLoanStatus.FullyRepaid)
        ) {
            ICreditLineV2(creditLine).onAfterLoanClosed(newSubLoan.borrower, oldSubLoan.borrowedAmount);
        }
        if (newStatus == uint256(SubLoanStatus.Ongoing)) {
            ICreditLineV2(creditLine).onBeforeLoanOpened(newSubLoan.borrower, oldSubLoan.borrowedAmount);
        }
    }

    /**
     * @dev Calculates the tracked balance of a loan using the compound interest formula.
     * @param originalBalance The original balance of the loan.
     * @param numberOfPeriods The number of periods since the loan was taken.
     * @param interestRate The interest rate applied to the loan.
     * @param interestRateFactor The interest rate factor.
     * @return trackedBalance The tracked balance of the loan.
     */
    function _calculateTrackedBalance(
        uint256 originalBalance,
        uint256 numberOfPeriods,
        uint256 interestRate,
        uint256 interestRateFactor
    ) internal pure returns (uint256 trackedBalance) {
        // The equivalent formula: round(originalBalance * (1 + interestRate / interestRateFactor)^numberOfPeriods)
        // Where division operator `/` and power operator `^` take into account the fractional part and
        // the `round()` function returns an integer rounded according to standard mathematical rules.
        int128 onePlusRateValue = ABDKMath64x64.div(
            ABDKMath64x64.fromUInt(interestRateFactor + interestRate),
            ABDKMath64x64.fromUInt(interestRateFactor)
        );
        int128 powValue = ABDKMath64x64.pow(onePlusRateValue, numberOfPeriods);
        int128 originalBalanceValue = ABDKMath64x64.fromUInt(originalBalance);
        uint256 unroundedResult = uint256(uint128(ABDKMath64x64.mul(powValue, originalBalanceValue)));
        trackedBalance = unroundedResult >> 64;
        if ((unroundedResult - (trackedBalance << 64)) >= (1 << 63)) {
            trackedBalance += 1;
        }
    }

    /**
     * @dev TODO
     */
    function _calculateSimpleInterest(
        uint256 principal,
        uint256 dayCount,
        uint256 interestRate
    ) internal pure returns (uint256) {
        return (principal * dayCount * interestRate) / INTEREST_RATE_FACTOR;
    }

    /**
     * @dev TODO
     */
    function _calculateTrackedBalance(ProcessingSubLoan memory subLoan) internal pure returns (uint256) {
        return
            subLoan.trackedPrincipal +
            subLoan.trackedInterestRemuneratory +
            subLoan.trackedInterestMoratory +
            subLoan.trackedLateFee;
    }

    /**
     * @dev TODO
     */
    function _calculateOutstandingBalance(ProcessingSubLoan memory subLoan) internal pure returns (uint256) {
        return
            _roundMath(subLoan.trackedPrincipal) +
            _roundMath(subLoan.trackedInterestRemuneratory) +
            _roundMath(subLoan.trackedInterestMoratory) +
            _roundMath(subLoan.trackedLateFee);
    }

    /**
     * @dev TODO
     */
    function _calculateRepaidAmount(ProcessingSubLoan memory subLoan) internal pure returns (uint256) {
        return
            subLoan.repaidPrincipal +
            subLoan.repaidInterestRemuneratory +
            subLoan.repaidInterestMoratory +
            subLoan.repaidLateFee;
    }

    /**
     * @dev TODO
     */
    function _calculateRepaidAmountInStorage(SubLoan storage subLoan) internal view returns (uint256) {
        return
            subLoan.repaidPrincipal +
            subLoan.repaidInterestRemuneratory +
            subLoan.repaidInterestMoratory +
            subLoan.repaidLateFee;
    }

    /**
     * @dev TODO
     */
    function _calculateSumAmountByParts(uint256 packedParts) internal pure returns (uint256) {
        unchecked {
            return
                ((packedParts) & type(uint64).max) + // Tools: prevent Prettier one-liner
                ((packedParts >> 64) & type(uint64).max) +
                ((packedParts >> 128) & type(uint64).max) +
                ((packedParts >> 192) & type(uint64).max);
        }
    }

    /**
     * @dev TODO
     */
    function _calculateDiscountAmount(ProcessingSubLoan memory subLoan) internal pure returns (uint256) {
        return
            subLoan.discountInterestRemuneratory + // Tools: prevent Prettier one-liner
            subLoan.discountInterestMoratory +
            subLoan.discountLateFee;
    }

    /**
     * @dev TODO
     */
    function _calculateDiscountAmountInStorage(SubLoan storage subLoan) internal view returns (uint256) {
        return
            subLoan.discountInterestRemuneratory + // Tools: prevent Prettier one-liner
            subLoan.discountInterestMoratory +
            subLoan.discountLateFee;
    }

    /**
     * @dev TODO
     */
    function _calculateLateFeeAmount(ProcessingSubLoan memory subLoan) internal pure returns (uint256) {
        return
            subLoan.trackedLateFee + // Tools: prevent Prettier one-liner
            subLoan.repaidLateFee +
            subLoan.discountLateFee;
    }

    /**
     * @dev TODO
     */
    function _calculateTotalAmounts(
        SubLoanTakingRequest[] calldata subLoanTakingRequests
    ) internal pure returns (uint256 borrowedAmount, uint256 addonAmount) {
        uint256 len = subLoanTakingRequests.length;
        for (uint256 i = 0; i < len; ++i) {
            SubLoanTakingRequest calldata subLoanTakingRequest = subLoanTakingRequests[i];
            borrowedAmount += subLoanTakingRequest.borrowedAmount;
            addonAmount += subLoanTakingRequest.addonAmount;
        }
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
        uint256 programId,
        uint256 borrowedAmount,
        uint256 addonAmount
    ) internal view {
        // TODO: Try to optimize this function by reusing other function

        if (programId == 0) {
            revert ProgramNonexistent();
        }
        if (borrower == address(0)) {
            revert BorrowerAddressZero();
        }
        if (
            borrowedAmount == 0 ||
            borrowedAmount > type(uint64).max ||
            borrowedAmount != _roundMath(borrowedAmount)
        ) {
            revert BorrowedAmountInvalidAmount();
        }
        if (
            addonAmount > type(uint64).max ||
            addonAmount != _roundMath(addonAmount)
        ) {
            revert AddonAmountInvalid();
        }
        unchecked {
            if (addonAmount + borrowedAmount > type(uint64).max) {
                revert PrincipalAmountInvalid();
            }
        }

        (address creditLine, address liquidityPool) = _getCreditLineAndLiquidityPool(programId);
        if (creditLine == address(0)) {
            revert ProgramCreditLineNotConfigured();
        }
        if (liquidityPool == address(0)) {
            revert ProgramLiquidityPoolNotConfigured();
        }
    }

    /**
     * @dev TODO
     */
    function _checkSubLoanParameters(SubLoanTakingRequest[] calldata subLoanTakingRequests) internal pure {
        uint256 len = subLoanTakingRequests.length;
        uint256 previousDuration = subLoanTakingRequests[0].duration;
        for (uint256 i = 1; i < len; ++i) {
            SubLoanTakingRequest calldata subLoanTakingRequest = subLoanTakingRequests[i];
            if (subLoanTakingRequest.borrowedAmount == 0) {
                revert SubLoanBorrowedAmountInvalid();
            }
            uint256 duration = subLoanTakingRequest.duration;
            if (duration < previousDuration) {
                revert SubLoanDurationsInvalid();
            }
            if (duration > type(uint16).max) {
                revert SubLoanDurationExcess();
            }
            previousDuration = duration;
        }
    }

    /**
     * @dev TODO
     */
    function _checkSubLoanRates(
        uint256 interestRateRemuneratory,
        uint256 interestRateMoratory,
        uint256 lateFeeRate
    ) internal pure {
        if (
            interestRateRemuneratory > type(uint32).max ||
            interestRateMoratory > type(uint32).max ||
            lateFeeRate > type(uint32).max
        ) {
            revert RateValueInvalid();
        }
    }

    /// TODO
    function _checkOperationParameters(
        uint256 kind,
        uint256 timestamp,
        uint256 inputValue,
        address account
    ) internal view {
        if (
            kind == uint256(OperationKind.Nonexistent) || // Tools: prevent Prettier one-liner
            kind >= uint256(type(OperationKind).max)
        ) {
            revert OperationKindInvalid();
        }

        if (kind == uint256(OperationKind.Revocation)) {
            revert OperationKindUnacceptable();
        }

        if (kind == uint256(OperationKind.Freezing)) {
            if (inputValue != 0) {
                revert OperationInputValueInvalid();
            }
        }

        if (kind == uint256(OperationKind.Unfreezing)) {
            if (inputValue > 1) {
                revert OperationInputValueInvalid();
            }
        }

        if (
            kind == uint256(OperationKind.SetInterestRateRemuneratory) ||
            kind == uint256(OperationKind.SetInterestRateMoratory) ||
            kind == uint256(OperationKind.SetLateFeeRate)
        ) {
            if (inputValue > type(uint32).max) {
                revert RateValueInvalid();
            }
        }

        if (kind == uint256(OperationKind.SetDuration)) {
            if (inputValue == 0 || inputValue > type(uint16).max) {
                revert DurationInvalid();
            }
        }

        if (kind == uint256(OperationKind.Repayment)) {
            if (account == address(0)) {
                revert RapayerAddressZero();
            }
        } else if (account != address(0)) {
            revert OperationAccountNotZero();
        }

        if (
            kind == uint256(OperationKind.Repayment) || // Tools: prevent Prettier one-liner
            kind == uint256(OperationKind.Discounting)
        ) {
            if (timestamp > _blockTimestamp()) {
                revert OperationRepaymentOrDiscountProhibitedInFuture();
            }
        }
    }

    /**
     * @dev Checks if the credit line and liquidity pool are valid.
     * @param creditLine The address of the credit line.
     * @param liquidityPool The address of the liquidity pool.
     */
    function _checkCreditLineAndLiquidityPool(address creditLine, address liquidityPool) internal view {
        if (creditLine == address(0)) {
            revert CreditLineAddressZero();
        }
        if (creditLine.code.length == 0) {
            revert CreditLineAddressInvalid();
        }
        try ICreditLineV2(creditLine).proveCreditLine() {} catch {
            revert CreditLineAddressInvalid();
        }

        if (liquidityPool == address(0)) {
            revert LiquidityPoolAddressZero();
        }
        if (liquidityPool.code.length == 0) {
            revert LiquidityPoolAddressInvalid();
        }
        try ILiquidityPool(liquidityPool).proveLiquidityPool() {} catch {
            revert LiquidityPoolAddressInvalid();
        }
    }

    /**
     * @dev Ensures the sub-loan count is within the valid range.
     * @param subLoanCount The number of sub-loans to check.
     */
    function _checkSubLoanCount(uint256 subLoanCount) internal view {
        if (subLoanCount == 0) {
            revert SubLoanCountZero();
        }
        if (subLoanCount > _subLoanCountMax()) {
            revert SubLoanCountExcess();
        }
    }

    /**
     * @dev TODO
     */
    function _checkOperationId(uint256 id) internal pure {
        if (id > type(uint16).max) {
            revert OperationIdExcess();
        }
    }

    /**
     * @dev TODO
     */
    function _convertSubLoan(
        uint256 subLoanId,
        SubLoan storage subLoanStored
    ) internal view returns (ProcessingSubLoan memory) {
        ProcessingSubLoan memory subLoan;
        subLoan.id = subLoanId;
        subLoan.status = uint256(subLoanStored.status);
        subLoan.programId = subLoanStored.programId;
        subLoan.borrower = subLoanStored.borrower;
        // subLoan.flags = 0;
        subLoan.startTimestamp = subLoanStored.startTimestamp;
        subLoan.duration = subLoanStored.duration;
        subLoan.interestRateRemuneratory = subLoanStored.interestRateRemuneratory;
        subLoan.interestRateMoratory = subLoanStored.interestRateMoratory;
        subLoan.lateFeeRate = subLoanStored.lateFeeRate;
        subLoan.trackedPrincipal = subLoanStored.trackedPrincipal;
        subLoan.trackedInterestRemuneratory = subLoanStored.trackedInterestRemuneratory;
        subLoan.trackedInterestMoratory = subLoanStored.trackedInterestMoratory;
        subLoan.trackedLateFee = subLoanStored.trackedLateFee;
        subLoan.repaidPrincipal = subLoanStored.repaidPrincipal;
        subLoan.repaidInterestRemuneratory = subLoanStored.repaidInterestRemuneratory;
        subLoan.repaidInterestMoratory = subLoanStored.repaidInterestMoratory;
        subLoan.repaidLateFee = subLoanStored.repaidLateFee;
        subLoan.discountInterestRemuneratory = subLoanStored.discountInterestRemuneratory;
        subLoan.discountInterestMoratory = subLoanStored.discountInterestMoratory;
        subLoan.discountLateFee = subLoanStored.discountLateFee;
        subLoan.trackedTimestamp = subLoanStored.trackedTimestamp;
        subLoan.freezeTimestamp = subLoanStored.freezeTimestamp;
        // subLoan.counterparty = 0;
        return subLoan;
    }

    /**
     * @dev TODO
     */
    function _convertOperation(
        uint256 operationId,
        Operation storage operationInStorage
    ) internal view returns (ProcessingOperation memory) {
        ProcessingOperation memory operation;
        operation.id = operationId;
        operation.initialStatus = uint256(operationInStorage.status);
        operation.status = operation.initialStatus;
        operation.kind = uint256(operationInStorage.kind);
        operation.timestamp = operationInStorage.timestamp;
        operation.inputValue = operationInStorage.inputValue;
        operation.account = operationInStorage.account;
        // operation.oldValue = 0 // This will be set during the operation application
        // operation.newValue = 0; // This will be set during the operation application
        return operation;
    }

    /**
     * @dev TODO
     */
    function _increaseProgramId() internal returns (uint256) {
        LendingMarketStorageV2 storage $ = _getLendingMarketStorage();
        uint256 programId = uint256($.programIdCounter);
        unchecked {
            programId += 1;
        }
        if (programId > type(uint24).max) {
            revert ProgramIdExcess();
        }
        $.programIdCounter = uint24(programId);
        return programId;
    }

    /**
     * @dev TODO
     */
    function _increaseSubLoanId() internal returns (uint256) {
        LendingMarketStorageV2 storage $ = _getLendingMarketStorage();
        uint256 id = uint256($.subLoanIdCounter);
        unchecked {
            id += 1;
        }
        if (id > type(uint40).max) {
            revert SubLoanIdExcess();
        }
        $.subLoanIdCounter = uint40(id);
        return id;
    }

    /**
     * @dev TODO
     */
    function _convertOperationToView(
        uint256 operationId,
        Operation storage operationInStorage
    ) internal view returns (OperationView memory) {
        OperationView memory operation;
        operation.id = operationId;
        operation.status = operation.status;
        operation.kind = uint256(operationInStorage.kind);
        operation.timestamp = operationInStorage.timestamp;
        operation.inputValue = operationInStorage.inputValue;
        operation.account = operationInStorage.account;
        return operation;
    }

    /**
     * @dev TODO
     */
    function _emitTrackedBalanceUpdate(ProcessingSubLoan memory subLoan) internal {
        emit SubLoanTrackedBalanceUpdated(
            subLoan.id,
            subLoan.revision,
            subLoan.trackedTimestamp,
            bytes32(_packTrackedParts(subLoan))
        );
    }

    /**
     * @dev TODO
     */
    function _increaseRevision(SubLoan storage subLoan) internal returns (uint256) {
        if (subLoan.revision == type(uint8).max) {
            revert SubLoanRevisionExcess();
        }
        unchecked {
            uint256 newRevision = subLoan.revision + 1;
            subLoan.revision = uint8(newRevision);
            return newRevision;
        }
    }

    /**
     * @dev TODO
     */
    function _getSubLoanInStorage(uint256 subLoanId) internal view returns (SubLoan storage) {
        return _getLendingMarketStorage().subLoans[subLoanId];
    }

    /**
     * @dev TODO
     */
    function _getExitingSubLoanInStorage(uint256 subLoanId) internal view returns (SubLoan storage) {
        SubLoan storage subLoan = _getSubLoanInStorage(subLoanId);
        if (subLoan.status == SubLoanStatus.Nonexistent) {
            revert SubLoanNonexistent();
        }
        return subLoan;
    }

    function _getNonRevokedSubLoanInStorage(uint256 subLoanId) internal view returns (SubLoan storage) {
        SubLoan storage subLoan = _getExitingSubLoanInStorage(subLoanId);
        if (subLoan.status == SubLoanStatus.Revoked) {
            revert SubLoanStatusRevoked();
        }
        return subLoan;
    }

    /**
     * @dev TODO
     */
    function _getSubLoan(uint256 subLoanId) internal view returns (ProcessingSubLoan memory) {
        return _convertSubLoan(subLoanId, _getSubLoanInStorage(subLoanId));
    }

    /**
     * @dev TODO
     */
    function _getNonRevokedSubLoan(uint256 subLoanId) internal view returns (ProcessingSubLoan memory) {
        return _convertSubLoan(subLoanId, _getNonRevokedSubLoanInStorage(subLoanId));
    }

    /**
     * @dev TODO
     */
    function _getOperationInStorage(
        uint256 subLoanId,
        uint256 operationId
    ) internal view returns (Operation storage) {
        return _getLendingMarketStorage().subLoanOperations[subLoanId][operationId];
    }

    /**
     * @dev TODO
     */
    function _getExistingOperationInStorage(
        uint256 subLoanId,
        uint256 operationId
    ) internal view returns (Operation storage) {
        Operation storage operation = _getOperationInStorage(subLoanId, operationId);
        if (operation.status == OperationStatus.Nonexistent) {
            revert OperationNonexistent();
        }
        return operation;
    }

    /**
     * @dev TODO
     */
    function _getExistingOperation(
        uint256 subLoanId,
        uint256 operationId
    ) internal view returns (ProcessingOperation memory) {
        return _convertOperation(
            operationId,
            _getExistingOperationInStorage(subLoanId, operationId)
        );
    }

    /**
     * @dev TODO
     */
    function _getOperationView(
        uint256 subLoanId,
        uint256 operationId
    ) internal view returns (OperationView memory) {
        return _convertOperationToView(
            operationId,
            _getOperationInStorage(subLoanId, operationId)
        );
    }

    /**
     * @dev TODO
     */
    function _getCreditLineAndLiquidityPool(uint256 programId) internal view returns (address, address) {
        LendingMarketStorageV2 storage storageStruct = _getLendingMarketStorage();
        address creditLine = storageStruct.programCreditLines[programId];
        address liquidityPool = storageStruct.programLiquidityPools[programId];
        return (creditLine, liquidityPool);
    }

    /**
     * @dev TODO
     */
    function _getTokenAndLiquidityPool(uint256 programId) internal view returns (address, address) {
        LendingMarketStorageV2 storage $ = _getLendingMarketStorage();
        address token = $.token;
        address liquidityPool = $.programLiquidityPools[programId];
        return (token, liquidityPool);
    }

    /**
     * @dev TODO
     */
    function _getAndCheckAddonTreasury(uint256 programId) internal view returns (address) {
        address liquidityPool = _getLendingMarketStorage().programLiquidityPools[programId];
        address addonTreasury = ILiquidityPool(liquidityPool).addonTreasury();
        if (addonTreasury == address(0)) {
            revert AddonTreasuryAddressZero();
        }
        return addonTreasury;
    }

    /**
     * @dev TODO
     */
    function _getSubLoanWithAccruedInterest(
        uint256 subLoanId,
        uint256 timestamp
    ) internal view returns (ProcessingSubLoan memory) {
        ProcessingSubLoan memory subLoan = _getSubLoan(subLoanId);

        if (subLoan.status != uint256(SubLoanStatus.Nonexistent)) {
            _accrueInterest(subLoan, timestamp);
        }

        return subLoan;
    }

    /**
     * @dev Calculates the sub-loan preview.
     * @param subLoan TODO
     * @return The sub-loan preview.
     */
    function _getSubLoanPreview(
        ProcessingSubLoan memory subLoan
    ) internal view returns (SubLoanPreview memory) {
        SubLoanPreview memory preview;
        SubLoan storage subLoanStored = _getSubLoanInStorage(subLoan.id);

        preview.day = _dayIndex(subLoan.trackedTimestamp);
        preview.borrower = subLoan.borrower;
        preview.programId = subLoan.programId;
        preview.borrowedAmount = subLoanStored.borrowedAmount;
        preview.addonAmount = subLoanStored.addonAmount;
        preview.startTimestamp = subLoan.startTimestamp;
        preview.trackedTimestamp = subLoan.trackedTimestamp;
        preview.freezeTimestamp = subLoan.freezeTimestamp;
        preview.duration = subLoan.duration;
        preview.interestRateRemuneratory = subLoan.interestRateRemuneratory;
        preview.interestRateMoratory = subLoan.interestRateMoratory;
        preview.lateFeeRate = subLoan.lateFeeRate;
        preview.firstInstallmentId = subLoanStored.firstSubLoanId;
        preview.subLoanCount = subLoanStored.subLoanCount;
        preview.trackedPrincipal = subLoan.trackedPrincipal;
        preview.trackedInterestRemuneratory = subLoan.trackedInterestRemuneratory;
        preview.trackedInterestMoratory = subLoan.trackedInterestMoratory;
        preview.trackedLateFee = subLoan.trackedLateFee;
        preview.outstandingBalance = _calculateOutstandingBalance(subLoan);
        preview.repaidPrincipal = subLoan.repaidPrincipal;
        preview.repaidInterestRemuneratory = subLoan.repaidInterestRemuneratory;
        preview.repaidInterestMoratory = subLoan.repaidInterestMoratory;
        preview.repaidLateFee = subLoan.repaidLateFee;
        preview.discountInterestRemuneratory = subLoan.discountInterestRemuneratory;
        preview.discountInterestMoratory = subLoan.discountInterestMoratory;
        preview.discountLateFee = subLoan.discountLateFee;
        return preview;
    }

    /**
     * @dev Calculates the preview of a loan.
     * @param subLoanId The ID of any sub-loan of the loan.
     * @param timestamp The timestamp to calculate the preview at.
     * @return The loan preview.
     */
    function _getLoanPreview(uint256 subLoanId, uint256 timestamp) internal view returns (LoanPreview memory) {
        LoanPreview memory preview;

        if (timestamp == 0) {
            timestamp = _blockTimestamp();
        }

        SubLoan storage subLoanInStorage = _getSubLoanInStorage(subLoanId);
        uint256 subLoanCount = subLoanInStorage.subLoanCount;
        subLoanId = subLoanInStorage.firstSubLoanId;

        preview.subLoanPreviews = new SubLoanPreview[](subLoanCount);
        preview.firstSubLoanId = subLoanId;
        preview.subLoanCount = subLoanCount;

        SubLoanPreview memory singleLoanPreview;
        for (uint256 i = 0; i < subLoanCount; ++i) {
            ProcessingSubLoan memory subLoan = _getSubLoanWithAccruedInterest(subLoanId, timestamp);
            singleLoanPreview = _getSubLoanPreview(subLoan);
            preview.totalTrackedBalance += _calculateTrackedBalance(subLoan);
            preview.totalOutstandingBalance += singleLoanPreview.outstandingBalance;
            preview.totalBorrowedAmount += singleLoanPreview.borrowedAmount;
            preview.totalAddonAmount += singleLoanPreview.addonAmount;
            preview.totalRepaidAmount += _calculateRepaidAmount(subLoan);
            preview.totalLateFeeAmount += _calculateLateFeeAmount(subLoan);
            preview.totalDiscountAmount += _calculateDiscountAmount(subLoan);
            preview.subLoanPreviews[i] = singleLoanPreview;
            unchecked {
                ++subLoanId;
            }
        }
        preview.day = singleLoanPreview.day;

        return preview;
    }

    /**
     * @dev TODO
     */
    function _includeAffectedSubLoan(
        OperationAffectedSubLoan[] memory affectedSubLoans,
        uint256 affectedSubLoanCount,
        uint256 subLoanId,
        uint256 timestamp,
        address counterparty
    ) internal pure returns (uint256 newAffectedSubLoanCount) {
        for (uint256 i = 0; i < affectedSubLoanCount; ++i) {
            OperationAffectedSubLoan memory affectedSubLoan = affectedSubLoans[i];
            if (affectedSubLoan.subLoanId == subLoanId) {
                // An existing affected sub-loan found, check and update its data
                if (timestamp > affectedSubLoan.minOperationTimestamp) {
                    affectedSubLoan.minOperationTimestamp = timestamp;
                }
                if (affectedSubLoan.counterparty != counterparty) {
                    revert OperationRequestArrayCounterpartyDifference();
                }
                return affectedSubLoanCount; // The same count as before
            }
        }

        // No existing affected sub-loan found, add a new one
        {
            OperationAffectedSubLoan memory affectedSubLoan = affectedSubLoans[affectedSubLoanCount];
            ++affectedSubLoanCount;
            affectedSubLoan.subLoanId = subLoanId;
            affectedSubLoan.counterparty = counterparty;
            affectedSubLoan.minOperationTimestamp = timestamp;
        }
        return affectedSubLoanCount;
    }

    /**
     * @dev TODO
     */
    function _processAffectedSubLoans(
        OperationAffectedSubLoan[] memory affectedSubLoans,
        uint256 affectedSubLoanCount
    ) internal {
        for (uint256 i = 0; i < affectedSubLoanCount; ++i) {
            OperationAffectedSubLoan memory affectedSubLoan = affectedSubLoans[i];
            _treatOperations(
                affectedSubLoan.subLoanId,
                affectedSubLoan.minOperationTimestamp,
                affectedSubLoan.counterparty
            );
        }
    }

    /**
     * @dev TODO
     *
     * The packed amount parts of a sub-loan is a bitfield with the following bits:
     *
     * - 64 bits from 0 to 63: the principal.
     * - 64 bits from 64 to 127: the remuneratory interest.
     * - 64 bits from 128 to 191: the moratory interest.
     * - 64 bits from 192 to 255: the late fee.
     */
    function _packAmountParts(
        uint256 part1,
        uint256 part2,
        uint256 part3,
        uint256 part4
    ) internal pure returns (uint256) {
        return
            (part1 & type(uint64).max) |
            ((part2 & type(uint64).max) << 64) |
            ((part3 & type(uint64).max) << 128) |
            ((part4 & type(uint64).max) << 192);
    }

    /**
     * @dev TODO
     */
    function _packRepaidParts(ProcessingSubLoan memory subLoan) internal pure returns (uint256) {
        return
            _packAmountParts(
            subLoan.repaidPrincipal,
            subLoan.repaidInterestRemuneratory,
            subLoan.repaidInterestMoratory,
            subLoan.repaidLateFee
        );
    }

    /**
     * @dev TODO
     */
    function _packDiscountParts(ProcessingSubLoan memory subLoan) internal pure returns (uint256) {
        return
            _packAmountParts(
            subLoan.discountPrincipal,
            subLoan.discountInterestRemuneratory,
            subLoan.discountInterestMoratory,
            subLoan.discountLateFee
        );
    }

    /**
     * @dev TODO
     */
    function _packTrackedParts(ProcessingSubLoan memory subLoan) internal pure returns (uint256) {
        return
            _packAmountParts(
            subLoan.trackedPrincipal,
            subLoan.trackedInterestRemuneratory,
            subLoan.trackedInterestMoratory,
            subLoan.trackedLateFee
        );
    }

    /**
     * @dev TODO
     *
     * The packed rates is a bitfield with the following bits:
     *
     * - 64 bits from 0 to 63: the remuneratory interest rate.
     * - 64 bits from 64 to 127: the moratory interest rate.
     * - 64 bits from 128 to 191: the late fee rate.
     */
    function _packRates(
        uint256 interestRateRemuneratory,
        uint256 interestRateMoratory,
        uint256 lateFeeRate
    ) internal pure returns (uint256) {
        return
            (interestRateRemuneratory & type(uint64).max) |
            ((interestRateMoratory & type(uint64).max) << 64) |
            ((lateFeeRate & type(uint64).max) << 128);
    }

    /**
     * @dev TODO
     */
    function _unpackRates(uint256 packedRates) internal pure returns (
        uint256 interestRateRemuneratory,  // Tools: prevent Prettier one-liner
        uint256 interestRateMoratory,
        uint256 lateFeeRate
    ) {
        interestRateRemuneratory = packedRates & type(uint64).max;
        interestRateMoratory = (packedRates >> 64) & type(uint64).max;
        lateFeeRate = (packedRates >> 128) & type(uint64).max;
    }

    /// @dev Calculates the day index that corresponds the specified timestamp.
    function _dayIndex(uint256 timestamp) internal pure returns (uint256) {
        return (timestamp + NEGATIVE_DAY_BOUNDARY_OFFSET) / 1 days;
    }

    /// @dev Returns the current block timestamp with the time offset applied.
    function _blockTimestamp() internal view virtual returns (uint256) {
        uint256 blockTimestamp = block.timestamp;
        if (blockTimestamp > type(uint32).max) {
            revert BlockTimestampExcess();
        }
        return blockTimestamp;
    }

    /// @dev Returns the maximum number of sub-loans for a loan. Can be overridden for testing purposes.
    function _subLoanCountMax() internal view virtual returns (uint256) {
        return INSTALLMENT_COUNT_MAX;
    }

    /**
     * @dev Rounds a value to the nearest multiple of an accuracy according to mathematical rules.
     * @param value The value to be rounded.
     * @param accuracy The accuracy to which the value should be rounded.
     */
    function _roundMath(uint256 value, uint256 accuracy) internal pure returns (uint256) {
        return ((value + accuracy / 2) / accuracy) * accuracy;
    }

    /// TODO
    function _roundMath(uint256 value) internal pure returns (uint256) {
        return _roundMath(value, ACCURACY_FACTOR);
    }
}
