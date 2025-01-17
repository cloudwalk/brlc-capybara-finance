// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

import { AccessControlExtUpgradeable } from "./base/AccessControlExtUpgradeable.sol";
import { UUPSExtUpgradeable } from "./base/UUPSExtUpgradeable.sol";
import { Versionable } from "./base/Versionable.sol";

import { Constants } from "./libraries/Constants.sol";
import { Error } from "./libraries/Error.sol";
import { Loan } from "./libraries/Loan.sol";
import { Rounding } from "./libraries/Rounding.sol";
import { SafeCast } from "./libraries/SafeCast.sol";

import { ICreditLine } from "./interfaces/ICreditLine.sol";
import { ICreditLineConfiguration } from "./interfaces/ICreditLine.sol";
import { ICreditLineHooks } from "./interfaces/ICreditLine.sol";
import { ICreditLinePrimary } from "./interfaces/ICreditLine.sol";
import { ILendingMarket } from "./interfaces/ILendingMarket.sol";

/// @title CreditLine contract
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev The upgradable credit line contract.
contract CreditLine is AccessControlExtUpgradeable, PausableUpgradeable, ICreditLine, Versionable, UUPSExtUpgradeable {
    using SafeCast for uint256;

    // -------------------------------------------- //
    //  Constants                                   //
    // -------------------------------------------- //

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
    CreditLineConfig internal _config; // 2 slots

    /// @dev The mapping of borrower to borrower configuration.
    mapping(address => BorrowerConfig) internal _borrowerConfigs;

    /// @dev The mapping of a borrower to the borrower state.
    mapping(address => BorrowerState) internal _borrowerStates;

    /// @dev This empty reserved space is put in place to allow future versions
    /// to add new variables without shifting down storage in the inheritance chain.
    uint256[45] private __gap;

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
    //  Constructor                                 //
    // -------------------------------------------- //

    /// @dev Constructor that prohibits the initialization of the implementation of the upgradable contract.
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
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
    //  Pauser transactional functions              //
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
    //  Configuration transactional functions       //
    // -------------------------------------------- //

    /// @inheritdoc ICreditLineConfiguration
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
    //  Primary transactional functions             //
    // -------------------------------------------- //

    /// @inheritdoc ICreditLinePrimary
    function configureBorrower(
        address borrower,
        BorrowerConfig memory config
    ) external whenNotPaused onlyRole(ADMIN_ROLE) {
        _configureBorrower(borrower, config);
    }

    /// @inheritdoc ICreditLinePrimary
    function configureBorrowers(
        address[] memory borrowers,
        BorrowerConfig[] memory configs
    ) external whenNotPaused onlyRole(ADMIN_ROLE) {
        if (borrowers.length != configs.length) {
            revert Error.ArrayLengthMismatch();
        }

        for (uint256 i = 0; i < borrowers.length; i++) {
            _configureBorrower(borrowers[i], configs[i]);
        }
    }

    // -------------------------------------------- //
    //  Hook transactional functions                //
    // -------------------------------------------- //

    /// @inheritdoc ICreditLineHooks
    function onBeforeLoanTaken(uint256 loanId) external whenNotPaused onlyMarket returns (bool) {
        Loan.State memory loan = ILendingMarket(_market).getLoanState(loanId);
        _openLoan(loan);
        return true;
    }

    /// @inheritdoc ICreditLineHooks
    function onAfterLoanPayment(uint256 loanId, uint256 repayAmount) external whenNotPaused onlyMarket returns (bool) {
        repayAmount; // To prevent compiler warning about unused variable

        Loan.State memory loan = ILendingMarket(_market).getLoanState(loanId);
        if (loan.trackedBalance == 0) {
            _closeLoan(loan);
        }

        return true;
    }

    /// @inheritdoc ICreditLineHooks
    function onAfterLoanRevocation(uint256 loanId) external whenNotPaused onlyMarket returns (bool) {
        Loan.State memory loan = ILendingMarket(_market).getLoanState(loanId);
        _closeLoan(loan);
        return true;
    }

    // -------------------------------------------- //
    //  View functions                              //
    // -------------------------------------------- //

    /// @inheritdoc ICreditLineConfiguration
    function creditLineConfiguration() external view override returns (CreditLineConfig memory) {
        return _config;
    }

    /// @inheritdoc ICreditLineConfiguration
    function isAdmin(address account) external view returns (bool) {
        return hasRole(ADMIN_ROLE, account);
    }

    /// @inheritdoc ICreditLinePrimary
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

        BorrowerState storage borrowerState = _borrowerStates[borrower];
        if (borrowerConfig.borrowPolicy == BorrowPolicy.SingleActiveLoan) {
            if (borrowerState.activeLoanCount > 0) {
                revert LimitViolationOnSingleActiveLoan();
            }
        } else if (borrowerConfig.borrowPolicy == BorrowPolicy.TotalActiveAmountLimit) {
            uint256 newTotalActiveLoanAmount = borrowAmount + borrowerState.totalActiveLoanAmount;
            if (newTotalActiveLoanAmount > borrowerConfig.maxBorrowAmount) {
                revert LimitViolationOnTotalActiveLoanAmount(newTotalActiveLoanAmount);
            }
        } // else borrowerConfig.borrowPolicy == BorrowPolicy.MultipleActiveLoans

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
        terms.addonAmount = Rounding.roundMath(addonAmount, Constants.ACCURACY_FACTOR).toUint64();
    }

    /// @inheritdoc ICreditLinePrimary
    function getBorrowerConfiguration(address borrower) external view override returns (BorrowerConfig memory) {
        return _borrowerConfigs[borrower];
    }

    /// @inheritdoc ICreditLinePrimary
    function getBorrowerState(address borrower) external view returns (BorrowerState memory) {
        return _borrowerStates[borrower];
    }

    /// @inheritdoc ICreditLinePrimary
    function market() external view returns (address) {
        return _market;
    }

    /// @inheritdoc ICreditLinePrimary
    function token() external view returns (address) {
        return _token;
    }

    /// @inheritdoc ICreditLinePrimary
    function lateFeeRate() external view returns (uint256) {
        return _config.lateFeeRate;
    }

    // -------------------------------------------- //
    //  Pure functions                              //
    // -------------------------------------------- //

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
        /// E = A * r / (1 - r) = A * (R / F) / (1 - R / F) = A * R / (F - R) (2)
        /// where `R` -- the addon rate in units of the rate factor, `F` -- the interest rate factor.
        uint256 addonRate = addonPeriodRate * durationInPeriods + addonFixedRate;
        return (amount * addonRate) / (interestRateFactor - addonRate);
    }

    /// @inheritdoc ICreditLinePrimary
    function proveCreditLine() external pure {}

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
        BorrowerState storage borrowerState = _borrowerStates[loan.borrower];

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
    }

    /// @dev Updates the borrower structures when a loan is closed.
    /// @param loan The state of the loan thai is being closed.
    function _closeLoan(Loan.State memory loan) internal {
        BorrowerState storage borrowerState = _borrowerStates[loan.borrower];
        borrowerState.activeLoanCount -= 1;
        borrowerState.closedLoanCount += 1;
        borrowerState.totalActiveLoanAmount -= loan.borrowAmount;
        borrowerState.totalClosedLoanAmount += loan.borrowAmount;
    }

    /// @dev The upgrade validation function for the UUPSExtUpgradeable contract.
    /// @param newImplementation The address of the new implementation.
    ///
    function _validateUpgrade(address newImplementation) internal view override onlyRole(OWNER_ROLE) {
        try ICreditLine(newImplementation).proveCreditLine() {} catch {
            revert Error.ImplementationAddressInvalid();
        }
    }
}
