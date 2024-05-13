// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

import { Loan } from "../common/libraries/Loan.sol";
import { Error } from "../common/libraries/Error.sol";
import { SafeCast } from "../common/libraries/SafeCast.sol";
import { Constants } from "../common/libraries/Constants.sol";

import { ICreditLine } from "../common/interfaces/core/ICreditLine.sol";
import { ICreditLineConfigurable } from "../common/interfaces/ICreditLineConfigurable.sol";
import { AccessControlExtUpgradeable } from "../common/AccessControlExtUpgradeable.sol";

/// @title CreditLineConfigurable contract
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Implementation of the configurable credit line contract.
contract CreditLineConfigurable is AccessControlExtUpgradeable, PausableUpgradeable, ICreditLineConfigurable {
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

    /// @dev The address of the lending market.
    address internal _market;

    /// @dev The address of the underlying token.
    address internal _token;

    /// @dev The structure of the credit line configuration.
    CreditLineConfig internal _config;

    /// @dev The mapping of borrower to borrower configuration.
    mapping(address => BorrowerConfig) internal _borrowers;

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
    function initialize(
        address lender_,
        address market_,
        address token_
    ) external initializer {
        __CreditLineConfigurable_init(lender_, market_, token_);
    }

    /// @dev Internal initializer of the upgradable contract.
    /// @param lender_ The address of the credit line lender.
    /// @param market_ The address of the lending market.
    /// @param token_ The address of the token.
    function __CreditLineConfigurable_init(
        address lender_,
        address market_,
        address token_
    ) internal onlyInitializing {
        __AccessControl_init_unchained();
        __AccessControlExt_init_unchained();
        __Pausable_init_unchained();
        __CreditLineConfigurable_init_unchained(lender_, market_, token_);
    }

    /// @dev Unchained internal initializer of the upgradable contract.
    /// @param lender_ The address of the credit line lender.
    /// @param market_ The address of the lending market.
    /// @param token_ The address of the token.
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
        _configureBorrower(borrower, config);
    }

    /// @inheritdoc ICreditLineConfigurable
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
    //  Market functions                            //
    // -------------------------------------------- //

    /// @inheritdoc ICreditLine
    function onBeforeLoanTaken(
        uint256 loanId,
        address borrower,
        uint256 borrowAmount,
        uint256 durationInPeriods
    ) external whenNotPaused onlyMarket returns (Loan.Terms memory terms) {
        loanId; // To prevent compiler warning about unused variable

        terms = determineLoanTerms(borrower, borrowAmount, durationInPeriods);

        BorrowerConfig storage borrowerConfig = _borrowers[borrower];

        if (borrowerConfig.borrowPolicy == BorrowPolicy.Keep) {
            // Do nothing to the borrower's max borrow amount configuration
        } else if (borrowerConfig.borrowPolicy == BorrowPolicy.Decrease) {
            borrowerConfig.maxBorrowAmount -= borrowAmount.toUint64();
        } else { // borrowerConfig.borrowPolicy == BorrowPolicy.Reset
            borrowerConfig.maxBorrowAmount = 0;
        }
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

        BorrowerConfig storage borrowerConfig = _borrowers[borrower];

        if (block.timestamp > borrowerConfig.expiration) {
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
        terms.treasury = _config.treasury;
        terms.durationInPeriods = durationInPeriods.toUint32();
        terms.interestRatePrimary = borrowerConfig.interestRatePrimary;
        terms.interestRateSecondary = borrowerConfig.interestRateSecondary;
        terms.addonAmount = calculateAddonAmount(
            borrowAmount,
            durationInPeriods,
            borrowerConfig.addonFixedRate,
            borrowerConfig.addonPeriodRate,
            Constants.INTEREST_RATE_FACTOR
        ).toUint64();
    }

    /// @inheritdoc ICreditLineConfigurable
    function getBorrowerConfiguration(address borrower) external view override returns (BorrowerConfig memory) {
        return _borrowers[borrower];
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

        _borrowers[borrower] = config;

        emit BorrowerConfigured(address(this), borrower);
    }
}
