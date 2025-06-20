// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { AccessControlExtUpgradeable } from "./base/AccessControlExtUpgradeable.sol";
import { PausableExtUpgradeable } from "./base/PausableExtUpgradeable.sol";
import { UUPSExtUpgradeable } from "./base/UUPSExtUpgradeable.sol";
import { Versionable } from "./base/Versionable.sol";

import { Constants } from "./libraries/Constants.sol";
import { Error } from "./libraries/Error.sol";
import { Loan } from "./libraries/Loan.sol";
import { SafeCast } from "./libraries/SafeCast.sol";

import { ICreditLine } from "./interfaces/ICreditLine.sol";
import { ICreditLineConfiguration } from "./interfaces/ICreditLine.sol";
import { ICreditLineHooks } from "./interfaces/ICreditLine.sol";
import { ICreditLinePrimary } from "./interfaces/ICreditLine.sol";
import { ILendingMarket } from "./interfaces/ILendingMarket.sol";

import { CreditLineStorage } from "./CreditLineStorage.sol";

/**
 * @title CreditLine contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The upgradeable credit line contract.
 */
contract CreditLine is
    CreditLineStorage,
    AccessControlExtUpgradeable,
    PausableExtUpgradeable,
    ICreditLine,
    Versionable,
    UUPSExtUpgradeable
{
    using SafeCast for uint256;

    // ------------------ Constants ------------------------------- //

    /// @dev The role of an admin that is allowed to configure borrowers.
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // ------------------ Modifiers ------------------------------- //

    /// @dev Throws if called by any account other than the lending market.
    modifier onlyMarket() {
        if (msg.sender != _market) {
            revert Error.Unauthorized();
        }
        _;
    }

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
     * @param owner_ The address of the credit line owner.
     * @param market_ The address of the lending market.
     * @param token_ The address of the token.
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
     */
    function initialize(
        address owner_, // Tools: this comment prevents Prettier from formatting into a single line.
        address market_,
        address token_
    ) external initializer {
        if (owner_ == address(0)) {
            revert Error.ZeroAddress();
        }

        if (market_ == address(0)) {
            revert Error.ZeroAddress();
        }
        if (market_.code.length == 0) {
            revert Error.ContractAddressInvalid();
        }
        try ILendingMarket(market_).proveLendingMarket() {} catch {
            revert Error.ContractAddressInvalid();
        }

        if (token_ == address(0)) {
            revert Error.ZeroAddress();
        }
        if (token_.code.length == 0) {
            revert Error.ContractAddressInvalid();
        }
        try IERC20(token_).balanceOf(address(0)) {} catch {
            revert Error.ContractAddressInvalid();
        }

        __AccessControlExt_init_unchained();
        __PausableExt_init_unchained();
        __UUPSExt_init_unchained();

        _setRoleAdmin(ADMIN_ROLE, GRANTOR_ROLE);
        _grantRole(OWNER_ROLE, owner_);

        _market = market_;
        _token = token_;
    }

    // ----------- Configuration transactional functions ---------- //

    /// @inheritdoc ICreditLineConfiguration
    function configureCreditLine(CreditLineConfig memory config) external onlyRole(OWNER_ROLE) {
        if (config.minBorrowedAmount > config.maxBorrowedAmount) {
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

        // Check that fields `minAddonFixedRate`, `maxAddonFixedRate`, `minAddonPeriodRate`, `maxAddonPeriodRate`
        // are zero because they have been deprecated since version 1.8.0
        if (config.minAddonFixedRate != 0) {
            revert InvalidCreditLineConfiguration();
        }
        if (config.maxAddonFixedRate != 0) {
            revert InvalidCreditLineConfiguration();
        }
        if (config.minAddonPeriodRate != 0) {
            revert InvalidCreditLineConfiguration();
        }
        if (config.maxAddonPeriodRate != 0) {
            revert InvalidCreditLineConfiguration();
        }

        _config = config;

        emit CreditLineConfigured(address(this));
    }

    // -------------- Primary transactional functions ------------- //

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

    /// @inheritdoc ICreditLinePrimary
    function configureBorrower(
        address borrower,
        BorrowerConfigLegacy memory config
    ) external whenNotPaused onlyRole(ADMIN_ROLE) {
        _configureBorrowerLegacy(borrower, config);
    }

    /// @inheritdoc ICreditLinePrimary
    function configureBorrowers(
        address[] memory borrowers,
        BorrowerConfigLegacy[] memory configs
    ) external whenNotPaused onlyRole(ADMIN_ROLE) {
        if (borrowers.length != configs.length) {
            revert Error.ArrayLengthMismatch();
        }

        for (uint256 i = 0; i < borrowers.length; i++) {
            _configureBorrowerLegacy(borrowers[i], configs[i]);
        }
    }

    // ------------------ Hook transactional functions ------------ //

    /// @inheritdoc ICreditLineHooks
    function onBeforeLoanTaken(uint256 loanId) external whenNotPaused onlyMarket {
        Loan.State memory loan = ILendingMarket(_market).getLoanState(loanId);
        _openLoan(loan);
    }

    /// @inheritdoc ICreditLineHooks
    function onBeforeLoanReopened(uint256 loanId) external whenNotPaused onlyMarket {
        Loan.State memory loan = ILendingMarket(_market).getLoanState(loanId);
        _openLoan(loan);
    }

    /// @inheritdoc ICreditLineHooks
    function onAfterLoanPayment(uint256 loanId, uint256 repaymentAmount) external whenNotPaused onlyMarket {
        repaymentAmount; // To prevent compiler warning about unused variable

        Loan.State memory loan = ILendingMarket(_market).getLoanState(loanId);
        if (loan.trackedBalance == 0) {
            _closeLoan(loan);
        }
    }

    /// @inheritdoc ICreditLineHooks
    function onAfterLoanRevocation(uint256 loanId) external whenNotPaused onlyMarket {
        Loan.State memory loan = ILendingMarket(_market).getLoanState(loanId);
        _closeLoan(loan);
    }

    // ------------------ View functions -------------------------- //

    /// @inheritdoc ICreditLineConfiguration
    function creditLineConfiguration() external view override returns (CreditLineConfig memory) {
        return _config;
    }

    /// @inheritdoc ICreditLinePrimary
    function determineLoanTerms(
        address borrower,
        uint256 borrowedAmount,
        uint256 durationInPeriods
    ) public view returns (Loan.Terms memory terms) {
        if (borrower == address(0)) {
            revert Error.ZeroAddress();
        }
        if (borrowedAmount == 0) {
            revert Error.InvalidAmount();
        }

        BorrowerConfig storage borrowerConfig = _borrowerConfigs[borrower];

        if (_blockTimestamp() > borrowerConfig.expiration) {
            revert BorrowerConfigurationExpired();
        }
        if (borrowedAmount > borrowerConfig.maxBorrowedAmount) {
            revert Error.InvalidAmount();
        }
        if (borrowedAmount < borrowerConfig.minBorrowedAmount) {
            revert Error.InvalidAmount();
        }
        if (durationInPeriods < borrowerConfig.minDurationInPeriods) {
            revert LoanDurationOutOfRange();
        }
        if (durationInPeriods > borrowerConfig.maxDurationInPeriods) {
            revert LoanDurationOutOfRange();
        }

        terms.token = _token;
        terms.durationInPeriods = durationInPeriods;
        terms.interestRatePrimary = borrowerConfig.interestRatePrimary;
        terms.interestRateSecondary = borrowerConfig.interestRateSecondary;
        // terms.addonAmount = 0 because the field has been deprecated since version 1.8.0
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
    function determineLateFeeAmount(uint256 loanTrackedBalance) public view returns (uint256) {
        return _determineLateFeeAmount(loanTrackedBalance, _config.lateFeeRate);
    }

    /// @inheritdoc ICreditLinePrimary
    function determineLateFeeAmount(address borrower, uint256 loanTrackedBalance) external view returns (uint256) {
        BorrowerConfig storage borrowerConfig = _borrowerConfigs[borrower];

        if (borrowerConfig.lateFeePolicy == LateFeePolicy.Individual) {
            return _determineLateFeeAmount(loanTrackedBalance, borrowerConfig.lateFeeRate);
        }

        // The late fee rate is coming from the credit line configuration.
        return _determineLateFeeAmount(loanTrackedBalance, _config.lateFeeRate);
    }

    // ------------------ Pure functions -------------------------- //

    /// @inheritdoc ICreditLine
    function proveCreditLine() external pure {}

    // ------------------ Internal functions ---------------------- //

    /**
     * @dev Updates the configuration of a borrower.
     * @param borrower The address of the borrower to configure.
     * @param config The new borrower configuration to be applied.
     */
    function _configureBorrower(address borrower, BorrowerConfig memory config) internal {
        if (borrower == address(0)) {
            revert Error.ZeroAddress();
        }

        // NOTE: We don't check for expiration here, because
        // it can be used for disabling a borrower by setting it to 0.

        if (config.minBorrowedAmount > config.maxBorrowedAmount) {
            revert InvalidBorrowerConfiguration();
        }
        if (config.minBorrowedAmount < _config.minBorrowedAmount) {
            revert InvalidBorrowerConfiguration();
        }
        if (config.maxBorrowedAmount > _config.maxBorrowedAmount) {
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

        if (config.addonFixedRate != 0) {
            revert InvalidBorrowerConfiguration();
        }
        if (config.addonPeriodRate != 0) {
            revert InvalidBorrowerConfiguration();
        }

        _borrowerConfigs[borrower] = config;

        emit BorrowerConfigured(address(this), borrower);
    }

    /**
     * @dev Calculates the late fee amount for the provided loan tracked balance and late fee rate.
     * @param loanTrackedBalance The tracked balance of the loan as the base to calculate the late fee amount.
     * @param lateFeeRate The late fee rate to be applied to the loan.
     * @return The amount of the late fee.
     */
    function _determineLateFeeAmount(uint256 loanTrackedBalance, uint256 lateFeeRate) private pure returns (uint256) {
        // The equivalent formula: round(loanTrackedBalance * lateFeeRate / INTEREST_RATE_FACTOR)
        // Where division operator `/` takes into account the fractional part and
        // the `round()` function returns an integer rounded according to standard mathematical rules.
        uint256 product = loanTrackedBalance * lateFeeRate;
        uint256 remainder = product % Constants.INTEREST_RATE_FACTOR;
        uint256 result = product / Constants.INTEREST_RATE_FACTOR;
        if (remainder >= (Constants.INTEREST_RATE_FACTOR / 2)) {
            ++result;
        }
        return result;
    }

    /**
     * @dev Updates the configuration of a borrower.
     * @param borrower The address of the borrower to configure.
     * @param config The new borrower configuration to be applied.
     */
    function _configureBorrowerLegacy(address borrower, BorrowerConfigLegacy memory config) internal {
        BorrowerConfig memory newConfig = BorrowerConfig({
            expiration: config.expiration,
            minDurationInPeriods: config.minDurationInPeriods,
            maxDurationInPeriods: config.maxDurationInPeriods,
            minBorrowedAmount: config.minBorrowedAmount,
            maxBorrowedAmount: config.maxBorrowedAmount,
            borrowingPolicy: config.borrowingPolicy,
            interestRatePrimary: config.interestRatePrimary,
            interestRateSecondary: config.interestRateSecondary,
            addonFixedRate: config.addonFixedRate,
            addonPeriodRate: config.addonPeriodRate,
            lateFeePolicy: LateFeePolicy.Individual,
            lateFeeRate: 0
        });
        _configureBorrower(borrower, newConfig);
    }

    /// @dev Returns the current block timestamp with the time offset applied.
    function _blockTimestamp() private view returns (uint256) {
        return block.timestamp - Constants.NEGATIVE_TIME_OFFSET;
    }

    /**
     * @dev Executes additional checks and updates the borrower structures when a loan is opened.
     * @param loan The state of the loan that is being opened.
     */
    function _openLoan(Loan.State memory loan) internal {
        address borrower = loan.borrower;
        uint256 borrowedAmount = loan.borrowedAmount;
        BorrowerState storage borrowerState = _borrowerStates[borrower];
        BorrowerConfig storage borrowerConfig = _borrowerConfigs[borrower];

        unchecked {
            uint256 newActiveLoanCount = uint256(borrowerState.activeLoanCount) + 1;
            uint256 newTotalActiveLoanAmount = uint256(borrowerState.totalActiveLoanAmount) + borrowedAmount;

            if (borrowerConfig.borrowingPolicy == BorrowingPolicy.SingleActiveLoan) {
                if (newActiveLoanCount > 1) {
                    revert LimitViolationOnSingleActiveLoan();
                }
            } else if (borrowerConfig.borrowingPolicy == BorrowingPolicy.TotalActiveAmountLimit) {
                if (newTotalActiveLoanAmount > borrowerConfig.maxBorrowedAmount) {
                    revert LimitViolationOnTotalActiveLoanAmount(newTotalActiveLoanAmount);
                }
            } // else borrowerConfig.borrowingPolicy == BorrowingPolicy.MultipleActiveLoans

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

    /**
     * @dev Updates the borrower structures when a loan is closed.
     * @param loan The state of the loan that is being closed.
     */
    function _closeLoan(Loan.State memory loan) internal {
        BorrowerState storage borrowerState = _borrowerStates[loan.borrower];
        borrowerState.activeLoanCount -= 1;
        borrowerState.closedLoanCount += 1;
        borrowerState.totalActiveLoanAmount -= loan.borrowedAmount;
        borrowerState.totalClosedLoanAmount += loan.borrowedAmount;
    }

    /**
     * @dev The upgrade validation function for the UUPSExtUpgradeable contract.
     * @param newImplementation The address of the new implementation.
     *
     */
    function _validateUpgrade(address newImplementation) internal view override onlyRole(OWNER_ROLE) {
        try ICreditLine(newImplementation).proveCreditLine() {} catch {
            revert Error.ImplementationAddressInvalid();
        }
    }
}
