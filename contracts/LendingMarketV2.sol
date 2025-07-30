// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import { AccessControlExtUpgradeable } from "./base/AccessControlExtUpgradeable.sol";
import { PausableExtUpgradeable } from "./base/PausableExtUpgradeable.sol";
import { UUPSExtUpgradeable } from "./base/UUPSExtUpgradeable.sol";
import { Versionable } from "./base/Versionable.sol";

import { LoanV2 } from "./libraries/LoanV2.sol";
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

    /// @inheritdoc ILendingMarketConfigurationV2
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

    /// @inheritdoc ILendingMarketConfigurationV2
    function updateProgram(
        uint32 programId, // Tools: this comment prevents Prettier from formatting into a single line.
        address creditLine,
        address liquidityPool
    ) external whenNotPaused onlyRole(OWNER_ROLE) {
        if (programId == 0) {
            revert ProgramNonexistent();
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

    /// @inheritdoc ILendingMarketPrimaryV2
    // TODO: Remove `For` in the name, consider the same for other fucntions
    function takeLoan(
        address borrower,
        uint32 programId,
        uint256[] calldata borrowedAmounts,
        uint256[] calldata addonAmounts,
        uint256[] calldata durations
    ) external whenNotPaused onlyRole(ADMIN_ROLE) returns (uint256 firstSubLoanId, uint256 subLoanCount) {
        uint256 totalBorrowedAmount = _sumArray(borrowedAmounts);
        uint256 totalAddonAmount = _sumArray(addonAmounts);
        subLoanCount = borrowedAmounts.length;

        _checkMainLoanParameters(borrower, programId, totalBorrowedAmount, totalAddonAmount);
        _checkDurationArray(durations);
        _checkSubLoanCount(subLoanCount);
        if (addonAmounts.length != subLoanCount || durations.length != subLoanCount) {
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
                durations[i]
            );
            if (i == 0) {
                firstSubLoanId = subLoanId;
            }
            _setLoanPartsData(subLoanId, firstSubLoanId, subLoanCount);
        }

        emit LoanTaken(
            firstSubLoanId,
            borrower,
            programId,
            subLoanCount,
            totalBorrowedAmount,
            totalAddonAmount,
            "" // addendum
        );

        _transferTokensOnLoanTaking(firstSubLoanId, totalBorrowedAmount, totalAddonAmount);
    }

    /// @inheritdoc ILendingMarketPrimaryV2
    function repaySubLoanBatch(
        uint256[] calldata subLoanIds,
        uint256[] calldata repaymentAmounts,
        address repayer
    ) external whenNotPaused onlyRole(ADMIN_ROLE) {
        uint256 len = subLoanIds.length;
        if (len != repaymentAmounts.length) {
            revert Error.ArrayLengthMismatch();
        }
        for (uint256 i = 0; i < len; ++i) {
            uint256 subLoanId = subLoanIds[i];
            _repaySubLoan(subLoanId, repaymentAmounts[i], repayer);
        }
    }

    /// @inheritdoc ILendingMarketPrimaryV2
    function discountSubLoanBatch(
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

    /// @inheritdoc ILendingMarketPrimaryV2
    function revokeLoan(uint256 subLoanId) external whenNotPaused onlyRole(ADMIN_ROLE) {
        LoanV2.SubLoan storage subLoanStored = _getExitingSubLoanInStorage(subLoanId);

        uint256 firstSubLoanId = subLoanStored.firstSubLoanId;
        uint256 subLoanCount = subLoanStored.subLoanCount;
        uint256 ongoingSubLoanCount = 0;
        LoanV2.ProcessingSubLoan memory subLoan;

        for (uint256 i = 0; i < subLoanCount; ++i) {
            subLoan = _getOngoingSubLoan(firstSubLoanId + i);
            if (!_isRepaid(subLoan)) {
                ++ongoingSubLoanCount;
            }
            _revokeSubLoan(subLoan);
        }

        // If all the sub-loans are repaid the revocation is prohibited
        if (ongoingSubLoanCount == 0) {
            revert LoanStatusFullyRepaid();
        }

        emit LoanRevoked(
            firstSubLoanId,
            subLoanCount,
            "" // addendum
        );

        LoanV2.LoanPreview memory loanPreview = _getLoanPreview(firstSubLoanId, 0);
        _transferTokensOnLoanRevocation(
            subLoan,
            loanPreview.totalBorrowedAmount,
            loanPreview.totalAddonAmount,
            loanPreview.totalRepaidAmount
        );
    }

    /// @inheritdoc ILendingMarketPrimaryV2
    function modifySubLoanOperations(
        uint256 subLoanId,
        address counterparty,
        uint256[] calldata voidedOperationIds,
        LoanV2.AddedOperation[] calldata addedOperations
    ) external {
        uint256 minTimestamp = type(uint256).max;
        uint256 count = voidedOperationIds.length;
        for (uint256 i = 0; i < count; ++i) {
            LoanV2.Operation storage operation = _voidOperation(
                subLoanId,
                voidedOperationIds[i],
                counterparty
            );
            uint256 timestamp = operation.timestamp;
            if (timestamp < minTimestamp) {
                minTimestamp = timestamp;
            }
        }
        uint256 currentTimestamp = _blockTimestamp();
        count = addedOperations.length;
        for (uint256 i = 0; i < count; ++i) {
            LoanV2.AddedOperation calldata operation = addedOperations[i];
            uint256 kind = operation.kind;
            _checkOperationKind(kind);
            uint256 timestamp = operation.timestamp;
            if (timestamp == 0) {
                timestamp = currentTimestamp;
            }
            if (timestamp < minTimestamp) {
                minTimestamp = timestamp;
            }
            LoanV2.ProcessingSubLoan memory subLoan = _getOngoingSubLoan(subLoanId);
            _addOperation(
                subLoan,
                kind,
                timestamp,
                operation.parameter,
                operation.account
            );
        }
        _treatOperations(subLoanId, minTimestamp, counterparty);
    }

    // ------------------ View functions -------------------------- //

    /// @inheritdoc ILendingMarketPrimaryV2
    function getProgramCreditLine(uint32 programId) external view returns (address) {
        return _getLendingMarketStorage().programCreditLines[programId];
    }

    /// @inheritdoc ILendingMarketPrimaryV2
    function getProgramLiquidityPool(uint32 programId) external view returns (address) {
        return _getLendingMarketStorage().programLiquidityPools[programId];
    }

    /// @inheritdoc ILendingMarketPrimaryV2
    function getSubLoanBatch(uint256[] calldata subLoanIds) external view returns (LoanV2.SubLoan[] memory) {
        uint256 len = subLoanIds.length;
        LoanV2.SubLoan[] memory subLoans = new LoanV2.SubLoan[](len);
        LendingMarketStorageV2 storage storageStruct = _getLendingMarketStorage();
        for (uint256 i = 0; i < len; ++i) {
            subLoans[i] = storageStruct.subLoans[subLoanIds[i]];
        }
        
        return subLoans;
    }

    /// @inheritdoc ILendingMarketPrimaryV2
    function getLoanPreviewBatch(
        uint256[] calldata subLoanIds,
        uint256 timestamp
    ) external view returns (LoanV2.SubLoanPreview[] memory) {
        if (timestamp == 0) {
            timestamp = _blockTimestamp();
        }

        uint256 len = subLoanIds.length;
        LoanV2.SubLoanPreview[] memory previews = new LoanV2.SubLoanPreview[](len);
        for (uint256 i = 0; i < len; ++i) {
            previews[i] = _getSubLoanPreview(_getSubLoanWithAccruedInterest(subLoanIds[i], timestamp));
        }

        return previews;
    }

    /// @inheritdoc ILendingMarketPrimaryV2
    function getLoanPreview(
        uint256 subLoanId,
        uint256 timestamp
    ) external view returns (LoanV2.LoanPreview memory) {
        return _getLoanPreview(subLoanId, timestamp);
    }

    /// @inheritdoc ILendingMarketPrimaryV2
    function interestRateFactor() external pure returns (uint256) {
        return Constants.INTEREST_RATE_FACTOR;
    }

    /// @inheritdoc ILendingMarketPrimaryV2
    function timeOffset() external pure returns (uint256, bool) {
        return (Constants.NEGATIVE_TIME_OFFSET, false);
    }

    /// @inheritdoc ILendingMarketPrimaryV2
    function subLoanCounter() external view returns (uint256) {
        return _getLendingMarketStorage().subLoanIdCounter;
    }

    /// @inheritdoc ILendingMarketPrimaryV2
    function programCounter() external view returns (uint256) {
        return _getLendingMarketStorage().programIdCounter;
    }

    function getSubLoanOperations(uint256 subLoanId) external view returns (LoanV2.ProcessingOperation[] memory) {
        LoanV2.OperationalState storage opState = _getLendingMarketStorage().subLoanOperationalStates[subLoanId];
        LoanV2.ProcessingOperation[] memory operations = new LoanV2.ProcessingOperation[](opState.operationCount);
        uint256 operationId = opState.earliestOperationId;
        uint256 i = 0;
        while (operationId != 0) {
            operations[i] = _getExistingOperation(subLoanId, operationId);
            ++i;
            operationId = opState.operations[operationId].nextOperationId;
        }
        return operations;
    }

    // ------------------ Pure functions -------------------------- //

    /// @inheritdoc ILendingMarketV2
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
        (address creditLine, address liquidityPool) = _getCreditLineAndLiquidityPool(programId);
        if (creditLine == address(0)) {
            revert ProgramCreditLineNotConfigured();
        }
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

        uint32 blockTimestamp = _blockTimestamp().toUint32();

        LoanV2.SubLoan storage subLoan = _getSubLoanInStorage(id);

        // Slot1
        subLoan.programId = uint24(programId);
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
        subLoan.status = LoanV2.SubLoanStatus.Ongoing;
        subLoan.interestRateRemuneratory = uint32(terms.interestRateRemuneratory); // Safe cast due to prior checks
        subLoan.interestRateMoratory = uint32(terms.interestRateMoratory);
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
            terms.duration,
            "" //
        );

        return id;
    }

    /**
     * @dev Repays a sub-loan internally.
     * @param subLoanId The unique identifier of the sub-loan to repay.
     * @param repaymentAmount The amount to repay.
     * @param repayer The token source for the repayment or zero if the source is the loan borrower themself.
     */
    function _repaySubLoan(
        uint256 subLoanId, // Tools: this comment prevents Prettier from formatting into a single line.
        uint256 repaymentAmount,
        address repayer
    ) internal {
        repaymentAmount = _normalizeAmount(repaymentAmount);
        LoanV2.ProcessingSubLoan memory subLoan = _getOngoingSubLoan(subLoanId);
        _addOperation(
            subLoan,
            uint256(LoanV2.OperationKind.Repayment),
            _blockTimestamp(), // timestamp
            repaymentAmount, // parameter
            repayer // account
        );
        _processOperations(subLoan);
    }

    /**
     * @dev Discounts a sub-loan internally.
     * @param subLoanId The unique identifier of the sub-loan to discount.
     * @param discountAmount The amount of the discount.
     */
    function _discountLoan(
        uint256 subLoanId, // Tools: this comment prevents Prettier from formatting into a single line.
        uint256 discountAmount
    ) internal {
        LoanV2.ProcessingSubLoan memory subLoan = _getOngoingSubLoan(subLoanId);
        _addOperation(
            subLoan,
            uint256(LoanV2.OperationKind.Discounting),
            _blockTimestamp(),
            discountAmount,
            address(0) // account
        );
        _processOperations(subLoan);
    }

    /**
     * @dev Updates the loan state and makes the necessary transfers when revoking a loan.
     * @param subLoan TODO
     */
    function _revokeSubLoan(LoanV2.ProcessingSubLoan memory subLoan) internal {
        _addOperation(
            subLoan,
            uint256(LoanV2.OperationKind.Repayment),
            _blockTimestamp(),
            0,
            address(0)
        );
        _processOperations(subLoan);
    }

    /**
     * @dev TODO
     */
    function _addOperation(
        LoanV2.ProcessingSubLoan memory subLoan,
        uint256 kind,
        uint256 timestamp,
        uint256 parameter,
        address account
    ) internal returns (uint256) {
        _checkOperationParameter(kind, parameter);
        _checkOperationAccount(kind, account);
        if (timestamp < subLoan.startTimestamp) {
            revert OperationTimestampTooEarly();
        }
        LoanV2.OperationalState storage opState = _getLendingMarketStorage().subLoanOperationalStates[subLoan.id];
        uint256 operationId = uint256(opState.operationCount) + 1;
        _checkOperationId(operationId);
        opState.operationCount = uint16(operationId);
        uint256 prevOperationId = _findEarlierOperation(opState, timestamp);
        uint256 nextOperationId;
        // TODO: Check and fix the logic of inserting a new operation in the chain
        if (prevOperationId == 0) {
            // Add at the beginning of the operation list
            nextOperationId = opState.earliestOperationId;
            opState.operations[nextOperationId].prevOperationId = uint16(operationId);
            opState.earliestOperationId = uint16(operationId);
        } else {
            // Insert in the middle or at the end of the operation list
            if (prevOperationId == opState.latestOperationId) {
                // Add at the end of the operation list
                opState.operations[prevOperationId].nextOperationId = uint16(operationId);
                opState.latestOperationId = uint16(operationId);
            } else {
                nextOperationId = opState.operations[prevOperationId].nextOperationId;
                opState.operations[prevOperationId].nextOperationId = uint16(operationId);
                opState.operations[nextOperationId].prevOperationId = uint16(operationId);
            }
        }
        LoanV2.Operation storage operation = opState.operations[operationId];
        operation.prevOperationId = uint16(prevOperationId); // Safe cast due to prior checks
        operation.nextOperationId = uint16(nextOperationId); // Safe cast due to prior checks
        operation.status = LoanV2.OperationStatus.Pending;
        operation.kind = LoanV2.OperationKind(kind);
        operation.parameter = uint64(parameter);
        if (account != address(0)) {
            operation.account = account;
        }

        if (timestamp > _blockTimestamp()) {
            emit OperationPended(
                subLoan.id,
                operationId,
                kind,
                timestamp,
                parameter,
                account,
                "" // addendum
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
    ) internal returns (LoanV2.Operation storage operation){
        operation = _getExistingOperationInStorage(subLoanId, operationId);
        if (operation.status == LoanV2.OperationStatus.Voided) {
            revert OperationVoidedAlready();
        }

        emit OperationVoided(
            subLoanId,
            operationId,
            uint256(operation.kind),
            operation.timestamp,
            operation.parameter,
            counterparty,
            "" // addendum
        );
    }

    /**
     * @dev TODO
     */
    // TODO: Replace by taking from the credit line contract
    function _determineLoanTerms(
        address borrower,
        uint256 borrowedAmount,
        uint256 duration
    ) public pure returns (LoanV2.Terms memory terms) {
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
     * @dev Sets the loan parts data in storage.
     * @param subLoanId The ID of the sub-loan to update.
     * @param firstSubLoanId The ID of the first sub-loan.
     * @param subLoanCount The total number of sub-loans.
     */
    function _setLoanPartsData(
        uint256 subLoanId, // Tools: this comment prevents Prettier from formatting into a single line.
        uint256 firstSubLoanId,
        uint256 subLoanCount
    ) internal {
        LoanV2.SubLoan storage subLoan = _getSubLoanInStorage(subLoanId);
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
        LoanV2.SubLoan storage subLoan = _getSubLoanInStorage(subLoanId);
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
     * @param subLoan The memory state of the loan.
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

    /// @dev TODO
    function _findEarlierOperation(LoanV2.OperationalState storage opState, uint256 timestamp) internal view returns (uint256) {
        uint256 operationId = opState.latestOperationId;
        while (operationId != 0 && opState.operations[operationId].timestamp > timestamp) {
            operationId = opState.operations[operationId].prevOperationId;
        }
        return operationId;
    }

    /// @dev TODO
    function _processOperations(
        LoanV2.ProcessingSubLoan memory subLoan
    ) internal {
        LoanV2.OperationalState storage opState = _getLendingMarketStorage().subLoanOperationalStates[subLoan.id];
        uint256 pastOperationId = opState.pastOperationId;
        uint256 operationId = 0;
        if (pastOperationId == 0) {
            operationId = opState.earliestOperationId;
        } else {
            operationId = opState.operations[pastOperationId].nextOperationId;
        }
        if (operationId == 0) {
            return;
        }
        uint256 currentTimestamp = _blockTimestamp();
        while (operationId != 0) {
            LoanV2.ProcessingOperation memory operation = _getExistingOperation(subLoan.id, operationId);
            if (operation.status == uint256(LoanV2.OperationStatus.Pending)) {
                break;
            }
            _processSingleOperation(subLoan, operation, currentTimestamp);
            _postProcessOperation(subLoan, operation);
            pastOperationId = operationId;
            if (operation.kind == uint256(LoanV2.OperationKind.Revocation)) {
                break;
            }
            operationId = opState.operations[operationId].nextOperationId;
        }
        opState.pastOperationId = uint16(pastOperationId); // Safe cast due to prior checks
        _updateSubLoan(subLoan);
    }

    /// @dev TODO
    function _replayOperations(LoanV2.ProcessingSubLoan memory subLoan, address counterparty) internal {
        _initiateSubLoan(subLoan);
        subLoan.counterparty = counterparty;
        _getLendingMarketStorage().subLoanOperationalStates[subLoan.id].pastOperationId = 0;
        _processOperations(subLoan);
    }

    /// @dev TODO
    function _treatOperations(uint256 subLoanId, uint256 timestamp, address counterparty) internal {
        LoanV2.ProcessingSubLoan memory subLoan = _getUnrevokedSubLoan(subLoanId);
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
        LoanV2.ProcessingSubLoan memory subLoan,
        LoanV2.ProcessingOperation memory operation,
        uint256 currentTimestamp
    ) internal pure {
        if (
            operation.status == uint256(LoanV2.OperationStatus.Nonexistent) ||
            operation.status == uint256(LoanV2.OperationStatus.Voided) ||
            operation.kind == uint256(LoanV2.OperationKind.Nonexistent) ||
            operation.kind > uint256(LoanV2.OperationKind.NonexistentLimit)
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
        LoanV2.ProcessingSubLoan memory subLoan,
        LoanV2.ProcessingOperation memory operation
    ) internal {
        uint256 operationStatus = operation.status;
        if (
            operationStatus != uint256(LoanV2.OperationStatus.Applied) ||
            operationStatus == operation.initialStatus
        ) {
            return;
        }
        if (operation.kind == uint256(LoanV2.OperationKind.Repayment)) {
            _postProcessRepayment(subLoan, operation);
        }
        _acceptOperationApplying(subLoan.id, operation);
    }

    /**
     * @dev TODO
     */
    function _initiateSubLoan(LoanV2.ProcessingSubLoan memory subLoan) internal view {
        LoanV2.SubLoan storage oldSubLoan = _getSubLoanInStorage(subLoan.id);
        subLoan.status = uint256(LoanV2.SubLoanStatus.Ongoing);
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
        LoanV2.ProcessingSubLoan memory subLoan,
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
            uint256 dueDay =  _dayIndex(subLoan.startTimestamp) + subLoan.duration;
            if (startDay <= dueDay) {
                if (finishDay <= dueDay) {
                    _accrueInterestRemuneratory(subLoan, finishDay - startDay);
                } else {
                    _accrueInterestRemuneratory(subLoan, finishDay - startDay);
                    _calculateInitialLateFee(subLoan);
                    _accrueInterestMoratory(subLoan, finishDay - dueDay);
                }
            } else {
                _accrueInterestMoratory(subLoan, finishDay - dueDay);
            }
        }
    }

    /**
     * @dev TODO
     */
    function _applyOperation(
        LoanV2.ProcessingSubLoan memory subLoan,
        LoanV2.ProcessingOperation memory operation
    ) internal pure {
        uint256 notExecuted;
        uint256 operationKind = operation.kind;
        if (operationKind == uint256(LoanV2.OperationKind.Repayment)) {
            _applyRepaymentOrDiscount(subLoan, operation.parameter, operationKind);
        } else if (operationKind == uint256(LoanV2.OperationKind.Discounting)) {
            _applyRepaymentOrDiscount(subLoan, operation.parameter, operationKind);
        } else if (operationKind == uint256(LoanV2.OperationKind.Revocation)) {
            _applyRevocation(subLoan);
        } else {
            notExecuted = 1;
        }

        if (notExecuted != 0) {
            operation.initialStatus = operation.status;
            operation.status = uint256(LoanV2.OperationStatus.Applied);
        }
    }

    /**
     * @dev TODO
     */
    function _applyRepaymentOrDiscount(
        LoanV2.ProcessingSubLoan memory subLoan,
        uint256 amount,
        uint256 operationKind
    ) internal pure {
        uint256 initialAmount = amount;
        amount = _repayOrDiscountPartial(
            subLoan,
            amount,
            uint256(LoanV2.SubLoanPartKind.InterestMoratory),
            operationKind
        );
        amount = _repayOrDiscountPartial(
            subLoan,
            amount,
            uint256(LoanV2.SubLoanPartKind.LateFee),
            operationKind
        );
        amount = _repayOrDiscountPartial(
            subLoan,
            amount,
            uint256(LoanV2.SubLoanPartKind.InterestRemuneratory),
            operationKind
        );
        amount = _repayOrDiscountPartial(
            subLoan,
            amount,
            uint256(LoanV2.SubLoanPartKind.Principal),
            operationKind
        );

        if (amount > 0 && initialAmount < type(uint64).max) {
            revert RepaymentOrDiscountAmountExcess();
        }
    }

    /**
     * @dev TODO
     */
    function _applyRevocation(LoanV2.ProcessingSubLoan memory subLoan) internal pure {
        subLoan.trackedPrincipal = 0;
        subLoan.trackedInterestRemuneratory = 0;
        subLoan.trackedInterestMoratory = 0;
        subLoan.trackedLateFee = 0;
        subLoan.status = uint256(LoanV2.SubLoanStatus.Revoked);
    }

    /**
     * @dev TODO
     */
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
        uint256 discountPartAmount;

        // TODO: Can be optimized through the assembler language
        if (subLoanPartKind == uint256(LoanV2.SubLoanPartKind.Principal)) {
            trackedPartAmount = subLoan.trackedPrincipal;
            repaidPartAmount = subLoan.repaidPrincipal;
        } else if (subLoanPartKind == uint256(LoanV2.SubLoanPartKind.InterestRemuneratory)) {
            trackedPartAmount = subLoan.trackedInterestRemuneratory;
            repaidPartAmount = subLoan.repaidInterestRemuneratory;
            discountPartAmount = subLoan.discountInterestRemuneratory;
        } else if (subLoanPartKind == uint256(LoanV2.SubLoanPartKind.InterestMoratory)) {
            trackedPartAmount = subLoan.trackedInterestMoratory;
            repaidPartAmount = subLoan.repaidInterestMoratory;
            discountPartAmount = subLoan.discountInterestMoratory;
        } else {
            trackedPartAmount = subLoan.trackedLateFee;
            repaidPartAmount = subLoan.repaidLateFee;
            discountPartAmount = subLoan.discountLateFee;
        }

        // TODO: Review the rounding logic if a loan part is being fully repaid
        uint256 roundedTrackedPartAmount = _roundMath(trackedPartAmount);
        if (roundedTrackedPartAmount <= amount) {
            unchecked {
                amount -= roundedTrackedPartAmount;
                if (operationKind == uint256(LoanV2.OperationKind.Repayment)) {
                    repaidPartAmount += roundedTrackedPartAmount;
                } else {
                    discountPartAmount += roundedTrackedPartAmount;
                }
                trackedPartAmount = 0;
            }
        } else {
            trackedPartAmount -= amount;
            if (operationKind == uint256(LoanV2.OperationKind.Repayment)) {
                repaidPartAmount += amount;
            } else {
                discountPartAmount += roundedTrackedPartAmount;
            }
        }

        // TODO: Can be optimized through the assembler language
        if (subLoanPartKind == uint256(LoanV2.SubLoanPartKind.Principal)) {
            subLoan.trackedPrincipal = trackedPartAmount;
            subLoan.repaidPrincipal = repaidPartAmount;
        } else if (subLoanPartKind == uint256(LoanV2.SubLoanPartKind.InterestRemuneratory)) {
            subLoan.trackedInterestRemuneratory = trackedPartAmount;
            subLoan.repaidInterestRemuneratory = repaidPartAmount;
            subLoan.discountInterestRemuneratory = discountPartAmount;
        } else if (subLoanPartKind == uint256(LoanV2.SubLoanPartKind.InterestMoratory)) {
            subLoan.trackedInterestMoratory = trackedPartAmount;
            subLoan.repaidInterestMoratory = repaidPartAmount;
            subLoan.discountInterestMoratory = discountPartAmount;
        } else {
            subLoan.repaidLateFee = repaidPartAmount;
            subLoan.trackedLateFee = trackedPartAmount;
            subLoan.discountLateFee = discountPartAmount;
        }

        return amount;
    }

    /**
     * @dev TODO
     */
    function _accrueInterestRemuneratory(LoanV2.ProcessingSubLoan memory subLoan, uint256 dayCount) internal pure {
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
    function _accrueInterestMoratory(LoanV2.ProcessingSubLoan memory subLoan, uint256 dayCount) internal pure {
        subLoan.interestRateMoratory += _calculateSimpleInterest(
            subLoan.trackedPrincipal,
            dayCount,
            subLoan.interestRateMoratory
        );
    }

    /**
     * @dev TODO
     */
    function _postProcessRepayment(
        LoanV2.ProcessingSubLoan memory subLoan,
        LoanV2.ProcessingOperation memory operation
    ) internal {
        (, address liquidityPool) = _getCreditLineAndLiquidityPool(subLoan.programId);
        address repayer = operation.account;
        uint256 repaymentAmount = operation.parameter;
        if (operation.kind == uint256(LoanV2.OperationKind.Repayment)) {
            IERC20(_getLendingMarketStorage().token).safeTransferFrom(repayer, liquidityPool, repaymentAmount);
        }
    }

    /**
     * @dev TODO
     */
    function _updateSubLoan(LoanV2.ProcessingSubLoan memory newSubLoan) internal {
        LoanV2.SubLoan storage oldSubLoan = _getSubLoanInStorage(newSubLoan.id);

        // TODO: add events if needed

        // Check full repayment status or its disappearing
        if (newSubLoan.status != uint256(LoanV2.SubLoanStatus.Revoked)) {
            uint256 newTrackedBalance = _calculateTrackedBalance(newSubLoan);
            if (newTrackedBalance == 0) {
                newSubLoan.status = uint256(LoanV2.SubLoanStatus.FullyRepaid);
            } else {
                newSubLoan.status = uint256(LoanV2.SubLoanStatus.Ongoing);
            }
        }

        _acceptRepaymentChange(newSubLoan, oldSubLoan);
        _acceptDiscountChange(newSubLoan, oldSubLoan);
        _acceptSubLoanParametersChange(newSubLoan, oldSubLoan);
        _acceptSubLoanStatusChange(newSubLoan, oldSubLoan);

        // Update storage with the unchecked type conversion is used for all stored values due to prior checks
        // TODO: use flags in the sub-loan in-memory structure and optimize the saving
        oldSubLoan.status = LoanV2.SubLoanStatus(newSubLoan.status);
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
    function _acceptOperationApplying(
        uint256 subLoanId,
        LoanV2.ProcessingOperation memory operation
    ) internal {
        uint256 operationId = operation.id;
        _getOperationInStorage(subLoanId, operationId).status = LoanV2.OperationStatus.Applied;

        emit OperationApplied(
            subLoanId,
            operationId,
            operation.kind,
            operation.timestamp,
            operation.parameter,
            operation.account,
            "" // addendum
        );
    }

    /**
     * @dev TODO
     */
    function _acceptRepaymentChange(
        LoanV2.ProcessingSubLoan memory newSubLoan,
        LoanV2.SubLoan storage oldSubLoan
    ) internal {
        uint256 oldRepaidAmount = _calculateRepaidAmountInStorage(oldSubLoan);
        uint256 newRepaidAmount = _calculateRepaidAmount(newSubLoan);
        if (oldRepaidAmount == newRepaidAmount) {
            return;
        }
        (, address liquidityPool) = _getCreditLineAndLiquidityPool(newSubLoan.programId);
        address token = _getLendingMarketStorage().token;
        address counterparty = newSubLoan.counterparty;
        if (newRepaidAmount < oldRepaidAmount) {
            uint256 repaymentDiff = oldRepaidAmount - newRepaidAmount;
            ILiquidityPool(liquidityPool).onAfterLoanRepaymentUndoing(newSubLoan.id, repaymentDiff);
            if (counterparty != address(0)) {
                IERC20(token).safeTransferFrom(liquidityPool, counterparty, repaymentDiff);
            }
        } else {
            uint256 repaymentDiff = newRepaidAmount - oldRepaidAmount;
            ILiquidityPool(liquidityPool).onAfterLoanPayment(newSubLoan.id, repaymentDiff);
            if (counterparty != address(0)) {
                IERC20(token).safeTransferFrom(counterparty, liquidityPool, repaymentDiff);
            }
        }

        emit SubLoanRepaidAmountChanged(
            newSubLoan.id,
            newSubLoan.borrower,
            newSubLoan.status,
        uint256(oldSubLoan.status),
            newRepaidAmount,
            oldRepaidAmount,
            _calculateTrackedBalance(newSubLoan),
            "" // addendum
        );
    }

    /**
     * @dev TODO
     */
    function _acceptDiscountChange(
        LoanV2.ProcessingSubLoan memory newSubLoan,
        LoanV2.SubLoan storage oldSubLoan
    ) internal {
        uint256 oldDiscountAmount = _calculateDiscountAmountInStorage(oldSubLoan);
        uint256 newDiscountAmount = _calculateDiscountAmount(newSubLoan);
        if (oldDiscountAmount == newDiscountAmount) {
            return;
        }

        emit SubLoanDiscountAmountChanged(
            newSubLoan.id,
            newSubLoan.borrower,
            newSubLoan.status,
            uint256(oldSubLoan.status),
            newDiscountAmount,
            oldDiscountAmount,
            _calculateTrackedBalance(newSubLoan),
            "" // addendum
        );
    }

    /**
     * @dev TODO
     */
    function _acceptSubLoanParametersChange(
        LoanV2.ProcessingSubLoan memory newSubLoan,
        LoanV2.SubLoan storage oldSubLoan
    ) internal {

        // TODO Consider emitting events in this function during operation post processing

        if (newSubLoan.interestRateRemuneratory != oldSubLoan.interestRateRemuneratory) {
            emit SubLoanInterestRateRemuneratoryChanged(
                newSubLoan.id,
                newSubLoan.borrower,
                newSubLoan.interestRateRemuneratory,
                oldSubLoan.interestRateRemuneratory,
                _calculateTrackedBalance(newSubLoan),
                "" // addendum
            );
        }

        if (newSubLoan.interestRateMoratory != oldSubLoan.interestRateMoratory) {
            emit SubLoanInterestRateMoratoryChanged(
                newSubLoan.id,
                newSubLoan.borrower,
                newSubLoan.interestRateMoratory,
                oldSubLoan.interestRateMoratory,
                _calculateTrackedBalance(newSubLoan),
                "" // addendum
            );
        }

        if (newSubLoan.lateFeeRate != oldSubLoan.lateFeeRate) {
            emit SubLoanLateFeeRateChanged(
                newSubLoan.id,
                newSubLoan.borrower,
                newSubLoan.lateFeeRate,
                oldSubLoan.lateFeeRate,
                _calculateTrackedBalance(newSubLoan),
                "" // addendum
            );
        }

        if (newSubLoan.duration != oldSubLoan.duration) {
            emit SubLoanDurationChanged(
                newSubLoan.id,
                newSubLoan.borrower,
                newSubLoan.duration,
                oldSubLoan.duration,
                _calculateTrackedBalance(newSubLoan),
                "" // addendum
            );
        }
    }

    /**
     * @dev TODO
     */
    function _acceptSubLoanStatusChange(
        LoanV2.ProcessingSubLoan memory newSubLoan,
        LoanV2.SubLoan storage oldSubLoan
    ) internal {
        if (newSubLoan.status == uint256(oldSubLoan.status)) {
            return;
        }
        if (newSubLoan.status == uint256(LoanV2.SubLoanStatus.Revoked)) {
            (address creditLine, address liquidityPool) = _getCreditLineAndLiquidityPool(newSubLoan.programId);

            ILiquidityPool(liquidityPool).onAfterLoanRevocation(newSubLoan.id);
            ICreditLine(creditLine).onAfterLoanRevocation(newSubLoan.id);

            emit SubLoanRevoked(
                newSubLoan.id,
                "" // addendum
            );
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
        return principal * dayCount * interestRate / Constants.INTEREST_RATE_FACTOR;
    }

    /**
     * @dev TODO
     */
    function _calculateTrackedBalance(LoanV2.ProcessingSubLoan memory subLoan) internal pure returns (uint256) {
        return
            subLoan.trackedPrincipal + 
            subLoan.trackedInterestRemuneratory +
            subLoan.trackedInterestMoratory +
            subLoan.trackedLateFee;
    }

    /**
     * @dev TODO
     */
    function _calculateOutstandingBalance(LoanV2.ProcessingSubLoan memory subLoan) internal pure returns (uint256) {
        return
            _roundMath(subLoan.trackedPrincipal) +
            _roundMath(subLoan.trackedInterestRemuneratory) +
            _roundMath(subLoan.trackedInterestMoratory) +
            _roundMath(subLoan.trackedLateFee);
    }

    /**
     * @dev TODO
     */
    function _calculateRepaidAmount(LoanV2.ProcessingSubLoan memory subLoan) internal pure returns (uint256) {
        return
            subLoan.repaidPrincipal +
            subLoan.repaidInterestRemuneratory +
            subLoan.repaidInterestMoratory +
            subLoan.repaidLateFee;
    }

    /**
     * @dev TODO
     */
    function _calculateRepaidAmountInStorage(LoanV2.SubLoan storage subLoan) internal view returns (uint256) {
        return
            subLoan.repaidPrincipal +
            subLoan.repaidInterestRemuneratory +
            subLoan.repaidInterestMoratory +
            subLoan.repaidLateFee;
    }

    /**
     * @dev TODO
     */
    function _calculateDiscountAmount(LoanV2.ProcessingSubLoan memory subLoan) internal pure returns (uint256) {
        return
            subLoan.discountInterestRemuneratory +
            subLoan.discountInterestMoratory +
            subLoan.discountLateFee;
    }

    /**
     * @dev TODO
     */
    function _calculateDiscountAmountInStorage(LoanV2.SubLoan storage subLoan) internal view returns (uint256) {
        return
            subLoan.discountInterestRemuneratory +
            subLoan.discountInterestMoratory +
            subLoan.discountLateFee;
    }

    /**
     * @dev TODO
     */
    function _calculateLateFeeAmount(LoanV2.ProcessingSubLoan memory subLoan) internal pure returns (uint256) {
        return
            subLoan.trackedLateFee +
            subLoan.repaidLateFee +
            subLoan.discountLateFee;
    }

    /**
     * @dev TODO
     */
    function _calculateInitialLateFee(LoanV2.ProcessingSubLoan memory subLoan) internal pure {
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
        // TODO: Try to optimize this function by reusing other function

        if (programId == 0) {
            revert ProgramNonexistent();
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

    /// TODO
    function _checkOperationKind(uint256 kind) internal pure {
        if (
            kind >= uint256(LoanV2.OperationKind.NonexistentLimit) ||
            kind <= uint256(LoanV2.OperationKind.Nonexistent)
        ) {
            revert OperationKindInvalid();
        }
        if (kind == uint256(LoanV2.OperationKind.Revocation)) {
            revert OperationKindUnacceptable();
        }
    }

    /// TODO
    function _checkOperationAccount(uint256 kind, address account) internal pure {
        if (kind == uint256(LoanV2.OperationKind.Repayment) && account == address(0)) {
            revert RapayerAddressZero();
        }
        if (kind != uint256(LoanV2.OperationKind.Repayment) && account != address(0)) {
            revert OperationAccountNotZero();
        }
    }

    /// TODO
    function _checkOperationParameter(
        uint256 kind,
        uint256 parameter
    ) internal pure {
        if (
            kind == uint256(LoanV2.OperationKind.Freezing) ||
            kind == uint256(LoanV2.OperationKind.Unfreezing)
        ) {
            if (parameter != 0) {
                revert OperationParameterNotZero();
            }
        }

        if (
            kind == uint256(LoanV2.OperationKind.ChangeInInterestRateRemuneratory) ||
            kind == uint256(LoanV2.OperationKind.ChangeInInterestRateMoratory) ||
            kind == uint256(LoanV2.OperationKind.ChangeInLateFeeRate)
        ) {
            if (parameter > type(uint32).max) {
                revert RateValueInvalid();
            }
        }

        if (
            kind == uint256(LoanV2.OperationKind.ChangeInDuration)
        ) {
            if (parameter == 0 || parameter > type(uint16).max) {
                revert DurationInvalid();
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
     * @dev Ensures the sub-loan count is within the valid range.
     * @param subLoanCount The number of sub-loans to check.
     */
    function _checkSubLoanCount(uint256 subLoanCount) internal view {
        if (subLoanCount > _subLoanCountMax()) {
            revert SubLoanCountExcess();
        }
    }

    /**
     * @dev Validates that the loan ID is within the valid range.
     * @param id The loan ID to check.
     */
    function _checkLoanId(uint256 id) internal pure {
        if (id > type(uint40).max) {
            revert SubLoanIdExcess();
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
    function _convertSubLoan(LoanV2.SubLoan storage subLoanStored) internal view returns (LoanV2.ProcessingSubLoan memory) {
        LoanV2.ProcessingSubLoan memory subLoan;
        // subLoan.id = 0;
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
    function _convertOperation(LoanV2.Operation storage operationInStorage) internal view returns (LoanV2.ProcessingOperation memory) {
        LoanV2.ProcessingOperation memory operation;
        // operation.id = 0;
        operation.initialStatus = uint256(operationInStorage.status);
        operation.status = operation.initialStatus;
        operation.kind = uint256(operationInStorage.kind);
        operation.timestamp = operationInStorage.timestamp;
        operation.parameter = operationInStorage.parameter;
        operation.account = operationInStorage.account;
        return operation;
    }

    /**
     * @dev TODO
     */
    function _getSubLoanInStorage(uint256 subLoanId) internal view returns (LoanV2.SubLoan storage) {
        return _getLendingMarketStorage().subLoans[subLoanId];
    }

    /**
     * @dev TODO
     */
    function _getExitingSubLoanInStorage(uint256 subLoanId) internal view returns (LoanV2.SubLoan storage) {
        LoanV2.SubLoan storage subLoan = _getSubLoanInStorage(subLoanId);
        if (subLoan.status == LoanV2.SubLoanStatus.Nonexistent) {
            revert SubLoanNonexistent();
        }
        return subLoan;
    }

    /**
     * @dev TODO
     */
    function _getSubLoan(uint256 subLoanId) internal view returns (LoanV2.ProcessingSubLoan memory) {
        LoanV2.SubLoan storage subLoanStored = _getSubLoanInStorage(subLoanId);
        LoanV2.ProcessingSubLoan memory subLoan = _convertSubLoan(subLoanStored);
        subLoan.id = subLoanId;
        subLoan.flags = 0;
        return subLoan;
    }

    /**
     * @dev TODO
     */
    function _getUnrevokedSubLoan(uint256 subLoanId) internal view returns (LoanV2.ProcessingSubLoan memory) {
        LoanV2.ProcessingSubLoan memory subLoan = _getSubLoan(subLoanId);
        uint256 status = subLoan.status;
        if (status == uint256(LoanV2.SubLoanStatus.Nonexistent)) {
            revert SubLoanNonexistent();
        }
        if (status == uint256(LoanV2.SubLoanStatus.Revoked)) {
            revert SubLoanStatusRevoked();
        }
        return subLoan;
    }

    /**
     * @dev TODO
     */
    function _getOngoingSubLoan(uint256 subLoanId) internal view returns (LoanV2.ProcessingSubLoan memory) {
        LoanV2.ProcessingSubLoan memory subLoan = _getUnrevokedSubLoan(subLoanId);
        if (subLoan.status == uint256(LoanV2.SubLoanStatus.FullyRepaid)) {
            revert SubLoanStatusFullyRepaid();
        }
        return subLoan;
    }

    /**
     * @dev TODO
     */
    function _getOperationInStorage(uint256 subLoanId, uint256 operationId) internal view returns (LoanV2.Operation storage) {
        return _getLendingMarketStorage().subLoanOperationalStates[subLoanId].operations[operationId];
    }

    /**
     * @dev TODO
     */
    function _getExistingOperationInStorage(uint256 subLoanId, uint256 operationId) internal view returns (LoanV2.Operation storage) {
        LoanV2.Operation storage operation = _getOperationInStorage(subLoanId, operationId);
        if (operation.status == LoanV2.OperationStatus.Nonexistent) {
            revert OperationNonexistent();
        }
        return operation;
    }

    /**
     * @dev TODO
     */
    function _getExistingOperation(uint256 subLoanId, uint256 operationId) internal view returns (LoanV2.ProcessingOperation memory) {
        LoanV2.ProcessingOperation memory operation = _convertOperation(
            _getExistingOperationInStorage(subLoanId, operationId)
        );
        operation.id = operationId;
        return operation;
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
    function _getSubLoanWithAccruedInterest(
        uint256 subLoanId,
        uint256 timestamp
    ) internal view returns (LoanV2.ProcessingSubLoan memory) {
        LoanV2.ProcessingSubLoan memory subLoan = _getSubLoan(subLoanId);

        if (subLoan.status != uint256(LoanV2.SubLoanStatus.Nonexistent)) {
            _accrueInterest(subLoan, timestamp);
        }

        return subLoan;
    }


    /**
     * @dev Calculates the sub-loan preview.
     * @param subLoan TODO
     * @return The sub-loan preview.
     */
    function _getSubLoanPreview(LoanV2.ProcessingSubLoan memory subLoan) internal view returns (LoanV2.SubLoanPreview memory) {
        LoanV2.SubLoanPreview memory preview;
        LoanV2.SubLoan storage subLoanStored = _getSubLoanInStorage(subLoan.id);

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
    function _getLoanPreview(
        uint256 subLoanId,
        uint256 timestamp
    ) internal view returns (LoanV2.LoanPreview memory) {
        LoanV2.LoanPreview memory preview;

        if (timestamp == 0) {
            timestamp = _blockTimestamp();
        }

        LoanV2.SubLoan storage subLoanInStorage = _getSubLoanInStorage(subLoanId);
        uint256 subLoanCount = subLoanInStorage.subLoanCount;
        subLoanId = subLoanInStorage.firstSubLoanId;

        preview.subLoanPreviews = new LoanV2.SubLoanPreview[](subLoanCount);
        preview.firstSubLoanId = subLoanId;
        preview.subLoanCount = subLoanCount;

        LoanV2.SubLoanPreview memory singleLoanPreview;
        for (uint256 i = 0; i < subLoanCount; ++i) {
            LoanV2.ProcessingSubLoan memory subLoan = _getSubLoanWithAccruedInterest(subLoanId, timestamp);
            singleLoanPreview = _getSubLoanPreview(subLoan);
            preview.totalTrackedBalance += _calculateTrackedBalance(subLoan);
            preview.totalOutstandingBalance += singleLoanPreview.outstandingBalance;
            preview.totalBorrowedAmount += singleLoanPreview.borrowedAmount;
            preview.totalAddonAmount += singleLoanPreview.addonAmount;
            preview.totalRepaidAmount += _calculateRepaidAmount(subLoan);
            preview.totalLateFeeAmount += _calculateLateFeeAmount(subLoan);
            preview.totalDiscountAmount += _calculateDiscountAmount(subLoan);
            preview.subLoanPreviews[i] = singleLoanPreview;
            ++subLoanId;
        }
        preview.day = singleLoanPreview.day;

        return preview;
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
     * @dev TODO
     */
    function _normalizeAmount(uint256 amount) internal pure returns (uint256) {
        if (amount == type(uint256).max) {
            amount = type(uint64).max;
        }
        return amount;
    }

    /**
     * @dev TODO
     */
    function _isRepaid(LoanV2.ProcessingSubLoan memory subLoan) internal pure returns (bool) {
        return uint256(subLoan.status) != uint256(LoanV2.SubLoanStatus.FullyRepaid);
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
    function _roundMath(uint256 value) internal pure returns (uint256) {
        return Rounding.roundMath(value, Constants.ACCURACY_FACTOR);
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
