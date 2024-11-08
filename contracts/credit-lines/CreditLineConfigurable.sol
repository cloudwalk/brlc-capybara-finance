// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

import { Loan } from "../common/libraries/Loan.sol";
import { Error } from "../common/libraries/Error.sol";
import { Round } from "../common/libraries/Round.sol";
import { SafeCast } from "../common/libraries/SafeCast.sol";
import { Constants } from "../common/libraries/Constants.sol";

import { ICreditLine } from "../common/interfaces/core/ICreditLine.sol";
import { ILendingMarket } from "../common/interfaces/core/ILendingMarket.sol";
import { ICreditLineConfigurable } from "../common/interfaces/ICreditLineConfigurable.sol";
import { AccessControlExtUpgradeable } from "../common/AccessControlExtUpgradeable.sol";
import { Versionable } from "../common/Versionable.sol";

/// @title CreditLineConfigurable contract
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Implementation of the configurable credit line contract.
contract CreditLineConfigurable is
    AccessControlExtUpgradeable,
    PausableUpgradeable,
    ICreditLineConfigurable,
    Versionable
{
    using SafeCast for uint256;

    /// @dev The role of this contract owner.
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");

    /// @dev The role of this contract admin.
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    /// @dev The role of this contract pauser.
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // -------------------------------------------- //
    //  Storage variables                           //
    // -------------------------------------------- //

    /// @dev The address of the underlying token.
    address internal _token;

    /// @dev The address of the associated market.
    address internal _market;

    /// @dev The structure of the credit line configuration.
    CreditLineConfig internal _config;

    /// @dev The mapping of borrower to borrower configuration.
    mapping(address => BorrowerConfig) internal _borrowerConfigs;

    /// @dev The mapping of a borrower to the borrower state.
    mapping(address => BorrowerState) internal _borrowerStates;

    MigrationState internal _migrationState;

    /// @dev This empty reserved space is put in place to allow future versions
    /// to add new variables without shifting down storage in the inheritance chain.
    uint256[44] private __gap;

    // -------------------------------------------- //
    //  Errors                                      //
    // -------------------------------------------- //

    /// @dev Thrown when the credit line configuration is invalid.
    error InvalidCreditLineConfiguration();

    /// @dev Thrown when the borrower configuration is invalid.
    error InvalidBorrowerConfiguration();

    /// @dev Thrown when the borrower configuration has expired.
    error BorrowerConfigurationExpired();

    /// @dev Thrown when the loan duration is out of range.
    error LoanDurationOutOfRange();

    /// @dev Thrown when another loan is requested by an account but only one active loan is allowed.
    error LimitViolationOnSingleActiveLoan();

    /// @dev Thrown when the total borrowed amount of active loans exceeds the maximum borrow amount of a single loan.
    error LimitViolationOnTotalActiveLoanAmount(uint256 newTotalActiveLoanAmount);

    /// @dev Thrown when the borrower state counters or amounts would overflow their maximum values.
    error BorrowerStateOverflow();

    // -------------------------------------------- //
    //  Modifiers                                   //
    // -------------------------------------------- //

    /// @dev Throws if called by any account other than the lending market.
    modifier onlyMarket() {
        if (msg.sender != _market) {
            revert Error.Unauthorized();
        }
        _;
    }

    // -------------------------------------------- //
    //  Initializers                                //
    // -------------------------------------------- //

    /// @dev Initializer of the upgradable contract.
    /// @param lender_ The address of the credit line lender.
    /// @param market_ The address of the lending market.
    /// @param token_ The address of the token.
    /// See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
    function initialize(
        address lender_, // Tools: this comment prevents Prettier from formatting into a single line.
        address market_,
        address token_
    ) external initializer {
        __CreditLineConfigurable_init(lender_, market_, token_);
    }

    /// @dev Internal initializer of the upgradable contract.
    /// @param lender_ The address of the credit line lender.
    /// @param market_ The address of the lending market.
    /// @param token_ The address of the token.
    /// See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
    function __CreditLineConfigurable_init(
        address lender_, // Tools: this comment prevents Prettier from formatting into a single line.
        address market_,
        address token_
    ) internal onlyInitializing {
        __Context_init_unchained();
        __ERC165_init_unchained();
        __AccessControl_init_unchained();
        __AccessControlExt_init_unchained();
        __Pausable_init_unchained();
        __CreditLineConfigurable_init_unchained(lender_, market_, token_);
    }

    /// @dev Unchained internal initializer of the upgradable contract.
    /// @param lender_ The address of the credit line lender.
    /// @param market_ The address of the lending market.
    /// @param token_ The address of the token.
    /// See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
    function __CreditLineConfigurable_init_unchained(
        address lender_,
        address market_,
        address token_
    ) internal onlyInitializing {
        if (lender_ == address(0)) {
            revert Error.ZeroAddress();
        }
        if (market_ == address(0)) {
            revert Error.ZeroAddress();
        }
        if (token_ == address(0)) {
            revert Error.ZeroAddress();
        }

        _grantRole(OWNER_ROLE, lender_);
        _setRoleAdmin(ADMIN_ROLE, OWNER_ROLE);
        _setRoleAdmin(PAUSER_ROLE, OWNER_ROLE);

        _market = market_;
        _token = token_;
    }

    // -------------------------------------------- //
    //  Pauser functions                            //
    // -------------------------------------------- //

    /// @dev Pauses the contract.
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @dev Unpauses the contract.
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // -------------------------------------------- //
    //  Owner functions                             //
    // -------------------------------------------- //

    /// @inheritdoc ICreditLineConfigurable
    function configureCreditLine(CreditLineConfig memory config) external onlyRole(OWNER_ROLE) {
        if (config.minBorrowAmount > config.maxBorrowAmount) {
            revert InvalidCreditLineConfiguration();
        }
        if (config.minDurationInPeriods > config.maxDurationInPeriods) {
            revert InvalidCreditLineConfiguration();
        }
        if (config.minInterestRatePrimary > config.maxInterestRatePrimary) {
            revert InvalidCreditLineConfiguration();
        }
        if (config.minInterestRateSecondary > config.maxInterestRateSecondary) {
            revert InvalidCreditLineConfiguration();
        }
        if (config.minAddonFixedRate > config.maxAddonFixedRate) {
            revert InvalidCreditLineConfiguration();
        }
        if (config.minAddonPeriodRate > config.maxAddonPeriodRate) {
            revert InvalidCreditLineConfiguration();
        }

        _config = config;

        emit CreditLineConfigured(address(this));
    }

    // -------------------------------------------- //
    //  Admin functions                             //
    // -------------------------------------------- //

    /// @inheritdoc ICreditLineConfigurable
    function configureBorrower(
        address borrower,
        BorrowerConfig memory config
    ) external whenNotPaused onlyRole(ADMIN_ROLE) {
        if (_migrationState.borrowerConfigurationPaused) {
            revert EnforcedPause();
        }
        _configureBorrower(borrower, config);
    }

    /// @inheritdoc ICreditLineConfigurable
    function configureBorrowers(
        address[] memory borrowers,
        BorrowerConfig[] memory configs
    ) external whenNotPaused onlyRole(ADMIN_ROLE) {
        if (_migrationState.borrowerConfigurationPaused) {
            revert EnforcedPause();
        }
        if (borrowers.length != configs.length) {
            revert Error.ArrayLengthMismatch();
        }

        for (uint256 i = 0; i < borrowers.length; i++) {
            _configureBorrower(borrowers[i], configs[i]);
        }
    }

    // -------------------------------------------- //
    //  Market functions                            //
    // -------------------------------------------- //

    /// @inheritdoc ICreditLine
    function onBeforeLoanTaken(uint256 loanId) external whenNotPaused onlyMarket returns (bool) {
        Loan.State memory loan = ILendingMarket(_market).getLoanState(loanId);
        _openLoan(loan);
        return true;
    }

    function onAfterLoanPayment(uint256 loanId, uint256 repayAmount) external whenNotPaused onlyMarket returns (bool) {
        repayAmount; // To prevent compiler warning about unused variable

        Loan.State memory loan = ILendingMarket(_market).getLoanState(loanId);
        if (loan.trackedBalance == 0) {
            _closeLoan(loan);
        }

        return true;
    }

    function onAfterLoanRevocation(uint256 loanId) external whenNotPaused onlyMarket returns (bool) {
        Loan.State memory loan = ILendingMarket(_market).getLoanState(loanId);
        _closeLoan(loan);
        return true;
    }

    // -------------------------------------------- //
    //  View functions                              //
    // -------------------------------------------- //

    /// @inheritdoc ICreditLine
    function determineLoanTerms(
        address borrower,
        uint256 borrowAmount,
        uint256 durationInPeriods
    ) public view returns (Loan.Terms memory terms) {
        if (borrower == address(0)) {
            revert Error.ZeroAddress();
        }
        if (borrowAmount == 0) {
            revert Error.InvalidAmount();
        }

        BorrowerConfig storage borrowerConfig = _borrowerConfigs[borrower];

        if (_blockTimestamp() > borrowerConfig.expiration) {
            revert BorrowerConfigurationExpired();
        }
        if (borrowAmount > borrowerConfig.maxBorrowAmount) {
            revert Error.InvalidAmount();
        }
        if (borrowAmount < borrowerConfig.minBorrowAmount) {
            revert Error.InvalidAmount();
        }
        if (durationInPeriods < borrowerConfig.minDurationInPeriods) {
            revert LoanDurationOutOfRange();
        }
        if (durationInPeriods > borrowerConfig.maxDurationInPeriods) {
            revert LoanDurationOutOfRange();
        }

        terms.token = _token;
        terms.durationInPeriods = durationInPeriods.toUint32();
        terms.interestRatePrimary = borrowerConfig.interestRatePrimary;
        terms.interestRateSecondary = borrowerConfig.interestRateSecondary;
        uint256 addonAmount = calculateAddonAmount(
            borrowAmount,
            durationInPeriods,
            borrowerConfig.addonFixedRate,
            borrowerConfig.addonPeriodRate,
            Constants.INTEREST_RATE_FACTOR
        );
        terms.addonAmount = Round.roundUp(addonAmount, Constants.ACCURACY_FACTOR).toUint64();
    }

    /// @inheritdoc ICreditLineConfigurable
    function getBorrowerConfiguration(address borrower) external view override returns (BorrowerConfig memory) {
        return _borrowerConfigs[borrower];
    }

    /// @inheritdoc ICreditLineConfigurable
    function getBorrowerState(address borrower) external view returns (BorrowerState memory) {
        return _borrowerStates[borrower];
    }

    /// @inheritdoc ICreditLineConfigurable
    function creditLineConfiguration() external view override returns (CreditLineConfig memory) {
        return _config;
    }

    /// @inheritdoc ICreditLineConfigurable
    function isAdmin(address account) external view returns (bool) {
        return hasRole(ADMIN_ROLE, account);
    }

    /// @inheritdoc ICreditLine
    function market() external view returns (address) {
        return _market;
    }

    /// @inheritdoc ICreditLine
    function token() external view returns (address) {
        return _token;
    }

    /// @dev Calculates the amount of a loan addon (extra charges or fees).
    /// @param amount The initial principal amount of the loan.
    /// @param durationInPeriods The duration of the loan in periods.
    /// @param addonFixedRate The fixed rate of the loan addon (extra charges or fees).
    /// @param addonPeriodRate The rate per period of the loan addon (extra charges or fees).
    /// @param interestRateFactor The rate factor used together with interest rate.
    /// @return The amount of the addon.
    function calculateAddonAmount(
        uint256 amount,
        uint256 durationInPeriods,
        uint256 addonFixedRate,
        uint256 addonPeriodRate,
        uint256 interestRateFactor
    ) public pure returns (uint256) {
        /// The initial formula for calculating the amount of the loan addon (extra charges or fees) is:
        /// E = (A + E) * r (1)
        /// where `A` -- the borrow amount, `E` -- addon, `r` -- the result addon rate (e.g. `1 %` => `0.01`),
        /// Formula (1) can be rewritten as:
        /// E = A * r / (1 - r) = A * (R / F) / (1 - R / F) = A * R (F - R) (2)
        /// where `R` -- the addon rate in units of the rate factor, `F` -- the interest rate factor.
        uint256 addonRate = addonPeriodRate * durationInPeriods + addonFixedRate;
        return (amount * addonRate) / (interestRateFactor - addonRate);
    }

    // -------------------------------------------- //
    //  Internal functions                          //
    // -------------------------------------------- //

    /// @dev Updates the configuration of a borrower.
    /// @param borrower The address of the borrower to configure.
    /// @param config The new borrower configuration to be applied.
    function _configureBorrower(address borrower, BorrowerConfig memory config) internal {
        if (borrower == address(0)) {
            revert Error.ZeroAddress();
        }

        // NOTE: We don't check for expiration here, because
        // it can be used for disabling a borrower by setting it to 0.

        if (config.minBorrowAmount > config.maxBorrowAmount) {
            revert InvalidBorrowerConfiguration();
        }
        if (config.minBorrowAmount < _config.minBorrowAmount) {
            revert InvalidBorrowerConfiguration();
        }
        if (config.maxBorrowAmount > _config.maxBorrowAmount) {
            revert InvalidBorrowerConfiguration();
        }

        if (config.minDurationInPeriods > config.maxDurationInPeriods) {
            revert InvalidBorrowerConfiguration();
        }
        if (config.minDurationInPeriods < _config.minDurationInPeriods) {
            revert InvalidBorrowerConfiguration();
        }
        if (config.maxDurationInPeriods > _config.maxDurationInPeriods) {
            revert InvalidBorrowerConfiguration();
        }

        if (config.interestRatePrimary < _config.minInterestRatePrimary) {
            revert InvalidBorrowerConfiguration();
        }
        if (config.interestRatePrimary > _config.maxInterestRatePrimary) {
            revert InvalidBorrowerConfiguration();
        }

        if (config.interestRateSecondary < _config.minInterestRateSecondary) {
            revert InvalidBorrowerConfiguration();
        }
        if (config.interestRateSecondary > _config.maxInterestRateSecondary) {
            revert InvalidBorrowerConfiguration();
        }

        if (config.addonFixedRate < _config.minAddonFixedRate) {
            revert InvalidBorrowerConfiguration();
        }
        if (config.addonFixedRate > _config.maxAddonFixedRate) {
            revert InvalidBorrowerConfiguration();
        }

        if (config.addonPeriodRate < _config.minAddonPeriodRate) {
            revert InvalidBorrowerConfiguration();
        }
        if (config.addonPeriodRate > _config.maxAddonPeriodRate) {
            revert InvalidBorrowerConfiguration();
        }

        _borrowerConfigs[borrower] = config;

        emit BorrowerConfigured(address(this), borrower);
    }

    /// @dev Returns the current block timestamp with the time offset applied.
    function _blockTimestamp() private view returns (uint256) {
        return block.timestamp - Constants.NEGATIVE_TIME_OFFSET;
    }

    /// @dev Executes additional checks and updates the borrower structures when a loan is opened.
    /// @param loan The state of the loan that is being opened.
    function _openLoan(Loan.State memory loan) internal {
        BorrowerConfig storage borrowerConfig = _borrowerConfigs[loan.borrower];

        if (_migrationState.done) {
            BorrowerState storage borrowerState = _borrowerStates[loan.borrower];
            if (borrowerConfig.borrowPolicy == BorrowPolicy.SingleActiveLoan) {
                if (borrowerState.activeLoanCount > 0) {
                    revert LimitViolationOnSingleActiveLoan();
                }
            } else if (borrowerConfig.borrowPolicy == BorrowPolicy.TotalActiveAmountLimit) {
                uint256 newTotalActiveLoanAmount = loan.borrowAmount + borrowerState.totalActiveLoanAmount;
                if (newTotalActiveLoanAmount > borrowerConfig.maxBorrowAmount) {
                    revert LimitViolationOnTotalActiveLoanAmount(newTotalActiveLoanAmount);
                }
            } // else borrowerConfig.borrowPolicy == BorrowPolicy.MultipleActiveLoans

            unchecked {
                uint256 newActiveLoanCount = uint256(borrowerState.activeLoanCount) + 1;
                uint256 newTotalActiveLoanAmount = uint256(borrowerState.totalActiveLoanAmount) + loan.borrowAmount;
                if (
                    newActiveLoanCount + borrowerState.closedLoanCount > type(uint16).max ||
                    newTotalActiveLoanAmount + borrowerState.totalClosedLoanAmount > type(uint64).max
                ) {
                    revert BorrowerStateOverflow();
                }
                borrowerState.activeLoanCount = uint16(newActiveLoanCount);
                borrowerState.totalActiveLoanAmount = uint64(newTotalActiveLoanAmount);
            }
        } else {
            if (borrowerConfig.borrowPolicy == BorrowPolicy.MultipleActiveLoans) {
                // Do nothing to the borrower's max borrow amount configuration
            } else if (borrowerConfig.borrowPolicy == BorrowPolicy.TotalActiveAmountLimit) {
                borrowerConfig.maxBorrowAmount -= loan.borrowAmount;
            } else {
                // borrowerConfig.borrowPolicy == BorrowPolicy.SingleActiveLoan
                borrowerConfig.maxBorrowAmount = 0;
            }
        }
    }

    /// @dev Updates the borrower structures when a loan is closed.
    /// @param loan The state of the loan thai is being closed.
    function _closeLoan(Loan.State memory loan) internal {
        if (_migrationState.done) {
            BorrowerState storage borrowerState = _borrowerStates[loan.borrower];
            borrowerState.activeLoanCount -= 1;
            borrowerState.closedLoanCount += 1;
            borrowerState.totalActiveLoanAmount -= loan.borrowAmount;
            borrowerState.totalClosedLoanAmount += loan.borrowAmount;
        } else {
            BorrowerConfig storage borrowerConfig = _borrowerConfigs[loan.borrower];
            if (borrowerConfig.borrowPolicy == BorrowPolicy.TotalActiveAmountLimit) {
                borrowerConfig.maxBorrowAmount += loan.borrowAmount;
            }
        }
    }

    // -------------------------------------------- //
    //  Migration service functions                 //
    // -------------------------------------------- //

    /// @dev Migrates the borrower state from the old logic to the new one.
    /// @param loanIdCount The number of loan IDs to migrate.
    function migrateBorrowerState(uint256 loanIdCount) public {
        uint256 loanId = _migrationState.nextLoanId;
        if (loanIdCount > type(uint256).max - loanId) {
            loanIdCount = type(uint256).max - loanId;
        }
        uint256 endLoanId = ILendingMarket(_market).loanCounter();
        if (loanId + loanIdCount < endLoanId) {
            endLoanId = loanId + loanIdCount;
        }
        for (; loanId < endLoanId; ++loanId) {
            Loan.State memory loan = ILendingMarket(_market).getLoanState(loanId);
            BorrowerState storage state = _borrowerStates[loan.borrower];
            if (loan.trackedBalance != 0) {
                state.activeLoanCount += 1;
                state.totalActiveLoanAmount += loan.borrowAmount;
            } else {
                state.closedLoanCount += 1;
                state.totalClosedLoanAmount += loan.borrowAmount;
            }
        }
        _migrationState.nextLoanId = uint128(endLoanId);
    }

    /// @dev Migrates the loan limitation logic from the old logic to the new one.
    function migrateLoanLimitationLogic() external onlyRole(ADMIN_ROLE) {
        if (!_migrationState.done) {
            migrateBorrowerState(type(uint256).max);
            _migrationState.done = true;
        }
    }

    /// @dev TODO
    function setBorrowerConfigurationPause(bool newPausedState) external onlyRole(ADMIN_ROLE) {
        if (!_migrationState.done) {
            return;
        }
        _migrationState.borrowerConfigurationPaused = newPausedState;
    }

    /// @dev TODO
    function setMaxBorrowAmount(
        address borrower,
        uint64 newMaxBorrowAmount
    ) external onlyRole(ADMIN_ROLE) {
        if (!_migrationState.done || !_migrationState.borrowerConfigurationPaused) {
            return;
        }
        _borrowerConfigs[borrower].maxBorrowAmount = newMaxBorrowAmount;
    }

    /// @dev Clears the migration state. Must be called before the next contract upgrading after the migration.
    function clearMigrationState() external onlyRole(OWNER_ROLE) {
        if (_migrationState.done && _migrationState.nextLoanId != 0) {
            _migrationState.nextLoanId = 0;
            _migrationState.done = false;
            _migrationState.borrowerConfigurationPaused = false;
        }
    }

    /// @dev Returns the migration state structure.
    function migrationState() external view returns (MigrationState memory) {
        return _migrationState;
    }
}
