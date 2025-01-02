// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

import { Loan } from "./common/libraries/Loan.sol";
import { Error } from "./common/libraries/Error.sol";
import { Rounding } from "./common/libraries/Rounding.sol";
import { Constants } from "./common/libraries/Constants.sol";
import { InterestMath } from "./common/libraries/InterestMath.sol";
import { SafeCast } from "./common/libraries/SafeCast.sol";
import { Versionable } from "./common/Versionable.sol";

import { ILendingMarket } from "./common/interfaces/core/ILendingMarket.sol";
import { ILiquidityPool } from "./common/interfaces/core/ILiquidityPool.sol";
import { ICreditLine } from "./common/interfaces/core/ICreditLine.sol";

import { LendingMarketStorage } from "./LendingMarketStorage.sol";

/// @title LendingMarket contract
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Implementation of the lending market contract.
///
/// See additional notes in the comments of the interface `ILendingMarket.sol`.
contract LendingMarket is
    LendingMarketStorage,
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ILendingMarket,
    Versionable
{
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    /// @dev The role of this contract owner.
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");

    // -------------------------------------------- //
    //  Errors                                      //
    // -------------------------------------------- //

    /// @dev Thrown when the loan ID exceeds the maximum allowed value.
    error LoanIdExcess();

    /// @dev Thrown when the loan does not exist.
    error LoanNotExist();

    /// @dev Thrown when the loan is not frozen.
    error LoanNotFrozen();

    /// @dev Thrown when the loan is already repaid.
    error LoanAlreadyRepaid();

    /// @dev Thrown when the loan is already frozen.
    error LoanAlreadyFrozen();

    /// @dev Thrown when the loan type according to the provided ID does not match the expected one.
    /// @param actualType The actual type of the loan.
    /// @param expectedType The expected type of the loan.
    error LoanTypeUnexpected(Loan.Type actualType, Loan.Type expectedType);

    /// @dev Thrown when the credit line is not configured.
    error CreditLineLenderNotConfigured();

    /// @dev Thrown when the liquidity pool is not configured.
    error LiquidityPoolLenderNotConfigured();

    /// @dev Thrown when provided interest rate is inappropriate.
    error InappropriateInterestRate();

    /// @dev Thrown when provided loan duration is inappropriate.
    error InappropriateLoanDuration();

    /// @dev Thrown when the cooldown period has passed.
    error CooldownPeriodHasPassed();

    /// @dev Thrown when the program does not exist.
    error ProgramNotExist();

    /// @dev Thrown when the provided address does not belong to a contract of expected type or a contract at all.
    error ContractAddressInvalid();

    /// @dev Thrown when the provided duration array is invalid.
    error DurationArrayInvalid();

    /// @dev Thrown when the installment count exceeds the maximum allowed value.
    error InstallmentCountExcess();

    // -------------------------------------------- //
    //  Modifiers                                   //
    // -------------------------------------------- //

    /// @dev Throws if called by any account other than the lender or its alias.
    /// @param loanId The unique identifier of the loan to check.
    modifier onlyLenderOrAlias(uint256 loanId) {
        if (!isLenderOrAlias(loanId, msg.sender)) {
            revert Error.Unauthorized();
        }
        _;
    }

    /// @dev Throws if the loan does not exist or has already been repaid.
    /// @param loanId The unique identifier of the loan to check.
    modifier onlyOngoingLoan(uint256 loanId) {
        _checkIfLoanOngoing(loanId);
        _;
    }

    // -------------------------------------------- //
    //  Initializers                                //
    // -------------------------------------------- //

    /// @dev Initializer of the upgradable contract.
    /// @param owner_ The owner of the contract.
    /// See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
    function initialize(address owner_) external initializer {
        __LendingMarket_init(owner_);
    }

    /// @dev Internal initializer of the upgradable contract.
    /// @param owner_ The owner of the contract.
    /// See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
    function __LendingMarket_init(address owner_) internal onlyInitializing {
        __Context_init_unchained();
        __ERC165_init_unchained();
        __AccessControl_init_unchained();
        __Pausable_init_unchained();
        __LendingMarket_init_unchained(owner_);
    }

    /// @dev Unchained internal initializer of the upgradable contract.
    /// @param owner_ The owner of the contract.
    /// See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
    function __LendingMarket_init_unchained(address owner_) internal onlyInitializing {
        _setRoleAdmin(OWNER_ROLE, OWNER_ROLE);
        _grantRole(OWNER_ROLE, owner_);
    }

    // -------------------------------------------- //
    //  Owner functions                             //
    // -------------------------------------------- //

    /// @dev Pauses the contract.
    function pause() external onlyRole(OWNER_ROLE) {
        _pause();
    }

    /// @dev Unpauses the contract.
    function unpause() external onlyRole(OWNER_ROLE) {
        _unpause();
    }

    // -------------------------------------------- //
    //  Borrower functions                          //
    // -------------------------------------------- //

    /// @inheritdoc ILendingMarket
    function takeLoan(
        uint32 programId,
        uint256 borrowAmount,
        uint256 durationInPeriods
    ) external whenNotPaused returns (uint256) {
        address borrower = msg.sender;
        _checkMainLoanParameters(borrower, programId, borrowAmount, 0);
        uint256 loanId = _takeLoan(
            borrower,
            programId,
            borrowAmount,
            -1, // addonAmount -- calculate internally
            durationInPeriods
        );
        _transferTokensOnLoanTaking(loanId, borrowAmount, _loans[loanId].addonAmount);
        return loanId;
    }

    /// @inheritdoc ILendingMarket
    function takeLoanFor(
        address borrower,
        uint32 programId,
        uint256 borrowAmount,
        uint256 addonAmount,
        uint256 durationInPeriods
    ) external whenNotPaused returns (uint256) {
        _checkSender(msg.sender, programId);
        _checkMainLoanParameters(borrower, programId, borrowAmount, addonAmount);
        uint256 loanId = _takeLoan(
            borrower, // Tools: this comment prevents Prettier from formatting into a single line.
            programId,
            borrowAmount,
            int256(addonAmount),
            durationInPeriods
        );
        _transferTokensOnLoanTaking(loanId, borrowAmount, addonAmount);
        return loanId;
    }

    /// @inheritdoc ILendingMarket
    function takeInstallmentLoanFor(
        address borrower,
        uint32 programId,
        uint256[] calldata borrowAmounts,
        uint256[] calldata addonAmounts,
        uint256[] calldata durationsInPeriods
    ) external whenNotPaused returns (uint256 firstInstallmentId, uint256 installmentCount) {
        uint256 totalBorrowAmount = _sumArray(borrowAmounts);
        uint256 totalAddonAmount = _sumArray(addonAmounts);
        installmentCount = borrowAmounts.length;

        _checkSender(msg.sender, programId);
        _checkMainLoanParameters(borrower, programId, totalBorrowAmount, totalAddonAmount);
        _checkDurationArray(durationsInPeriods);
        _checkInstallmentCount(installmentCount);
        if (addonAmounts.length != installmentCount || durationsInPeriods.length != installmentCount) {
            revert Error.ArrayLengthMismatch();
        }
        // Arrays are not checked for emptiness because if the loan amount is zero, the transaction is reverted earlier

        for (uint256 i = 0; i < installmentCount; ++i) {
            uint256 loanId = _takeLoan(
                borrower,
                programId,
                borrowAmounts[i],
                int256(addonAmounts[i]),
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
            totalBorrowAmount,
            totalAddonAmount
        );

        _transferTokensOnLoanTaking(firstInstallmentId, totalBorrowAmount, totalAddonAmount);
    }

    /// @dev Takes a loan for a provided account internally.
    /// @param borrower The account for whom the loan is taken.
    /// @param programId The identifier of the program to take the loan from.
    /// @param borrowAmount The desired amount of tokens to borrow.
    /// @param addonAmount If not negative, the off-chain calculated addon amount (extra charges or fees) for the loan,
    ///        otherwise a flag to calculated the addon amount internally.
    /// @param durationInPeriods The desired duration of the loan in periods.
    /// @return The unique identifier of the loan.
    function _takeLoan(
        address borrower,
        uint32 programId,
        uint256 borrowAmount,
        int256 addonAmount,
        uint256 durationInPeriods
    ) internal returns (uint256) {
        address creditLine = _programCreditLines[programId];
        if (creditLine == address(0)) {
            revert CreditLineLenderNotConfigured();
        }

        address liquidityPool = _programLiquidityPools[programId];
        if (liquidityPool == address(0)) {
            revert LiquidityPoolLenderNotConfigured();
        }

        uint256 id = _loanIdCounter++;
        _checkLoanId(id);

        Loan.Terms memory terms = ICreditLine(creditLine).determineLoanTerms(
            borrower, // Tools: this comment prevents Prettier from formatting into a single line.
            borrowAmount,
            durationInPeriods
        );
        if (addonAmount >= 0) {
            terms.addonAmount = uint256(addonAmount).toUint64();
        }
        uint256 principalAmount = borrowAmount + terms.addonAmount;
        uint32 blockTimestamp = _blockTimestamp().toUint32();

        Loan.State storage loan = _loans[id];
        loan.token = terms.token;
        loan.borrower = borrower;
        loan.programId = programId;
        loan.startTimestamp = blockTimestamp;
        loan.durationInPeriods = terms.durationInPeriods;
        loan.interestRatePrimary = terms.interestRatePrimary;
        loan.interestRateSecondary = terms.interestRateSecondary;
        loan.borrowAmount = borrowAmount.toUint64();
        loan.trackedBalance = principalAmount.toUint64();
        loan.trackedTimestamp = blockTimestamp;
        loan.addonAmount = terms.addonAmount;
        // Other loan fields are zero: repaidAmount, repaidAmount, firstInstallmentId, lateFeeAmount

        ICreditLine(creditLine).onBeforeLoanTaken(id);
        ILiquidityPool(liquidityPool).onBeforeLoanTaken(id);

        emit LoanTaken(id, borrower, principalAmount, terms.durationInPeriods);

        return id;
    }

    /// @inheritdoc ILendingMarket
    function repayLoan(uint256 loanId, uint256 repayAmount) external whenNotPaused onlyOngoingLoan(loanId) {
        _repayLoan(loanId, repayAmount, msg.sender);
    }

    /// @inheritdoc ILendingMarket
    function repayLoanForBatch(
        uint256[] calldata loanIds,
        uint256[] calldata repaymentAmounts,
        address repayer
    ) external whenNotPaused {
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
            _checkSender(msg.sender, _loans[loanId].programId);
            _repayLoan(loanId, repaymentAmounts[i], repayer);
        }
    }

    /// @inheritdoc ILendingMarket
    function discountLoanBatch(uint256[] calldata loanIds, uint256[] calldata discountAmounts) external whenNotPaused {
        uint256 len = loanIds.length;
        if (len != discountAmounts.length) {
            revert Error.ArrayLengthMismatch();
        }
        for (uint256 i = 0; i < len; ++i) {
            uint256 loanId = loanIds[i];
            Loan.State storage loan = _loans[loanId];
            _checkIfLoanOngoing(loanId);
            _checkSender(msg.sender, loan.programId);
            _discountLoan(loanId, loan, discountAmounts[i]);
        }
    }

    /// @dev Updates the loan state and makes the necessary transfers when repaying a loan.
    /// @param loanId The unique identifier of the loan to repay.
    /// @param repaymentAmount The amount to repay.
    /// @param repayer The token source for the repayment or zero if the source is the loan borrower themself.
    function _repayLoan(
        uint256 loanId, // Tools: this comment prevents Prettier from formatting into a single line.
        uint256 repaymentAmount,
        address repayer
    ) internal {
        if (repaymentAmount == 0) {
            revert Error.InvalidAmount();
        }
        Loan.State storage loan = _loans[loanId];
        (uint256 oldOutstandingBalance, uint256 lateFeeAmount, ) = _outstandingBalance(loan, _blockTimestamp());
        uint256 roundedOutstandingBalance = Rounding.roundMath(oldOutstandingBalance, Constants.ACCURACY_FACTOR);
        uint256 newOutstandingBalance = 0; // Full repayment by default

        if (repaymentAmount == type(uint256).max) {
            repaymentAmount = roundedOutstandingBalance;
        } else {
            if (repaymentAmount != Rounding.roundMath(repaymentAmount, Constants.ACCURACY_FACTOR)) {
                revert Error.InvalidAmount();
            }
            if (repaymentAmount > roundedOutstandingBalance) {
                revert Error.InvalidAmount();
            }
            // Not a full repayment
            if (repaymentAmount < roundedOutstandingBalance) {
                newOutstandingBalance = oldOutstandingBalance - repaymentAmount;
            }
            // Else full repayment
        }

        address creditLine = _programCreditLines[loan.programId];
        address liquidityPool = _programLiquidityPools[loan.programId];

        bool autoRepayment = _programLiquidityPools[loan.programId] == msg.sender;
        if (autoRepayment) {
            repayer = loan.borrower;
        }

        loan.repaidAmount += repaymentAmount.toUint64();
        loan.trackedBalance = newOutstandingBalance.toUint64();
        loan.trackedTimestamp = _blockTimestamp().toUint32();
        _updateStoredLateFee(lateFeeAmount, loan);

        IERC20(loan.token).safeTransferFrom(repayer, liquidityPool, repaymentAmount);

        ILiquidityPool(liquidityPool).onAfterLoanPayment(loanId, repaymentAmount);
        ICreditLine(creditLine).onAfterLoanPayment(loanId, repaymentAmount);

        emit LoanRepayment(loanId, repayer, loan.borrower, repaymentAmount, newOutstandingBalance);
    }

    /// @dev Discounts a loan.
    /// @param loanId The unique identifier of the loan to discount.
    /// @param loan The storage state of the loan.
    /// @param discountAmount The amount of the discount.
    function _discountLoan(uint256 loanId, Loan.State storage loan, uint256 discountAmount) internal {
        if (discountAmount == 0) {
            revert Error.InvalidAmount();
        }

        (uint256 oldOutstandingBalance, uint256 lateFeeAmount, ) = _outstandingBalance(loan, _blockTimestamp());
        uint256 roundedOutstandingBalance = Rounding.roundMath(oldOutstandingBalance, Constants.ACCURACY_FACTOR);
        uint256 newOutstandingBalance = 0; // Full discount by default

        if (discountAmount == type(uint256).max) {
            discountAmount = roundedOutstandingBalance;
        } else {
            if (discountAmount != Rounding.roundMath(discountAmount, Constants.ACCURACY_FACTOR)) {
                revert Error.InvalidAmount();
            }
            if (discountAmount > roundedOutstandingBalance) {
                revert Error.InvalidAmount();
            }
            // Not a full discount
            if (discountAmount < roundedOutstandingBalance) {
                newOutstandingBalance = oldOutstandingBalance - discountAmount;
            }
            // Else full discount
        }

        loan.discountAmount += discountAmount.toUint64();
        loan.trackedBalance = newOutstandingBalance.toUint64();
        loan.trackedTimestamp = _blockTimestamp().toUint32();
        _updateStoredLateFee(lateFeeAmount, loan);

        emit LoanDiscounted(loanId, discountAmount, newOutstandingBalance);
    }

    // -------------------------------------------- //
    //  Lender functions                            //
    // -------------------------------------------- //

    /// @inheritdoc ILendingMarket
    function registerCreditLine(address creditLine) external whenNotPaused {
        if (creditLine == address(0)) {
            revert Error.ZeroAddress();
        }
        if (_creditLineLenders[creditLine] != address(0)) {
            revert Error.AlreadyConfigured();
        }
        if (creditLine.code.length == 0) {
            revert ContractAddressInvalid();
        }
        try ICreditLine(creditLine).proveCreditLine() {} catch {
            revert ContractAddressInvalid();
        }

        emit CreditLineRegistered(msg.sender, creditLine);

        _creditLineLenders[creditLine] = msg.sender;
    }

    /// @inheritdoc ILendingMarket
    function registerLiquidityPool(address liquidityPool) external whenNotPaused {
        if (liquidityPool == address(0)) {
            revert Error.ZeroAddress();
        }

        if (_liquidityPoolLenders[liquidityPool] != address(0)) {
            revert Error.AlreadyConfigured();
        }

        if (liquidityPool.code.length == 0) {
            revert ContractAddressInvalid();
        }
        try ILiquidityPool(liquidityPool).proveLiquidityPool() {} catch {
            revert ContractAddressInvalid();
        }

        emit LiquidityPoolRegistered(msg.sender, liquidityPool);

        _liquidityPoolLenders[liquidityPool] = msg.sender;
    }

    /// @inheritdoc ILendingMarket
    function createProgram(
        address creditLine, // Tools: this comment prevents Prettier from formatting into a single line.
        address liquidityPool
    ) external whenNotPaused {
        if (creditLine == address(0)) {
            revert Error.ZeroAddress();
        }
        if (liquidityPool == address(0)) {
            revert Error.ZeroAddress();
        }

        if (_creditLineLenders[creditLine] != msg.sender) {
            revert Error.Unauthorized();
        }
        if (_liquidityPoolLenders[liquidityPool] != msg.sender) {
            revert Error.Unauthorized();
        }

        _programIdCounter++;
        uint32 programId = _programIdCounter;

        emit ProgramCreated(msg.sender, programId);
        emit ProgramUpdated(programId, creditLine, liquidityPool);

        _programLenders[programId] = msg.sender;
        _programCreditLines[programId] = creditLine;
        _programLiquidityPools[programId] = liquidityPool;
    }

    /// @inheritdoc ILendingMarket
    function updateProgram(
        uint32 programId, // Tools: this comment prevents Prettier from formatting into a single line.
        address creditLine,
        address liquidityPool
    ) external whenNotPaused {
        if (programId == 0) {
            revert ProgramNotExist();
        }

        if (_programLenders[programId] != msg.sender) {
            revert Error.Unauthorized();
        }
        if (_creditLineLenders[creditLine] != msg.sender) {
            revert Error.Unauthorized();
        }
        if (_liquidityPoolLenders[liquidityPool] != msg.sender) {
            revert Error.Unauthorized();
        }

        emit ProgramUpdated(programId, creditLine, liquidityPool);

        _programCreditLines[programId] = creditLine;
        _programLiquidityPools[programId] = liquidityPool;
    }

    /// @inheritdoc ILendingMarket
    function freeze(uint256 loanId) external whenNotPaused onlyOngoingLoan(loanId) onlyLenderOrAlias(loanId) {
        Loan.State storage loan = _loans[loanId];

        if (loan.freezeTimestamp != 0) {
            revert LoanAlreadyFrozen();
        }

        loan.freezeTimestamp = _blockTimestamp().toUint32();

        emit LoanFrozen(loanId);
    }

    /// @inheritdoc ILendingMarket
    function unfreeze(uint256 loanId) external whenNotPaused onlyOngoingLoan(loanId) onlyLenderOrAlias(loanId) {
        Loan.State storage loan = _loans[loanId];

        if (loan.freezeTimestamp == 0) {
            revert LoanNotFrozen();
        }

        uint256 blockTimestamp = _blockTimestamp();
        (uint256 outstandingBalance, uint256 lateFeeAmount, ) = _outstandingBalance(loan, blockTimestamp);
        _updateStoredLateFee(lateFeeAmount, loan);
        uint256 currentPeriodIndex = _periodIndex(blockTimestamp, Constants.PERIOD_IN_SECONDS);
        uint256 freezePeriodIndex = _periodIndex(loan.freezeTimestamp, Constants.PERIOD_IN_SECONDS);
        uint256 frozenPeriods = currentPeriodIndex - freezePeriodIndex;

        if (frozenPeriods > 0) {
            loan.durationInPeriods += frozenPeriods.toUint32();
        }
        loan.trackedBalance = outstandingBalance.toUint64();
        loan.trackedTimestamp = blockTimestamp.toUint32();
        loan.freezeTimestamp = 0;

        emit LoanUnfrozen(loanId);
    }

    /// @inheritdoc ILendingMarket
    function updateLoanDuration(
        uint256 loanId,
        uint256 newDurationInPeriods
    ) external whenNotPaused onlyOngoingLoan(loanId) onlyLenderOrAlias(loanId) {
        Loan.State storage loan = _loans[loanId];

        if (newDurationInPeriods <= loan.durationInPeriods) {
            revert InappropriateLoanDuration();
        }

        emit LoanDurationUpdated(loanId, newDurationInPeriods, loan.durationInPeriods);

        loan.durationInPeriods = newDurationInPeriods.toUint32();
    }

    /// @inheritdoc ILendingMarket
    function updateLoanInterestRatePrimary(
        uint256 loanId,
        uint256 newInterestRate
    ) external whenNotPaused onlyOngoingLoan(loanId) onlyLenderOrAlias(loanId) {
        Loan.State storage loan = _loans[loanId];

        if (newInterestRate >= loan.interestRatePrimary) {
            revert InappropriateInterestRate();
        }

        emit LoanInterestRatePrimaryUpdated(loanId, newInterestRate, loan.interestRatePrimary);

        loan.interestRatePrimary = newInterestRate.toUint32();
    }

    /// @inheritdoc ILendingMarket
    function updateLoanInterestRateSecondary(
        uint256 loanId,
        uint256 newInterestRate
    ) external whenNotPaused onlyOngoingLoan(loanId) onlyLenderOrAlias(loanId) {
        Loan.State storage loan = _loans[loanId];

        if (newInterestRate >= loan.interestRateSecondary) {
            revert InappropriateInterestRate();
        }

        emit LoanInterestRateSecondaryUpdated(loanId, newInterestRate, loan.interestRateSecondary);

        loan.interestRateSecondary = newInterestRate.toUint32();
    }

    /// @inheritdoc ILendingMarket
    function configureAlias(address account, bool isAlias) external whenNotPaused {
        if (account == address(0)) {
            revert Error.ZeroAddress();
        }
        if (_hasAlias[msg.sender][account] == isAlias) {
            revert Error.AlreadyConfigured();
        }

        emit LenderAliasConfigured(msg.sender, account, isAlias);

        _hasAlias[msg.sender][account] = isAlias;
    }

    // -------------------------------------------- //
    //  Borrower and lender functions               //
    // -------------------------------------------- //

    /// @inheritdoc ILendingMarket
    function revokeLoan(uint256 loanId) external whenNotPaused onlyOngoingLoan(loanId) {
        Loan.State storage loan = _loans[loanId];
        _checkLoanType(loan, uint256(Loan.Type.Ordinary));
        _revokeLoan(loanId, loan);
        _transferTokensOnLoanRevocation(loan, loan.borrowAmount, loan.addonAmount, loan.repaidAmount);
    }

    /// @inheritdoc ILendingMarket
    function revokeInstallmentLoan(uint256 loanId) external whenNotPaused {
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
            loan.firstInstallmentId, // Tools: this comment prevents Prettier from formatting into a single line.
            loan.installmentCount
        );

        _transferTokensOnLoanRevocation(
            loan,
            installmentLoanPreview.totalBorrowAmount,
            installmentLoanPreview.totalAddonAmount,
            installmentLoanPreview.totalRepaidAmount
        );
    }

    /// @dev Updates the loan state and makes the necessary transfers when revoking a loan.
    /// @param loanId The unique identifier of the loan to revoke.
    /// @param loan The storage state of the loan to update.
    function _revokeLoan(uint256 loanId, Loan.State storage loan) internal {
        _checkLoanRevocationPossibility(loan);

        address creditLine = _programCreditLines[loan.programId];
        address liquidityPool = _programLiquidityPools[loan.programId];

        loan.trackedBalance = 0;
        loan.trackedTimestamp = _blockTimestamp().toUint32();

        ILiquidityPool(liquidityPool).onAfterLoanRevocation(loanId);
        ICreditLine(creditLine).onAfterLoanRevocation(loanId);

        emit LoanRevoked(loanId);
    }

    // -------------------------------------------- //
    //  View functions                              //
    // -------------------------------------------- //

    /// @inheritdoc ILendingMarket
    function getProgramLender(uint32 programId) external view returns (address) {
        return _programLenders[programId];
    }

    /// @inheritdoc ILendingMarket
    function getProgramCreditLine(uint32 programId) external view returns (address) {
        return _programCreditLines[programId];
    }

    /// @inheritdoc ILendingMarket
    function getProgramLiquidityPool(uint32 programId) external view returns (address) {
        return _programLiquidityPools[programId];
    }

    /// @inheritdoc ILendingMarket
    function getCreditLineLender(address creditLine) external view returns (address) {
        return _creditLineLenders[creditLine];
    }

    /// @inheritdoc ILendingMarket
    function getLiquidityPoolLender(address liquidityPool) external view returns (address) {
        return _liquidityPoolLenders[liquidityPool];
    }

    /// @inheritdoc ILendingMarket
    function getLoanState(uint256 loanId) external view returns (Loan.State memory) {
        return _loans[loanId];
    }

    /// @inheritdoc ILendingMarket
    function getLoanPreview(uint256 loanId, uint256 timestamp) external view returns (Loan.Preview memory) {
        if (timestamp == 0) {
            timestamp = _blockTimestamp();
        }

        return _getLoanPreview(loanId, timestamp);
    }

    /// @inheritdoc ILendingMarket
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

    /// @inheritdoc ILendingMarket
    function getInstallmentLoanPreview(
        uint256 loanId,
        uint256 timestamp
    ) external view returns (Loan.InstallmentLoanPreview memory) {
        return _getInstallmentLoanPreview(loanId, timestamp);
    }

    /// @inheritdoc ILendingMarket
    function isLenderOrAlias(uint256 loanId, address account) public view returns (bool) {
        return isProgramLenderOrAlias(_loans[loanId].programId, account);
    }

    /// @inheritdoc ILendingMarket
    function isProgramLenderOrAlias(uint32 programId, address account) public view returns (bool) {
        address lender = _programLenders[programId];
        return account == lender || _hasAlias[lender][account];
    }

    /// @inheritdoc ILendingMarket
    function hasAlias(address lender, address account) external view returns (bool) {
        return _hasAlias[lender][account];
    }

    /// @inheritdoc ILendingMarket
    function interestRateFactor() external pure returns (uint256) {
        return Constants.INTEREST_RATE_FACTOR;
    }

    /// @inheritdoc ILendingMarket
    function periodInSeconds() external pure returns (uint256) {
        return Constants.PERIOD_IN_SECONDS;
    }

    /// @inheritdoc ILendingMarket
    function timeOffset() external pure returns (uint256, bool) {
        return (Constants.NEGATIVE_TIME_OFFSET, false);
    }

    /// @inheritdoc ILendingMarket
    function loanCounter() external view returns (uint256) {
        return _loanIdCounter;
    }

    /// @inheritdoc ILendingMarket
    function programCounter() external view returns (uint256) {
        return _programIdCounter;
    }

    // -------------------------------------------- //
    //  Pure functions                              //
    // -------------------------------------------- //

    /// @dev Calculates the period index that corresponds the specified timestamp.
    /// @param timestamp The timestamp to calculate the period index.
    /// @param periodInSeconds_ The period duration in seconds.
    function calculatePeriodIndex(uint256 timestamp, uint256 periodInSeconds_) external pure returns (uint256) {
        return _periodIndex(timestamp, periodInSeconds_);
    }

    /// @dev Calculates the outstanding balance of a loan.
    /// @param originalBalance The balance of the loan at the beginning.
    /// @param numberOfPeriods The number of periods to calculate the outstanding balance.
    /// @param interestRate The interest rate applied to the loan.
    /// @param interestRateFactor_ The interest rate factor.
    function calculateOutstandingBalance(
        uint256 originalBalance,
        uint256 numberOfPeriods,
        uint256 interestRate,
        uint256 interestRateFactor_
    ) external pure returns (uint256) {
        return
            InterestMath.calculateOutstandingBalance(
                originalBalance,
                numberOfPeriods,
                interestRate,
                interestRateFactor_
            );
    }

    // -------------------------------------------- //
    //  Internal functions                          //
    // -------------------------------------------- //

    /// @dev Validates the main parameters of the loan.
    /// @param borrower The address of the borrower.
    /// @param programId The ID of the lending program.
    /// @param borrowAmount The amount to borrow.
    /// @param addonAmount The addon amount of the loan.
    function _checkMainLoanParameters(
        address borrower,
        uint32 programId,
        uint256 borrowAmount,
        uint256 addonAmount
    ) internal pure {
        if (programId == 0) {
            revert ProgramNotExist();
        }
        if (borrower == address(0)) {
            revert Error.ZeroAddress();
        }
        if (borrowAmount == 0) {
            revert Error.InvalidAmount();
        }
        if (borrowAmount != Rounding.roundMath(borrowAmount, Constants.ACCURACY_FACTOR)) {
            revert Error.InvalidAmount();
        }
        if (addonAmount != Rounding.roundMath(addonAmount, Constants.ACCURACY_FACTOR)) {
            revert Error.InvalidAmount();
        }
    }

    /// @dev Checks if the sender is authorized for the given program.
    /// @param sender The address to check.
    /// @param programId The ID of the lending program.
    function _checkSender(address sender, uint32 programId) internal view {
        if (!isProgramLenderOrAlias(programId, sender)) {
            revert Error.Unauthorized();
        }
    }

    /// @dev Calculates the sum of all elements in an calldata array.
    /// @param values Array of amounts to sum.
    /// @return The total sum of all array elements.
    function _sumArray(uint256[] calldata values) internal pure returns (uint256) {
        uint256 len = values.length;
        uint256 sum = 0;
        for (uint256 i = 0; i < len; ++i) {
            sum += values[i];
        }
        return sum;
    }

    /// @dev Validates the loan durations in the array.
    /// @param durationsInPeriods Array of loan durations in periods.
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

    /// @dev Ensures the installment count is within the valid range.
    /// @param installmentCount The number of installments to check.
    function _checkInstallmentCount(uint256 installmentCount) internal view {
        if (installmentCount > _installmentCountMax()) {
            revert InstallmentCountExcess();
        }
    }

    /// @dev Updates the loan installment data in storage.
    /// @param loanId The ID of the loan to update.
    /// @param firstInstallmentId The ID of the first installment.
    /// @param installmentCount The total number of installments.
    function _updateLoanInstallmentData(
        uint256 loanId, // Tools: this comment prevents Prettier from formatting into a single line.
        uint256 firstInstallmentId,
        uint256 installmentCount
    ) internal {
        Loan.State storage loan = _loans[loanId];
        loan.firstInstallmentId = uint40(firstInstallmentId); // Unchecked conversion is safe due to contract logic
        loan.installmentCount = uint8(installmentCount); // Unchecked conversion is safe due to contract logic
    }

    /// @dev Validates that the loan ID is within the valid range.
    /// @param id The loan ID to check.
    function _checkLoanId(uint256 id) internal pure {
        if (id > type(uint40).max) {
            revert LoanIdExcess();
        }
    }

    /// @dev Checks if the loan can be revoked.
    /// @param loan The storage state of the loan.
    function _checkLoanRevocationPossibility(Loan.State storage loan) internal view {
        address sender = msg.sender;
        if (sender == loan.borrower) {
            uint256 currentPeriodIndex = _periodIndex(_blockTimestamp(), Constants.PERIOD_IN_SECONDS);
            uint256 startPeriodIndex = _periodIndex(loan.startTimestamp, Constants.PERIOD_IN_SECONDS);
            if (currentPeriodIndex - startPeriodIndex >= Constants.COOLDOWN_IN_PERIODS) {
                revert CooldownPeriodHasPassed();
            }
        } else if (!isProgramLenderOrAlias(loan.programId, sender)) {
            revert Error.Unauthorized();
        }
    }

    /// @dev Checks if the loan exists.
    /// @param loan The storage state of the loan.
    function _checkLoanExistence(Loan.State storage loan) internal view {
        if (loan.token == address(0)) {
            revert LoanNotExist();
        }
    }

    /// @dev Checks if a loan with the specified ID is ongoing.
    /// @param loanId The ID of the loan.
    function _checkIfLoanOngoing(uint256 loanId) internal view {
        Loan.State storage loan = _loans[loanId];
        _checkLoanExistence(loan);
        if (_isRepaid(loan)) {
            revert LoanAlreadyRepaid();
        }
    }

    /// @dev Checks if the loan type is correct.
    /// @param loan The storage state of the loan.
    /// @param expectedLoanType The expected type of the loan according to the `Loan.Type` enum.
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

    /// @dev Calculates the outstanding balance of a loan.
    /// @param loan The loan to calculate the outstanding balance for.
    /// @param timestamp The timestamp to calculate the outstanding balance at.
    /// @return outstandingBalance The outstanding balance of the loan at the specified timestamp.
    /// @return lateFeeAmount The late fee amount or zero if the loan is not defaulted at the specified timestamp.
    /// @return periodIndex The period index that corresponds the provided timestamp.
    function _outstandingBalance(
        Loan.State storage loan,
        uint256 timestamp
    ) internal view returns (uint256 outstandingBalance, uint256 lateFeeAmount, uint256 periodIndex) {
        outstandingBalance = loan.trackedBalance;

        if (loan.freezeTimestamp != 0) {
            timestamp = loan.freezeTimestamp;
        }

        periodIndex = _periodIndex(timestamp, Constants.PERIOD_IN_SECONDS);
        uint256 trackedPeriodIndex = _periodIndex(loan.trackedTimestamp, Constants.PERIOD_IN_SECONDS);

        if (periodIndex > trackedPeriodIndex) {
            uint256 duePeriodIndex = _getDuePeriodIndex(loan.startTimestamp, loan.durationInPeriods);
            if (trackedPeriodIndex <= duePeriodIndex) {
                if (periodIndex <= duePeriodIndex) {
                    outstandingBalance = InterestMath.calculateOutstandingBalance(
                        outstandingBalance,
                        periodIndex - trackedPeriodIndex,
                        loan.interestRatePrimary,
                        Constants.INTEREST_RATE_FACTOR
                    );
                } else {
                    outstandingBalance = InterestMath.calculateOutstandingBalance(
                        outstandingBalance,
                        duePeriodIndex - trackedPeriodIndex,
                        loan.interestRatePrimary,
                        Constants.INTEREST_RATE_FACTOR
                    );
                    lateFeeAmount = _calculateLateFee(outstandingBalance, loan);
                    outstandingBalance += lateFeeAmount;
                    outstandingBalance = InterestMath.calculateOutstandingBalance(
                        outstandingBalance,
                        periodIndex - duePeriodIndex,
                        loan.interestRateSecondary,
                        Constants.INTEREST_RATE_FACTOR
                    );
                }
            } else {
                outstandingBalance = InterestMath.calculateOutstandingBalance(
                    outstandingBalance,
                    periodIndex - trackedPeriodIndex,
                    loan.interestRateSecondary,
                    Constants.INTEREST_RATE_FACTOR
                );
            }
        }
    }

    /// @dev Calculates the loan preview.
    /// @param loanId The ID of the loan.
    /// @param timestamp The timestamp to calculate the preview at.
    /// @return The loan preview.
    function _getLoanPreview(uint256 loanId, uint256 timestamp) internal view returns (Loan.Preview memory) {
        Loan.Preview memory preview;
        Loan.State storage loan = _loans[loanId];

        (preview.trackedBalance /* skip the late fee */, , preview.periodIndex) = _outstandingBalance(loan, timestamp);
        preview.outstandingBalance = Rounding.roundMath(preview.trackedBalance, Constants.ACCURACY_FACTOR);

        return preview;
    }

    /// @dev Calculates the loan extended preview.
    /// @param loanId The ID of the loan.
    /// @param timestamp The timestamp to calculate the preview at.
    /// @return The loan extended preview.
    function _getLoanPreviewExtended(
        uint256 loanId,
        uint256 timestamp
    ) internal view returns (Loan.PreviewExtended memory) {
        Loan.PreviewExtended memory preview;
        Loan.State storage loan = _loans[loanId];

        (preview.trackedBalance, preview.lateFeeAmount, preview.periodIndex) = _outstandingBalance(loan, timestamp);
        preview.outstandingBalance = Rounding.roundMath(preview.trackedBalance, Constants.ACCURACY_FACTOR);
        preview.borrowAmount = loan.borrowAmount;
        preview.addonAmount = loan.addonAmount;
        preview.repaidAmount = loan.repaidAmount;
        preview.discountAmount = loan.discountAmount;
        preview.lateFeeAmount += loan.lateFeeAmount;
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

    /// @dev Calculates the installment loan preview.
    /// @param loanId The ID of the loan.
    /// @param timestamp The timestamp to calculate the preview at.
    /// @return The installment loan preview.
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
            preview.totalBorrowAmount += singleLoanPreview.borrowAmount;
            preview.totalAddonAmount += singleLoanPreview.addonAmount;
            preview.totalRepaidAmount += singleLoanPreview.repaidAmount;
            preview.totalDiscountAmount += singleLoanPreview.discountAmount;
            preview.totalLateFeeAmount += singleLoanPreview.lateFeeAmount;
            preview.installmentPreviews[i] = singleLoanPreview;
            ++loanId;
        }
        preview.periodIndex = singleLoanPreview.periodIndex;

        return preview;
    }

    /// @dev Calculates the due period index for a loan.
    /// @param startTimestamp The start timestamp of the loan.
    /// @param durationInPeriods The duration of the loan in periods.
    /// @return The due period index.
    function _getDuePeriodIndex(uint256 startTimestamp, uint256 durationInPeriods) internal pure returns (uint256) {
        uint256 startPeriodIndex = _periodIndex(startTimestamp, Constants.PERIOD_IN_SECONDS);
        return startPeriodIndex + durationInPeriods;
    }

    /// @dev Checks if the loan is repaid.
    /// @param loan The storage state of the loan.
    /// @return True if the loan is repaid, false otherwise.
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

    /// @dev Calculates the late fee amount for a loan.
    /// @param outstandingBalance The outstanding balance of the loan.
    /// @param loan The storage state of the loan.
    /// @return The late fee amount.
    function _calculateLateFee(
        uint256 outstandingBalance, // Tools: this comment prevents Prettier from formatting into a single line.
        Loan.State storage loan
    ) internal view returns (uint256) {
        address creditLine = _programCreditLines[loan.programId];
        uint256 lateFeeRate = creditLine != address(0) ? ICreditLine(creditLine).lateFeeRate() : 0;
        uint256 product = outstandingBalance * lateFeeRate;
        uint256 reminder = product % Constants.INTEREST_RATE_FACTOR;
        uint256 result = product / Constants.INTEREST_RATE_FACTOR;
        if (reminder >= (Constants.INTEREST_RATE_FACTOR / 2)) {
            ++result;
        }
        return result;
    }

    /// @dev Updates the stored late fee amount for a loan.
    /// @param lateFeeAmount The late fee amount to store.
    /// @param loan The storage state of the loan.
    function _updateStoredLateFee(uint256 lateFeeAmount, Loan.State storage loan) internal {
        if (lateFeeAmount > 0) {
            loan.lateFeeAmount = lateFeeAmount.toUint64();
        }
    }

    /// @dev Transfers tokens from the liquidity pool to the borrower and the addon treasury.
    /// @param loanId The ID of the loan.
    /// @param borrowAmount The amount of tokens to borrow.
    /// @param addonAmount The addon amount of the loan.
    function _transferTokensOnLoanTaking(uint256 loanId, uint256 borrowAmount, uint256 addonAmount) internal {
        Loan.State storage loan = _loans[loanId];
        address liquidityPool = _programLiquidityPools[loan.programId];
        address token = loan.token;
        address addonTreasury = ILiquidityPool(liquidityPool).addonTreasury();
        address borrower = loan.borrower;
        IERC20(token).safeTransferFrom(liquidityPool, borrower, borrowAmount + addonAmount);
        if (addonTreasury != address(0)) {
            IERC20(token).safeTransferFrom(borrower, addonTreasury, addonAmount);
        } else {
            IERC20(token).safeTransferFrom(borrower, liquidityPool, addonAmount);
        }
    }

    /// @dev Transfers tokens from the borrower and the addon treasury back to the liquidity pool.
    /// @param loan The storage state of the loan.
    /// @param borrowAmount The amount of tokens to borrow.
    /// @param addonAmount The addon amount of the loan.
    /// @param repaidAmount The repaid amount of the loan.
    function _transferTokensOnLoanRevocation(
        Loan.State storage loan,
        uint256 borrowAmount,
        uint256 addonAmount,
        uint256 repaidAmount
    ) internal {
        address liquidityPool = _programLiquidityPools[loan.programId];
        address token = loan.token;
        address addonTreasury = ILiquidityPool(liquidityPool).addonTreasury();
        address borrower = loan.borrower;

        if (addonTreasury != address(0)) {
            IERC20(token).safeTransferFrom(addonTreasury, borrower, addonAmount);
            borrowAmount += addonAmount; // Reuse the 'borrowAmount' as the principal amount
        }
        if (repaidAmount < borrowAmount) {
            IERC20(loan.token).safeTransferFrom(borrower, liquidityPool, borrowAmount - repaidAmount);
        } else if (repaidAmount != borrowAmount) {
            IERC20(loan.token).safeTransferFrom(liquidityPool, borrower, repaidAmount - borrowAmount);
        }

    }

    /// @inheritdoc ILendingMarket
    function proveLendingMarket() external pure {}
}
