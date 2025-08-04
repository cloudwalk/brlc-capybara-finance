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
    // ------------------ Types ----------------------------------- //

    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    /// @dev Represents a sub-loan that is affected by an operation. For internal use only.
    struct OperationAffectedSubLoan{
        uint256 subLoanId;
        uint256 minOperationTimestamp;
        address counterparty;
    }

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
    ) external whenNotPaused onlyRole(ADMIN_ROLE) returns (uint256 firstSubLoanId) {
        uint256 totalBorrowedAmount = _sumArray(borrowedAmounts);
        uint256 totalAddonAmount = _sumArray(addonAmounts);
        uint256 subLoanCount = borrowedAmounts.length;

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
            totalAddonAmount
        );

        _transferTokensOnLoanTaking(firstSubLoanId, totalBorrowedAmount, totalAddonAmount);
    }

    /// @inheritdoc ILendingMarketPrimaryV2
    function repaySubLoanBatch(LoanV2.RepaymentRequest[] calldata repaymentRequests) external whenNotPaused onlyRole(ADMIN_ROLE) {
        uint256 len = repaymentRequests.length;
        for (uint256 i = 0; i < len; ++i) {
            LoanV2.RepaymentRequest memory repaymentRequest = repaymentRequests[i];
            _repaySubLoan(repaymentRequest.subLoanId, repaymentRequest.repaymentAmount, repaymentRequest.repayer);
        }
    }

    /// @inheritdoc ILendingMarketPrimaryV2
    function discountSubLoanBatch(LoanV2.DiscountRequest[] calldata discountRequests) external whenNotPaused onlyRole(ADMIN_ROLE) {
        uint256 len = discountRequests.length;
        for (uint256 i = 0; i < len; ++i) {
            LoanV2.DiscountRequest memory discountRequest = discountRequests[i];
            _discountSubLoan(discountRequest.subLoanId, discountRequest.discountAmount);
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

    /// @inheritdoc ILendingMarketPrimaryV2
    function modifyOperationBatch(
        LoanV2.VoidOperationRequest[] calldata voidOperationRequests,
        LoanV2.AddedOperationRequest[] calldata addedOperationRequests
    ) external {
        // TODO: Simplify and maybe split this function into parts
        uint256 affectedSubLoanCount = 0;
        uint256 count = voidOperationRequests.length;
        OperationAffectedSubLoan[] memory affectedSubLoans =
            new OperationAffectedSubLoan[](count + addedOperationRequests.length);
        for (uint256 i = 0; i < count; ++i) {
            LoanV2.VoidOperationRequest memory voidingRequest = voidOperationRequests[i];
            OperationAffectedSubLoan memory affectedSubLoan = _findOperationAffectedSubLoan(
                affectedSubLoans,
                affectedSubLoanCount,
                voidingRequest.subLoanId
            );
            if (affectedSubLoan.subLoanId == 0) {
                ++affectedSubLoanCount;
                affectedSubLoan.subLoanId = voidingRequest.subLoanId;
                affectedSubLoan.counterparty = voidingRequest.counterparty;
                affectedSubLoan.minOperationTimestamp = type(uint256).max;
            } else if (affectedSubLoan.counterparty != voidingRequest.counterparty) {
                revert OperationRequestArrayCounterpartyDifference();
            }
            LoanV2.Operation storage operation = _voidOperation(
                voidingRequest.subLoanId,
                voidingRequest.operationId,
                voidingRequest.counterparty
            );
            if (operation.status == LoanV2.OperationStatus.Revoked) {
                if (operation.timestamp > affectedSubLoan.minOperationTimestamp) {
                    affectedSubLoan.minOperationTimestamp = operation.timestamp;
                }
            }
        }
        count = addedOperationRequests.length;
        for (uint256 i = 0; i < count; ++i) {
            LoanV2.AddedOperationRequest memory addingRequest = addedOperationRequests[i];
            OperationAffectedSubLoan memory affectedSubLoan = _findOperationAffectedSubLoan(
                affectedSubLoans,
                affectedSubLoanCount,
                addingRequest.subLoanId
            );
            if (affectedSubLoan.subLoanId == 0) {
                ++affectedSubLoanCount;
                affectedSubLoan.subLoanId = addingRequest.subLoanId;
                affectedSubLoan.minOperationTimestamp = type(uint256).max;
            }
            _checkOperationParameters(addingRequest.kind, addingRequest.inputValue, addingRequest.account);
            _addOperation(
                addingRequest.subLoanId,
                addingRequest.kind,
                addingRequest.timestamp,
                addingRequest.inputValue,
                addingRequest.account
            );
            if (addingRequest.timestamp > affectedSubLoan.minOperationTimestamp) {
                affectedSubLoan.minOperationTimestamp = addingRequest.timestamp;
            }
        }

        for (uint256 i = 0; i < affectedSubLoanCount; ++i) {
            OperationAffectedSubLoan memory affectedSubLoan = affectedSubLoans[i];
            _treatOperations(affectedSubLoan.subLoanId, affectedSubLoan.minOperationTimestamp, affectedSubLoan.counterparty);
        }
    }

    // ------------------ View functions -------------------------- //

    /// @inheritdoc ILendingMarketPrimaryV2
    function getProgramCreditLineAndLiquidityPool(uint32 programId) external view returns (address creditLine, address liquidityPool) {
        creditLine = _getLendingMarketStorage().programCreditLines[programId];
        liquidityPool = _getLendingMarketStorage().programLiquidityPools[programId];
    }

    /// @inheritdoc ILendingMarketPrimaryV2
    function getSubLoanStateBatch(uint256[] calldata subLoanIds) external view returns (LoanV2.SubLoan[] memory) {
        uint256 len = subLoanIds.length;
        LoanV2.SubLoan[] memory subLoans = new LoanV2.SubLoan[](len);
        LendingMarketStorageV2 storage storageStruct = _getLendingMarketStorage();
        for (uint256 i = 0; i < len; ++i) {
            subLoans[i] = storageStruct.subLoans[subLoanIds[i]];
        }
        
        return subLoans;
    }

    /// @inheritdoc ILendingMarketPrimaryV2
    function getSubLoanPreviewBatch(
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
    function getLoanPreviewBatch(
        uint256[] calldata subLoanIds,
        uint256 timestamp
    ) external view returns (LoanV2.LoanPreview[] memory) {
        return new LoanV2.LoanPreview[](0);// _getLoanPreview(subLoanId, timestamp);
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

    /// @inheritdoc ILendingMarketPrimaryV2
    function getSubLoanOperations(uint256 subLoanId) external view returns (LoanV2.OperationView[] memory) {
        LendingMarketStorageV2 storage storageStruct = _getLendingMarketStorage();
        LoanV2.SubLoan storage subLoan = storageStruct.subLoans[subLoanId];
        LoanV2.OperationView[] memory operations = new LoanV2.OperationView[](subLoan.operationCount);
        uint256 operationId = subLoan.earliestOperationId;
        for (uint256 i = 0; operationId != 0; ++i) {
            operations[i] = _getOperationView(subLoanId, operationId);
            operationId = storageStruct.subLoanOperations[subLoanId][operationId].nextOperationId;
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

        // TODO: Check if the following fields are set correctly and comments about zero fields are correct too

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
        subLoan.duration = uint16(terms.duration); // Safe cast due to prior checks
        subLoan.interestRateRemuneratory = uint32(terms.interestRateRemuneratory); // Safe cast due to prior checks
        subLoan.interestRateMoratory = uint32(terms.interestRateMoratory);
        subLoan.lateFeeRate = uint32(terms.lateFeeRate); // Safe cast due to prior checks
        subLoan.trackedTimestamp = blockTimestamp;
        // subLoan.freezeTimestamp = 0;
        // subLoan.firstSubLoanId = 0;
        // subLoan.subLoanCount = 0;
        // subLoan.operationCount = 0;
        // subLoan.earliestOperationId = 0;
        // subLoan.latestOperationId = 0;
        // subLoan.pastOperationId = 0;

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
            _packRates(terms)
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
            subLoan.id,
            uint256(LoanV2.OperationKind.Repayment),
            _blockTimestamp(), // timestamp
            repaymentAmount, // inputValue
            repayer // account
        );
        _processOperations(subLoan);
    }

    /**
     * @dev Discounts a sub-loan internally.
     * @param subLoanId The unique identifier of the sub-loan to discount.
     * @param discountAmount The amount of the discount.
     */
    function _discountSubLoan(
        uint256 subLoanId, // Tools: this comment prevents Prettier from formatting into a single line.
        uint256 discountAmount
    ) internal {
        LoanV2.ProcessingSubLoan memory subLoan = _getOngoingSubLoan(subLoanId);
        _addOperation(
            subLoan.id,
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
            subLoan.id,
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
        uint256 subLoanId,
        uint256 kind,
        uint256 timestamp,
        uint256 inputValue,
        address account
    ) internal returns (uint256) {
        LendingMarketStorageV2 storage storageStruct = _getLendingMarketStorage();
        LoanV2.SubLoan storage subLoan = storageStruct.subLoans[subLoanId];
        _checkOperationParameters(kind, inputValue, account);  // TODO: move to the calling function
        if (timestamp < subLoan.startTimestamp) {
            revert OperationTimestampTooEarly();
        }
        uint256 operationId = uint256(subLoan.operationCount) + 1;
        _checkOperationId(operationId);
        subLoan.operationCount = uint16(operationId);
        uint256 prevOperationId = _findEarlierOperation(subLoanId, timestamp);
        uint256 nextOperationId;
        // TODO: Check and fix the logic of inserting a new operation in the chain
        if (prevOperationId == 0) {
            // Add at the beginning of the operation list
            nextOperationId = subLoan.earliestOperationId;
            storageStruct.subLoanOperations[subLoanId][nextOperationId].prevOperationId = uint16(operationId);
            subLoan.earliestOperationId = uint16(operationId);
        } else {
            // Insert in the middle or at the end of the operation list
            if (prevOperationId == subLoan.latestOperationId) {
                // Add at the end of the operation list
                storageStruct.subLoanOperations[subLoanId][prevOperationId].nextOperationId = uint16(operationId);
                subLoan.latestOperationId = uint16(operationId);
            } else {
                nextOperationId = storageStruct.subLoanOperations[subLoanId][prevOperationId].nextOperationId;
                storageStruct.subLoanOperations[subLoanId][prevOperationId].nextOperationId = uint16(operationId);
                storageStruct.subLoanOperations[subLoanId][nextOperationId].prevOperationId = uint16(operationId);
            }
        }
        LoanV2.Operation storage operation = storageStruct.subLoanOperations[subLoanId][operationId];
        operation.prevOperationId = uint16(prevOperationId); // Safe cast due to prior checks
        operation.nextOperationId = uint16(nextOperationId); // Safe cast due to prior checks
        operation.status = LoanV2.OperationStatus.Pending;
        operation.kind = LoanV2.OperationKind(kind);
        operation.inputValue = uint64(inputValue);
        // operation.appliedValue = 0; // Until operation is actually applied
        if (account != address(0)) {
            operation.account = account;
        }

        if (timestamp > _blockTimestamp()) {
            emit OperationPended(
                subLoanId,
                operationId,
            LoanV2.OperationKind(kind),
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
    ) internal returns (LoanV2.Operation storage operation){
        operation = _getExistingOperationInStorage(subLoanId, operationId);
        uint256 previousStatus = uint256(operation.status);
        if (previousStatus == uint256(LoanV2.OperationStatus.Pending)) {
            operation.status = LoanV2.OperationStatus.Canceled;

            emit OperationCanceled(
                subLoanId,
                operationId,
                operation.kind
            );
        } else if (previousStatus == uint256(LoanV2.OperationStatus.Applied)) {
            operation.status = LoanV2.OperationStatus.Revoked;

            emit OperationRevoked(
                subLoanId,
                operationId,
                operation.kind,
                counterparty
            );
        } else {
            if (previousStatus == uint256(LoanV2.OperationStatus.Canceled)) {
                revert OperationCanceledAlready();
            } else {
                revert OperationRevokedAlready();
            }
        }
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
    function _findEarlierOperation( 
        uint256 subLoanId,
        uint256 timestamp
    ) internal view returns (uint256) {
        uint256 operationId = _getSubLoanInStorage(subLoanId).latestOperationId;
        LendingMarketStorageV2 storage storageStruct = _getLendingMarketStorage();
        while (operationId != 0 && storageStruct.subLoanOperations[subLoanId][operationId].timestamp > timestamp) {
            operationId = storageStruct.subLoanOperations[subLoanId][operationId].prevOperationId;
        }
        return operationId;
    }

    /// @dev TODO
    function _processOperations(
        LoanV2.ProcessingSubLoan memory subLoan
    ) internal {
        LendingMarketStorageV2 storage storageStruct = _getLendingMarketStorage();
        LoanV2.SubLoan storage subLoanStored = storageStruct.subLoans[subLoan.id];
        uint256 pastOperationId = subLoanStored.pastOperationId;
        uint256 operationId = 0;
        if (pastOperationId == 0) {
            operationId = subLoanStored.earliestOperationId;
        } else {
            operationId = storageStruct.subLoanOperations[subLoan.id][pastOperationId].nextOperationId;
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
            operationId = storageStruct.subLoanOperations[subLoan.id][operationId].nextOperationId;
        }
        subLoanStored.pastOperationId = uint16(pastOperationId); // Safe cast due to prior checks
        _updateSubLoan(subLoan);
    }

    /// @dev TODO
    function _replayOperations(LoanV2.ProcessingSubLoan memory subLoan, address counterparty) internal {
        _initiateSubLoan(subLoan);
        subLoan.counterparty = counterparty;
        _getLendingMarketStorage().subLoans[subLoan.id].pastOperationId = 0;
        _processOperations(subLoan);
    }

    /// @dev TODO
    function _treatOperations(uint256 subLoanId, uint256 timestamp, address counterparty) internal {
        LoanV2.ProcessingSubLoan memory subLoan = _getNonRevokedSubLoan(subLoanId);
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
            operation.status != uint256(LoanV2.OperationStatus.Pending) &&
            operation.status != uint256(LoanV2.OperationStatus.Applied)
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
        _acceptOperationApplying(subLoan, operation);
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
        uint256 appliedValue = operation.inputValue;
        if (operationKind == uint256(LoanV2.OperationKind.Repayment)) {
            appliedValue = _applyRepaymentOrDiscount(subLoan, operation.inputValue, operationKind);
        } else if (operationKind == uint256(LoanV2.OperationKind.Discounting)) {
            appliedValue = _applyRepaymentOrDiscount(subLoan, operation.inputValue, operationKind);
        } else if (operationKind == uint256(LoanV2.OperationKind.Revocation)) {
            _applyRevocation(subLoan);
        } else {
            notExecuted = 1;
        }

        if (notExecuted != 0) {
            operation.initialStatus = operation.status;
            operation.status = uint256(LoanV2.OperationStatus.Applied);
            operation.appliedValue = appliedValue;
        }
    }

    /**
     * @dev TODO
     */
    function _applyRepaymentOrDiscount(
        LoanV2.ProcessingSubLoan memory subLoan,
        uint256 amount,
        uint256 operationKind
    ) internal pure returns (uint256) {
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

        // TODO: Consider replacement of repaymentAmount with repaymentLimit, then no special value is needed

        if (amount > 0 && initialAmount < type(uint64).max) {
            revert RepaymentOrDiscountAmountExcess();
        }

        return initialAmount - amount;
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
        uint256 repaymentAmount = operation.inputValue;
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
        LoanV2.ProcessingSubLoan memory subLoan,
        LoanV2.ProcessingOperation memory operation
    ) internal {
        uint256 operationId = operation.id;
        uint256 subLoanId = subLoan.id;
        LoanV2.Operation storage operationInStorage = _getOperationInStorage(subLoanId, operationId);
        operationInStorage.status = LoanV2.OperationStatus.Applied;
        operationInStorage.appliedValue = uint64(operation.appliedValue);

        emit OperationApplied(
            subLoanId,
            operationId,
            LoanV2.OperationKind(operation.kind),
            operation.timestamp,
            operation.inputValue,
            operation.account,
            operation.appliedValue
        );
    }

    /**
     * @dev TODO
     */
    function _acceptRepaymentChange(
        LoanV2.ProcessingSubLoan memory newSubLoan,
        LoanV2.SubLoan storage oldSubLoan
    ) internal {
        uint256 oldRepaidSumAmount = _calculateRepaidAmountInStorage(oldSubLoan);
        uint256 newRepaidSumAmount = _calculateRepaidAmount(newSubLoan);
        if (newRepaidSumAmount != oldRepaidSumAmount) {
            (, address liquidityPool) = _getCreditLineAndLiquidityPool(newSubLoan.programId);
            address token = _getLendingMarketStorage().token;
            address counterparty = newSubLoan.counterparty;
            if (newRepaidSumAmount > oldRepaidSumAmount) {
                uint256 repaymentChange = newRepaidSumAmount - oldRepaidSumAmount;
                ILiquidityPool(liquidityPool).onAfterLoanRepaymentUndoing(newSubLoan.id, repaymentChange);
                if (counterparty != address(0)) {
                    IERC20(token).safeTransferFrom(liquidityPool, counterparty, repaymentChange);
                }
            } else {
                uint256 repaymentChange = oldRepaidSumAmount - newRepaidSumAmount;
                ILiquidityPool(liquidityPool).onAfterLoanPayment(newSubLoan.id, repaymentChange);
                if (counterparty != address(0)) {
                    IERC20(token).safeTransferFrom(counterparty, liquidityPool, repaymentChange);
                }
            }
        }
        bytes32 oldRepaidParts = _packedRepaidPartsInStorage(oldSubLoan);
        bytes32 newRepaidParts = _packRepaidParts(newSubLoan);

        if (oldRepaidParts != newRepaidParts) {
            emit SubLoanRepaymentUpdated(
                newSubLoan.id,
                newRepaidParts,
                oldRepaidParts
            );
        }
    }

    /**
     * @dev TODO
     */
    function _acceptDiscountChange(
        LoanV2.ProcessingSubLoan memory newSubLoan,
        LoanV2.SubLoan storage oldSubLoan
    ) internal {
        bytes32 oldDiscountParts = _packDiscountPartsInStorage(oldSubLoan);
        bytes32 newDiscountParts = _packDiscountParts(newSubLoan);
        if (newDiscountParts != oldDiscountParts) {
            emit SubLoanDiscountUpdated(
                newSubLoan.id,
                newDiscountParts,
                oldDiscountParts
            );
        }
    }

    /**
     * @dev TODO
     */
    function _acceptSubLoanParametersChange(
        LoanV2.ProcessingSubLoan memory newSubLoan,
        LoanV2.SubLoan storage oldSubLoan
    ) internal {
        uint256 newValue = newSubLoan.interestRateRemuneratory;
        uint256 oldValue = uint256(oldSubLoan.interestRateRemuneratory);
        if (newValue == oldValue) {
            emit SubLoanInterestRateRemuneratoryUpdated(
                newSubLoan.id,
                newValue,
                oldValue
            );
        }

        newValue = newSubLoan.interestRateMoratory;
        oldValue = uint256(oldSubLoan.interestRateMoratory);
        if (newValue == oldValue) {
            emit SubLoanInterestRateMoratoryUpdated(
                newSubLoan.id,
                newValue,
                oldValue
            );
        }

        newValue = newSubLoan.lateFeeRate;
        oldValue = uint256(oldSubLoan.lateFeeRate);
        if (newValue == oldValue) {
            emit SubLoanLateFeeRateUpdated(
                newSubLoan.id,
                newValue,
                oldValue
            );
        }

        newValue = newSubLoan.duration;
        oldValue = uint256(oldSubLoan.duration);
        if (newValue == oldValue) {
            emit SubLoanDurationUpdated(
                newSubLoan.id,
                newValue,
                oldValue
            );
        }

        if (newSubLoan.freezeTimestamp != oldSubLoan.freezeTimestamp) {
            if (newSubLoan.freezeTimestamp != 0) {
                emit SubLoanFrozen(newSubLoan.id);
            } else {
                emit SubLoanUnfrozen(newSubLoan.id);
            }
        }
    }

    /**
     * @dev TODO
     */
    function _acceptSubLoanStatusChange(
        LoanV2.ProcessingSubLoan memory newSubLoan,
        LoanV2.SubLoan storage oldSubLoan
    ) internal {
        uint256 newStatus = newSubLoan.status;
        if (newStatus == uint256(oldSubLoan.status)) {
            return;
        }
        if (newStatus == uint256(LoanV2.SubLoanStatus.Revoked)) {
            (address creditLine, address liquidityPool) = _getCreditLineAndLiquidityPool(newSubLoan.programId);

            ILiquidityPool(liquidityPool).onAfterLoanRevocation(newSubLoan.id);
            ICreditLine(creditLine).onAfterLoanRevocation(newSubLoan.id);

            emit SubLoanRevoked(newSubLoan.id);
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
    function _checkOperationParameters(
        uint256 kind,
        uint256 inputValue,
        address account
    ) internal pure {
        if (
            kind == uint256(LoanV2.OperationKind.Nonexistent) ||
            kind >= uint256(LoanV2.OperationKind.NonexistentLimit)
        ) {
            revert OperationKindInvalid();
        }

        if (kind == uint256(LoanV2.OperationKind.Revocation)) {
            revert OperationKindUnacceptable();
        }

        if (
            kind == uint256(LoanV2.OperationKind.Freezing) ||
            kind == uint256(LoanV2.OperationKind.Unfreezing)
        ) {
            if (inputValue != 0) {
                revert OperationInputValueNotZero();
            }
        }

        if (
            kind == uint256(LoanV2.OperationKind.ChangeInInterestRateRemuneratory) ||
            kind == uint256(LoanV2.OperationKind.ChangeInInterestRateMoratory) ||
            kind == uint256(LoanV2.OperationKind.ChangeInLateFeeRate)
        ) {
            if (inputValue > type(uint32).max) {
                revert RateValueInvalid();
            }
        }

        if (
            kind == uint256(LoanV2.OperationKind.ChangeInDuration)
        ) {
            if (inputValue == 0 || inputValue > type(uint16).max) {
                revert DurationInvalid();
            }
        }

        if (kind == uint256(LoanV2.OperationKind.Repayment)) {
            if (account == address(0)) {
                revert RapayerAddressZero();
            }
        } else if (account != address(0)){
            revert OperationAccountNotZero();
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
        operation.inputValue = operationInStorage.inputValue;
        operation.appliedValue = operationInStorage.appliedValue;
        operation.account = operationInStorage.account;
        return operation;
    }

    /**
     * @dev TODO
     */
    function _convertOperationToView(LoanV2.Operation storage operationInStorage) internal view returns (LoanV2.OperationView memory) {
        LoanV2.OperationView memory operation;
        // operation.id = 0;
        operation.status = operation.status;
        operation.kind = uint256(operationInStorage.kind);
        operation.timestamp = operationInStorage.timestamp;
        operation.inputValue = operationInStorage.inputValue;
        operation.appliedValue = operationInStorage.appliedValue;
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
    function _getNonRevokedSubLoan(uint256 subLoanId) internal view returns (LoanV2.ProcessingSubLoan memory) {
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
        LoanV2.ProcessingSubLoan memory subLoan = _getNonRevokedSubLoan(subLoanId);
        if (subLoan.status == uint256(LoanV2.SubLoanStatus.FullyRepaid)) {
            revert SubLoanStatusFullyRepaid();
        }
        return subLoan;
    }

    /**
     * @dev TODO
     */
    function _getOperationInStorage(uint256 subLoanId, uint256 operationId) internal view returns (LoanV2.Operation storage) {
        return _getLendingMarketStorage().subLoanOperations[subLoanId][operationId];
    }

    /**
     * @dev TODO
     */
    function _findOperationAffectedSubLoan(
        OperationAffectedSubLoan[] memory affectedSubLoans,
        uint256 affectedSubLoanCount,
        uint256 subLoanId
    ) internal pure returns (OperationAffectedSubLoan memory) {
        for (uint256 i = 0; i < affectedSubLoanCount; ++i) {
            OperationAffectedSubLoan memory affectedSubLoan = affectedSubLoans[i];
            if (affectedSubLoans[i].subLoanId == subLoanId || affectedSubLoans[i].subLoanId == 0) {
                return affectedSubLoans[i];
            }
        }
        return affectedSubLoans[0];
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
    function _getOperationView(uint256 subLoanId, uint256 operationId) internal view returns (LoanV2.OperationView memory) {
        LoanV2.OperationView memory operationView = _convertOperationToView(
            _getOperationInStorage(subLoanId, operationId)
        );
        operationView.id = operationId;
        return operationView;
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
     * @dev TODO
     *
     * The packed rates is a bitfield with the following bits:
     *
     * - 32 bits from 0 to 31: the remuneratory interest rate.
     * - 32 bits from 32 to 63: the moratory interest rate.
     * - 32 bits from 64 to 95: the late fee rate.
     */
    function _packRates(LoanV2.Terms memory terms) internal view returns (bytes32) {
        return bytes32(
            (terms.interestRateRemuneratory & type(uint32).max) +
            ((terms.interestRateMoratory & type(uint32).max) << 32) +
            ((terms.lateFeeRate & type(uint32).max) << 64)
        );
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
    function _packAmountParts(uint256 part1, uint256 part2, uint256 part3, uint256 part4) internal pure returns (bytes32) {
        return bytes32(
            (part1 & type(uint64).max) +
            ((part2 & type(uint64).max) << 64) +
            ((part3 & type(uint64).max) << 128) +
            ((part4 & type(uint64).max) << 192)
        );
    }

    /**
     * @dev TODO
     */
    function _packRepaidParts(LoanV2.ProcessingSubLoan memory subLoan) internal pure returns (bytes32) {
        return _packAmountParts(
            subLoan.repaidPrincipal,
            subLoan.repaidInterestRemuneratory,
            subLoan.repaidInterestMoratory,
            subLoan.repaidLateFee
        );
    }

    /**
     * @dev TODO
     */
    function _packedRepaidPartsInStorage(LoanV2.SubLoan storage subLoan) internal view returns (bytes32) {
        return _packAmountParts(
            subLoan.repaidPrincipal,
            subLoan.repaidInterestRemuneratory,
            subLoan.repaidInterestMoratory,
            subLoan.repaidLateFee
        );
    }

    /**
     * @dev TODO
     */
    function _packDiscountParts(LoanV2.ProcessingSubLoan memory subLoan) internal pure returns (bytes32) {
        return _packAmountParts(
            subLoan.discountPrincipal,
            subLoan.discountInterestRemuneratory,
            subLoan.discountInterestMoratory,
            subLoan.discountLateFee
        );
    }

    /**
     * @dev TODO
     */
    function _packDiscountPartsInStorage(LoanV2.SubLoan storage subLoan) internal view returns (bytes32) {
        return _packAmountParts(
            subLoan.discountPrincipal,
            subLoan.discountInterestRemuneratory,
            subLoan.discountInterestMoratory,
            subLoan.discountLateFee
        );
    }

    /**
     * @dev TODO
     */
    function _packTrackedParts(LoanV2.ProcessingSubLoan memory subLoan) internal pure returns (bytes32) {
        return _packAmountParts(
            subLoan.trackedPrincipal,
            subLoan.trackedInterestRemuneratory,
            subLoan.trackedInterestMoratory,
            subLoan.trackedLateFee
        );
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
