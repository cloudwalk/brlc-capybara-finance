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

import { ICreditLine } from "./interfaces/ICreditLine.sol";
import { ILendingMarket } from "./interfaces/ILendingMarket.sol";
import { ILendingMarketConfiguration } from "./interfaces/ILendingMarket.sol";
import { ILendingMarketPrimary } from "./interfaces/ILendingMarket.sol";
import { ILiquidityPool } from "./interfaces/ILiquidityPool.sol";

import { LendingMarketStorage } from "./LendingMarketStorage.sol";

/**
 * @title LendingMarket contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Implementation of the lending market contract.
 *
 * See additional notes in the comments of the interface `ILendingMarket.sol`.
 */
contract LendingMarket is
    LendingMarketStorage,
    Initializable,
    AccessControlExtUpgradeable,
    PausableExtUpgradeable,
    ILendingMarket,
    Versionable,
    UUPSExtUpgradeable
{
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    // ------------------ Constants ------------------------------- //

    /// @dev The role of an admin that is allowed to execute loan-related functions.
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // ------------------ Modifiers ------------------------------- //

    /**
     * @dev Throws if the loan does not exist or has already been repaid.
     * @param loanId The unique identifier of the loan to check.
     */
    modifier onlyOngoingLoan(uint256 loanId) {
        _checkIfLoanOngoing(loanId);
        _;
    }

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
     * @param owner_ The owner of the contract.
     * See details https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable.
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
        address creditLine, // Tools: prevent Prettier one-liner
        address liquidityPool
    ) external whenNotPaused onlyRole(OWNER_ROLE) {
        _checkCreditLineAndLiquidityPool(creditLine, liquidityPool);

        if (_programIdCounter >= type(uint32).max) {
            revert ProgramIdExcess();
        }
        uint32 programId;
        unchecked {
            programId = ++_programIdCounter;
        }

        emit ProgramCreated(msg.sender, programId);
        emit ProgramUpdated(programId, creditLine, liquidityPool);

        _programCreditLines[programId] = creditLine;
        _programLiquidityPools[programId] = liquidityPool;
    }

    /// @inheritdoc ILendingMarketConfiguration
    function updateProgram(
        uint32 programId, // Tools: prevent Prettier one-liner
        address creditLine,
        address liquidityPool
    ) external whenNotPaused onlyRole(OWNER_ROLE) {
        if (programId == 0) {
            revert ProgramNotExist();
        }
        _checkCreditLineAndLiquidityPool(creditLine, liquidityPool);
        if (_programCreditLines[programId] == creditLine && _programLiquidityPools[programId] == liquidityPool) {
            revert Error.AlreadyConfigured();
        }

        emit ProgramUpdated(programId, creditLine, liquidityPool);

        _programCreditLines[programId] = creditLine;
        _programLiquidityPools[programId] = liquidityPool;
    }

    // -------------- Primary transactional functions ------------- //

    /// @inheritdoc ILendingMarketPrimary
    function takeLoanFor(
        address borrower,
        uint32 programId,
        uint256 borrowedAmount,
        uint256 addonAmount,
        uint256 durationInPeriods
    ) external whenNotPaused onlyRole(ADMIN_ROLE) returns (uint256) {
        _checkMainLoanParameters(borrower, programId, borrowedAmount, addonAmount);
        uint256 loanId = _takeLoan(
            borrower, // Tools: prevent Prettier one-liner
            programId,
            borrowedAmount,
            addonAmount,
            durationInPeriods
        );
        _transferTokensOnLoanTaking(loanId, borrowedAmount, addonAmount);
        return loanId;
    }

    /// @inheritdoc ILendingMarketPrimary
    function takeInstallmentLoanFor(
        address borrower,
        uint32 programId,
        uint256[] calldata borrowedAmounts,
        uint256[] calldata addonAmounts,
        uint256[] calldata durationsInPeriods
    ) external whenNotPaused onlyRole(ADMIN_ROLE) returns (uint256 firstInstallmentId, uint256 installmentCount) {
        uint256 totalBorrowedAmount = _sumArray(borrowedAmounts);
        uint256 totalAddonAmount = _sumArray(addonAmounts);
        installmentCount = borrowedAmounts.length;

        _checkMainLoanParameters(borrower, programId, totalBorrowedAmount, totalAddonAmount);
        _checkDurationArray(durationsInPeriods);
        _checkInstallmentCount(installmentCount);
        if (addonAmounts.length != installmentCount || durationsInPeriods.length != installmentCount) {
            revert Error.ArrayLengthMismatch();
        }
        // Arrays are not checked for emptiness because if the loan amount is zero, the transaction is reverted earlier

        for (uint256 i = 0; i < installmentCount; ++i) {
            if (borrowedAmounts[i] == 0) {
                revert Error.InvalidAmount();
            }
            uint256 loanId = _takeLoan(
                borrower, // Tools: prevent Prettier one-liner
                programId,
                borrowedAmounts[i],
                addonAmounts[i],
                durationsInPeriods[i]
            );
            if (i == 0) {
                firstInstallmentId = loanId;
            }
            _updateLoanInstallmentData(loanId, firstInstallmentId, installmentCount);
        }

        emit InstallmentLoanTaken(
            firstInstallmentId,
            borrower,
            programId,
            installmentCount,
            totalBorrowedAmount,
            totalAddonAmount
        );

        _transferTokensOnLoanTaking(firstInstallmentId, totalBorrowedAmount, totalAddonAmount);
    }

    /// @inheritdoc ILendingMarketPrimary
    function repayLoan(uint256 loanId, uint256 repaymentAmount) external whenNotPaused onlyOngoingLoan(loanId) {
        _repayLoan(loanId, repaymentAmount, msg.sender);
    }

    /// @inheritdoc ILendingMarketPrimary
    function repayLoanForBatch(
        uint256[] calldata loanIds,
        uint256[] calldata repaymentAmounts,
        address repayer
    ) external whenNotPaused onlyRole(ADMIN_ROLE) {
        uint256 len = loanIds.length;
        if (len != repaymentAmounts.length) {
            revert Error.ArrayLengthMismatch();
        }
        if (repayer == address(0)) {
            revert Error.ZeroAddress();
        }
        for (uint256 i = 0; i < len; ++i) {
            uint256 loanId = loanIds[i];
            _checkIfLoanOngoing(loanId);
            _repayLoan(loanId, repaymentAmounts[i], repayer);
        }
    }

    /// @inheritdoc ILendingMarketPrimary
    function revokeLoan(uint256 loanId) external whenNotPaused onlyOngoingLoan(loanId) onlyRole(ADMIN_ROLE) {
        Loan.State storage loan = _loans[loanId];
        _checkLoanType(loan, uint256(Loan.Type.Ordinary));
        _revokeLoan(loanId, loan);
        _transferTokensOnLoanRevocation(loan, loan.borrowedAmount, loan.addonAmount, loan.repaidAmount);
    }

    /// @inheritdoc ILendingMarketPrimary
    function revokeInstallmentLoan(uint256 loanId) external whenNotPaused onlyRole(ADMIN_ROLE) {
        Loan.State storage loan = _loans[loanId];
        _checkLoanExistence(loan);
        _checkLoanType(loan, uint256(Loan.Type.Installment));

        loanId = loan.firstInstallmentId;
        uint256 lastLoanId = loanId + loan.installmentCount - 1;
        uint256 ongoingSubLoanCount = 0;
        Loan.InstallmentLoanPreview memory installmentLoanPreview = _getInstallmentLoanPreview(loanId, 0);

        for (; loanId <= lastLoanId; ++loanId) {
            loan = _loans[loanId];
            if (!_isRepaid(loan)) {
                ++ongoingSubLoanCount;
            }
            _revokeLoan(loanId, loan);
        }

        // If all the sub-loans are repaid the revocation is prohibited
        if (ongoingSubLoanCount == 0) {
            revert LoanAlreadyRepaid();
        }

        emit InstallmentLoanRevoked(
            loan.firstInstallmentId, // Tools: prevent Prettier one-liner
            loan.installmentCount
        );

        _transferTokensOnLoanRevocation(
            loan,
            installmentLoanPreview.totalBorrowedAmount,
            installmentLoanPreview.totalAddonAmount,
            installmentLoanPreview.totalRepaidAmount
        );
    }

    /// @inheritdoc ILendingMarketPrimary
    function discountLoanForBatch(
        uint256[] calldata loanIds, // Tools: prevent Prettier one-liner
        uint256[] calldata discountAmounts
    ) external whenNotPaused onlyRole(ADMIN_ROLE) {
        uint256 len = loanIds.length;
        if (len != discountAmounts.length) {
            revert Error.ArrayLengthMismatch();
        }
        for (uint256 i = 0; i < len; ++i) {
            uint256 loanId = loanIds[i];
            _checkIfLoanOngoing(loanId);
            _discountLoan(loanId, discountAmounts[i]);
        }
    }

    /// @inheritdoc ILendingMarketPrimary
    function undoRepaymentFor(
        uint256 loanId,
        uint256 repaymentAmount,
        uint256 repaymentTimestamp,
        address receiver
    ) external whenNotPaused onlyRole(ADMIN_ROLE) {
        // See the explanation of this function in the interface file
        Loan.State storage loan = _loans[loanId];
        _checkLoanExistence(loan);
        _checkUndoingRepaymentParameters(loan, repaymentAmount, repaymentTimestamp);
        uint256 oldTrackedBalance = loan.trackedBalance;
        (uint256 newTrackedBalance, ) = _calculateCustomTrackedBalance(
            loan,
            repaymentAmount,
            repaymentTimestamp,
            loan.trackedTimestamp
        );
        newTrackedBalance += oldTrackedBalance;

        uint256 oldLateFeeAmount = loan.lateFeeAmount;
        uint256 newLateFeeAmount = oldLateFeeAmount;
        {
            uint256 dueTimestamp = _getDueTimestamp(loan);
            if (repaymentTimestamp <= dueTimestamp && oldLateFeeAmount != 0) {
                (uint256 additionalLateFeeAmount, ) = _calculateCustomTrackedBalance(
                    loan,
                    repaymentAmount,
                    repaymentTimestamp,
                    dueTimestamp
                );
                additionalLateFeeAmount = _calculateLateFee(additionalLateFeeAmount, loan);
                newLateFeeAmount += additionalLateFeeAmount;
            }
        }

        uint256 oldRepaidAmount = loan.repaidAmount;
        uint256 newRepaidAmount = oldRepaidAmount;
        unchecked {
            newRepaidAmount -= Rounding.roundMath(repaymentAmount, Constants.ACCURACY_FACTOR);
        }

        emit RepaymentUndone(
            loanId,
            receiver,
            loan.borrower,
            repaymentTimestamp,
            newRepaidAmount,
            oldRepaidAmount,
            newTrackedBalance,
            oldTrackedBalance,
            newLateFeeAmount,
            oldLateFeeAmount
        );
        loan.repaidAmount = newRepaidAmount.toUint64();
        loan.trackedBalance = newTrackedBalance.toUint64();
        loan.lateFeeAmount = newLateFeeAmount.toUint64();

        if (oldTrackedBalance == 0) {
            address creditLine = _programCreditLines[loan.programId];
            ICreditLine(creditLine).onBeforeLoanReopened(loanId);
        }

        if (receiver != address(0)) {
            _transferFromPool(
                loan.token,
                _programLiquidityPools[loan.programId],
                receiver,
                oldRepaidAmount - newRepaidAmount
            );
        }
    }

    /// @inheritdoc ILendingMarketPrimary
    function freeze(uint256 loanId) external whenNotPaused onlyOngoingLoan(loanId) onlyRole(ADMIN_ROLE) {
        Loan.State storage loan = _loans[loanId];

        if (loan.freezeTimestamp != 0) {
            revert LoanAlreadyFrozen();
        }

        loan.freezeTimestamp = _blockTimestamp().toUint32();

        emit LoanFrozen(loanId);
    }

    /// @inheritdoc ILendingMarketPrimary
    function unfreeze(uint256 loanId) external whenNotPaused onlyOngoingLoan(loanId) onlyRole(ADMIN_ROLE) {
        Loan.State storage loan = _loans[loanId];

        if (loan.freezeTimestamp == 0) {
            revert LoanNotFrozen();
        }

        uint256 timestamp = _blockTimestamp();
        (uint256 trackedBalance, uint256 lateFeeAmount) = _calculateTrackedBalance(loan, timestamp);
        _updateStoredLateFee(lateFeeAmount, loan);
        uint256 currentPeriodIndex = _periodIndex(timestamp, Constants.PERIOD_IN_SECONDS);
        uint256 freezePeriodIndex = _periodIndex(loan.freezeTimestamp, Constants.PERIOD_IN_SECONDS);
        uint256 frozenPeriods = currentPeriodIndex - freezePeriodIndex;

        if (frozenPeriods > 0) {
            loan.durationInPeriods += frozenPeriods.toUint32();
        }
        loan.trackedBalance = trackedBalance.toUint64();
        loan.trackedTimestamp = timestamp.toUint32();
        loan.freezeTimestamp = 0;

        emit LoanUnfrozen(loanId);
    }

    /// @inheritdoc ILendingMarketPrimary
    function updateLoanDuration(
        uint256 loanId,
        uint256 newDurationInPeriods
    ) external whenNotPaused onlyOngoingLoan(loanId) onlyRole(ADMIN_ROLE) {
        Loan.State storage loan = _loans[loanId];

        if (newDurationInPeriods <= loan.durationInPeriods) {
            revert InappropriateLoanDuration();
        }

        emit LoanDurationUpdated(loanId, newDurationInPeriods, loan.durationInPeriods);

        loan.durationInPeriods = newDurationInPeriods.toUint32();
    }

    /// @inheritdoc ILendingMarketPrimary
    function updateLoanInterestRatePrimary(
        uint256 loanId,
        uint256 newInterestRate
    ) external whenNotPaused onlyOngoingLoan(loanId) onlyRole(ADMIN_ROLE) {
        Loan.State storage loan = _loans[loanId];

        if (newInterestRate >= loan.interestRatePrimary) {
            revert InappropriateInterestRate();
        }

        emit LoanInterestRatePrimaryUpdated(loanId, newInterestRate, loan.interestRatePrimary);

        loan.interestRatePrimary = newInterestRate.toUint32();
    }

    /// @inheritdoc ILendingMarketPrimary
    function updateLoanInterestRateSecondary(
        uint256 loanId,
        uint256 newInterestRate
    ) external whenNotPaused onlyOngoingLoan(loanId) onlyRole(ADMIN_ROLE) {
        Loan.State storage loan = _loans[loanId];

        if (newInterestRate >= loan.interestRateSecondary) {
            revert InappropriateInterestRate();
        }

        emit LoanInterestRateSecondaryUpdated(loanId, newInterestRate, loan.interestRateSecondary);

        loan.interestRateSecondary = newInterestRate.toUint32();
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
            previews[i] = _getLoanPreviewExtended(loanIds[i], timestamp);
        }

        return previews;
    }

    /// @inheritdoc ILendingMarketPrimary
    function getInstallmentLoanPreview(
        uint256 loanId,
        uint256 timestamp
    ) external view returns (Loan.InstallmentLoanPreview memory) {
        return _getInstallmentLoanPreview(loanId, timestamp);
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
                originalBalance, // Tools: prevent Prettier one-liner
                numberOfPeriods,
                interestRate,
                interestRateFactor_
            );
    }

    /// @inheritdoc ILendingMarket
    function proveLendingMarket() external pure {}

    // ------------------ Internal functions ---------------------- //

    /**
     * @dev Takes a loan for a provided account internally.
     * @param borrower The account for whom the loan is taken.
     * @param programId The identifier of the program to take the loan from.
     * @param borrowedAmount The desired amount of tokens to borrow.
     * @param addonAmount The off-chain calculated addon amount (extra charges or fees) for the loan.
     * @param durationInPeriods The desired duration of the loan in periods.
     * @return The unique identifier of the loan.
     */
    function _takeLoan(
        address borrower,
        uint32 programId,
        uint256 borrowedAmount,
        uint256 addonAmount,
        uint256 durationInPeriods
    ) internal returns (uint256) {
        address creditLine = _programCreditLines[programId];
        if (creditLine == address(0)) {
            revert ProgramCreditLineNotConfigured();
        }

        address liquidityPool = _programLiquidityPools[programId];
        if (liquidityPool == address(0)) {
            revert ProgramLiquidityPoolNotConfigured();
        }

        uint256 id = _loanIdCounter++;
        _checkLoanId(id);

        Loan.Terms memory terms = ICreditLine(creditLine).determineLoanTerms(
            borrower, // Tools: prevent Prettier one-liner
            borrowedAmount,
            durationInPeriods
        );
        terms.addonAmount = addonAmount;
        uint256 principalAmount = borrowedAmount + terms.addonAmount;
        uint32 blockTimestamp = _blockTimestamp().toUint32();

        Loan.State storage loan = _loans[id];
        loan.token = terms.token;
        loan.borrower = borrower;
        loan.programId = programId;
        loan.startTimestamp = blockTimestamp;
        loan.durationInPeriods = terms.durationInPeriods.toUint32();
        loan.interestRatePrimary = terms.interestRatePrimary.toUint32();
        loan.interestRateSecondary = terms.interestRateSecondary.toUint32();
        loan.borrowedAmount = borrowedAmount.toUint64();
        loan.trackedBalance = principalAmount.toUint64();
        loan.trackedTimestamp = blockTimestamp;
        loan.addonAmount = terms.addonAmount.toUint64();
        // Other loan fields are zero: repaidAmount, repaidAmount, firstInstallmentId, lateFeeAmount

        ICreditLine(creditLine).onBeforeLoanTaken(id);

        emit LoanTaken(id, borrower, principalAmount, terms.durationInPeriods);

        return id;
    }

    /**
     * @dev Updates the loan state and makes the necessary transfers when repaying a loan.
     * @param loanId The unique identifier of the loan to repay.
     * @param repaymentAmount The amount to repay.
     * @param repayer The token source for the repayment or zero if the source is the loan borrower themself.
     */
    function _repayLoan(
        uint256 loanId, // Tools: prevent Prettier one-liner
        uint256 repaymentAmount,
        address repayer
    ) internal {
        Loan.State storage loan = _loans[loanId];
        uint256 newTrackedBalance;
        (newTrackedBalance, repaymentAmount) = _processTrackedBalanceChange(loan, repaymentAmount);
        loan.repaidAmount += repaymentAmount.toUint64();

        _transferToPool(
            loan.token,
            _programLiquidityPools[loan.programId],
            repayer,
            repaymentAmount
        );
        ICreditLine(_programCreditLines[loan.programId]).onAfterLoanPayment(loanId, repaymentAmount);

        emit LoanRepayment(loanId, repayer, loan.borrower, repaymentAmount, newTrackedBalance);
    }

    /**
     * @dev Updates the loan state and makes the necessary transfers when revoking a loan.
     * @param loanId The unique identifier of the loan to revoke.
     * @param loan The storage state of the loan to update.
     */
    function _revokeLoan(uint256 loanId, Loan.State storage loan) internal {
        address creditLine = _programCreditLines[loan.programId];

        loan.trackedBalance = 0;
        loan.trackedTimestamp = _blockTimestamp().toUint32();

        ICreditLine(creditLine).onAfterLoanRevocation(loanId);

        emit LoanRevoked(loanId);
    }

    /**
     * @dev Discounts a loan.
     * @param loanId The unique identifier of the loan to discount.
     * @param discountAmount The amount of the discount.
     */
    function _discountLoan(
        uint256 loanId, // Tools: prevent Prettier one-liner
        uint256 discountAmount
    ) internal {
        uint256 newTrackedBalance;
        Loan.State storage loan = _loans[loanId];
        (newTrackedBalance, discountAmount) = _processTrackedBalanceChange(loan, discountAmount);
        loan.discountAmount += discountAmount.toUint64();
        emit LoanDiscounted(loanId, discountAmount, newTrackedBalance);
    }

    /**
     * @dev Processes a change in the tracked balance of a loan and updates the loan state accordingly.
     * @param loan The storage state of the loan.
     * @param changeAmount The amount of the change or type(uint256).max if it is a full repayment or a full discount.
     * @return newTrackedBalance The new tracked balance.
     * @return actualChangeAmount The actual change amount.
     */
    function _processTrackedBalanceChange(
        Loan.State storage loan,
        uint256 changeAmount
    ) internal returns (uint256 newTrackedBalance, uint256 actualChangeAmount) {
        _checkTrackedBalanceChange(changeAmount);
        uint256 timestamp = _blockTimestamp();
        (uint256 oldTrackedBalance, uint256 lateFeeAmount) = _calculateTrackedBalance(loan, timestamp);
        uint256 outstandingBalance = Rounding.roundMath(oldTrackedBalance, Constants.ACCURACY_FACTOR);
        newTrackedBalance = 0; // Full repayment or full discount by default

        if (changeAmount == type(uint256).max) {
            changeAmount = outstandingBalance;
        } else {
            if (changeAmount > outstandingBalance) {
                revert Error.InvalidAmount();
            }
            // Not a full repayment or a full discount
            if (changeAmount < outstandingBalance) {
                newTrackedBalance = oldTrackedBalance - changeAmount;
            }
            // Else full repayment or full discount
        }
        actualChangeAmount = changeAmount;

        loan.trackedBalance = newTrackedBalance.toUint64();
        loan.trackedTimestamp = timestamp.toUint32();
        _updateStoredLateFee(lateFeeAmount, loan);
    }

    /**
     * @dev Validates the change in the tracked balance of a loan.
     *
     * This function is made virtual to be overridden for testing purposes.
     *
     * @param changeAmount The amount of change in the tracked balance.
     */
    function _checkTrackedBalanceChange(uint256 changeAmount) internal view virtual {
        if (changeAmount == 0) {
            revert Error.InvalidAmount();
        }
        if (changeAmount == type(uint256).max) {
            return;
        }
        if (changeAmount != Rounding.roundMath(changeAmount, Constants.ACCURACY_FACTOR)) {
            revert Error.InvalidAmount();
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
        if (borrowedAmount != Rounding.roundMath(borrowedAmount, Constants.ACCURACY_FACTOR)) {
            revert Error.InvalidAmount();
        }
        if (addonAmount != Rounding.roundMath(addonAmount, Constants.ACCURACY_FACTOR)) {
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
     * @dev Ensures the installment count is within the valid range.
     * @param installmentCount The number of installments to check.
     */
    function _checkInstallmentCount(uint256 installmentCount) internal view {
        if (installmentCount > _installmentCountMax()) {
            revert InstallmentCountExcess();
        }
    }

    /**
     * @dev Updates the loan installment data in storage.
     * @param loanId The ID of the loan to update.
     * @param firstInstallmentId The ID of the first installment.
     * @param installmentCount The total number of installments.
     */
    function _updateLoanInstallmentData(
        uint256 loanId, // Tools: prevent Prettier one-liner
        uint256 firstInstallmentId,
        uint256 installmentCount
    ) internal {
        Loan.State storage loan = _loans[loanId];
        loan.firstInstallmentId = uint40(firstInstallmentId); // Unchecked conversion is safe due to contract logic
        loan.installmentCount = uint8(installmentCount); // Unchecked conversion is safe due to contract logic
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
     * @dev Checks if the loan exists.
     * @param loan The storage state of the loan.
     */
    function _checkLoanExistence(Loan.State storage loan) internal view {
        if (loan.borrower == address(0)) {
            revert LoanNotExist();
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
     * @dev Checks if the loan type is correct.
     * @param loan The storage state of the loan.
     * @param expectedLoanType The expected type of the loan according to the `Loan.Type` enum.
     */
    function _checkLoanType(Loan.State storage loan, uint256 expectedLoanType) internal view {
        if (loan.installmentCount == 0) {
            if (expectedLoanType != uint256(Loan.Type.Ordinary)) {
                revert LoanTypeUnexpected(
                    Loan.Type.Ordinary, // actual
                    Loan.Type.Installment // expected
                );
            }
        } else {
            if (expectedLoanType != uint256(Loan.Type.Installment)) {
                revert LoanTypeUnexpected(
                    Loan.Type.Installment, // actual
                    Loan.Type.Ordinary // expected
                );
            }
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
     * @dev Calculates the loan preview.
     * @param loanId The ID of the loan.
     * @param timestamp The timestamp to calculate the preview at.
     * @return The loan preview.
     */
    function _getLoanPreview(uint256 loanId, uint256 timestamp) internal view returns (Loan.Preview memory) {
        Loan.Preview memory preview;
        Loan.State storage loan = _loans[loanId];

        preview.periodIndex = _periodIndex(timestamp, Constants.PERIOD_IN_SECONDS);
        (preview.trackedBalance /* skip the late fee */, ) = _calculateTrackedBalance(loan, timestamp);
        preview.outstandingBalance = Rounding.roundMath(preview.trackedBalance, Constants.ACCURACY_FACTOR);

        return preview;
    }

    /**
     * @dev Calculates the loan extended preview.
     * @param loanId The ID of the loan.
     * @param timestamp The timestamp to calculate the preview at.
     * @return The loan extended preview.
     */
    function _getLoanPreviewExtended(
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
     * @dev Calculates the installment loan preview.
     * @param loanId The ID of the loan.
     * @param timestamp The timestamp to calculate the preview at.
     * @return The installment loan preview.
     */
    function _getInstallmentLoanPreview(
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
            singleLoanPreview = _getLoanPreviewExtended(loanId, timestamp);
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

    /// @dev Calculates the period index that corresponds the specified timestamp.
    function _periodIndex(uint256 timestamp, uint256 periodInSeconds_) internal pure returns (uint256) {
        return (timestamp / periodInSeconds_);
    }

    /// @dev Returns the current block timestamp with the time offset applied.
    function _blockTimestamp() internal view virtual returns (uint256) {
        return block.timestamp - Constants.NEGATIVE_TIME_OFFSET;
    }

    /// @dev Returns the maximum number of installments for a loan. Can be overridden for testing purposes.
    function _installmentCountMax() internal view virtual returns (uint256) {
        return Constants.INSTALLMENT_COUNT_MAX;
    }

    /**
     * @dev Calculates the late fee amount for a loan.
     * @param trackedBalance The tracked balance of the loan.
     * @param loan The storage state of the loan.
     * @return The late fee amount.
     */
    function _calculateLateFee(
        uint256 trackedBalance, // Tools: prevent Prettier one-liner
        Loan.State storage loan
    ) internal view returns (uint256) {
        address creditLine = _programCreditLines[loan.programId];
        // The `creditLine` variable is not checked because it is always non-zero according to the contract logic.
        return ICreditLine(creditLine).determineLateFeeAmount(loan.borrower, trackedBalance);
    }

    /**
     * @dev Updates the stored late fee amount for a loan.
     * @param lateFeeAmount The late fee amount to store.
     * @param loan The storage state of the loan.
     */
    function _updateStoredLateFee(uint256 lateFeeAmount, Loan.State storage loan) internal {
        if (lateFeeAmount > 0) {
            loan.lateFeeAmount = lateFeeAmount.toUint64();
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
     * @dev Transfers tokens from the liquidity pool to the borrower and the addon treasury.
     * @param loanId The ID of the loan.
     * @param borrowedAmount The amount of tokens to borrow.
     * @param addonAmount The addon amount of the loan.
     */
    function _transferTokensOnLoanTaking(uint256 loanId, uint256 borrowedAmount, uint256 addonAmount) internal {
        Loan.State storage loan = _loans[loanId];
        address liquidityPool = _programLiquidityPools[loan.programId];
        address token = loan.token;
        address addonTreasury = ILiquidityPool(liquidityPool).addonTreasury();
        if (addonTreasury == address(0)) {
            revert AddonTreasuryAddressZero();
        }

        _transferFromPool(token, liquidityPool, loan.borrower, borrowedAmount);
        if (addonAmount != 0) {
            _transferFromPool(token, liquidityPool, addonTreasury, addonAmount);
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
        Loan.State storage loan,
        uint256 borrowedAmount,
        uint256 addonAmount,
        uint256 repaidAmount
    ) internal {
        address liquidityPool = _programLiquidityPools[loan.programId];
        address token = loan.token;
        address addonTreasury = ILiquidityPool(liquidityPool).addonTreasury();
        if (addonTreasury == address(0)) {
            revert AddonTreasuryAddressZero();
        }

        if (repaidAmount < borrowedAmount) {
            _transferToPool(
                token,
                liquidityPool,
                loan.borrower,
                borrowedAmount - repaidAmount
            );
        } else if (repaidAmount != borrowedAmount) {
            _transferFromPool(
                token,
                liquidityPool,
                loan.borrower,
                repaidAmount - borrowedAmount
            );
        }
        if (addonAmount != 0) {
            _transferToPool(
                token,
                liquidityPool,
                addonTreasury,
                addonAmount
            );
        }
    }

    /**
     * @dev Transfers tokens from a liquidity pool to a receiver.
     * @param token The address of the token.
     * @param liquidityPool The address of the liquidity pool.
     * @param receiver The address of the receiver.
     * @param amount The amount of tokens to transfer.
     */
    function _transferFromPool(address token, address liquidityPool, address receiver, uint256 amount) internal {
        ILiquidityPool(liquidityPool).onBeforeLiquidityOut(amount);
        IERC20(token).safeTransferFrom(liquidityPool, receiver, amount);
    }

    /**
     * @dev Transfers tokens from a sender to a liquidity pool.
     * @param token The address of the token.
     * @param liquidityPool The address of the liquidity pool.
     * @param sender The address of the sender.
     * @param amount The amount of tokens to transfer.
     */
    function _transferToPool(address token, address liquidityPool, address sender, uint256 amount) internal {
        ILiquidityPool(liquidityPool).onBeforeLiquidityIn(amount);
        IERC20(token).safeTransferFrom(sender, liquidityPool, amount);
    }

    /**
     * @dev The upgrade validation function for the UUPSExtUpgradeable contract.
     * @param newImplementation The address of the new implementation.
     */
    function _validateUpgrade(address newImplementation) internal view override onlyRole(OWNER_ROLE) {
        try ILendingMarket(newImplementation).proveLendingMarket() {} catch {
            revert Error.ImplementationAddressInvalid();
        }
    }
}
