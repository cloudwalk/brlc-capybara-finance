// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

import { AccessControlExtUpgradeable } from "./base/AccessControlExtUpgradeable.sol";
import { UUPSExtUpgradeable } from "./base/UUPSExtUpgradeable.sol";
import { Versionable } from "./base/Versionable.sol";

import { Error } from "./libraries/Error.sol";
import { Loan } from "./libraries/Loan.sol";
import { SafeCast } from "./libraries/SafeCast.sol";

import { ICreditLine } from "./interfaces/ICreditLine.sol";
import { ILendingMarket } from "./interfaces/ILendingMarket.sol";
import { ILiquidityPool } from "./interfaces/ILiquidityPool.sol";
import { ILiquidityPoolConfiguration } from "./interfaces/ILiquidityPool.sol";
import { ILiquidityPoolHooks } from "./interfaces/ILiquidityPool.sol";
import { ILiquidityPoolPrimary } from "./interfaces/ILiquidityPool.sol";

/// @title LiquidityPool contract
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev The upgradable liquidity pool contract.
contract LiquidityPool is
    AccessControlExtUpgradeable,
    PausableUpgradeable,
    ILiquidityPool,
    Versionable,
    UUPSExtUpgradeable
{
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    // -------------------------------------------- //
    //  Constants                                   //
    // -------------------------------------------- //

    /// @dev The role of this contract owner.
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");

    /// @dev The role of this contract admin. Currently not in use. Reserved for possible future changes.
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

    /// @dev The borrowable balance of the liquidity pool.
    uint64 internal _borrowableBalance;

    /// @dev The addons balance of the liquidity pool.
    ///
    /// IMPORTANT! Deprecated since version 1.9.0. Now this variable is always zero.
    ///
    /// See the comments of the {_addonTreasury} storage variable for more details.
    uint64 internal _addonsBalance;

    /// @dev The address of the addon treasury.
    ///
    /// Previously, this address affected the pool logic.
    /// But since version 1.9.0, the ability to save the addon amount in the pool has become deprecated.
    /// Now the addon amount must always be output to an external wallet. The addon balance of the pool is always zero.
    address internal _addonTreasury;

    /// @dev This empty reserved space is put in place to allow future versions
    /// to add new variables without shifting down storage in the inheritance chain.
    uint256[46] private __gap;

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
    /// @param lender_ The address of the liquidity pool lender.
    /// @param market_ The address of the lending market.
    /// @param token_ The address of the token.
    /// See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
    function initialize(
        address lender_, // Tools: this comment prevents Prettier from formatting into a single line.
        address market_,
        address token_
    ) external initializer {
        __LiquidityPool_init(lender_, market_, token_);
    }

    /// @dev Internal initializer of the upgradable contract.
    /// @param lender_ The address of the liquidity pool lender.
    /// @param market_ The address of the lending market.
    /// @param token_ The address of the token.
    /// See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
    function __LiquidityPool_init(
        address lender_,
        address market_,
        address token_
    ) internal onlyInitializing {
        __Context_init_unchained();
        __ERC165_init_unchained();
        __AccessControl_init_unchained();
        __AccessControlExt_init_unchained();
        __Pausable_init_unchained();
        __LiquidityPool_init_unchained(lender_, market_, token_);
    }

    /// @dev Unchained internal initializer of the upgradable contract.
    /// @param lender_ The address of the liquidity pool lender.
    /// @param market_ The address of the lending market.
    /// @param token_ The address of the token.
    /// See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
    function __LiquidityPool_init_unchained(
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

    /// @inheritdoc ILiquidityPoolConfiguration
    function setAddonTreasury(address newTreasury) external onlyRole(OWNER_ROLE) {
        _setAddonTreasury(newTreasury);
    }

    // -------------------------------------------- //
    //  Primary transactional functions             //
    // -------------------------------------------- //

    /// @inheritdoc ILiquidityPoolPrimary
    function deposit(uint256 amount) external onlyRole(OWNER_ROLE) {
        if (amount == 0) {
            revert Error.InvalidAmount();
        }

        IERC20 underlyingToken = IERC20(_token);

        if (underlyingToken.allowance(address(this), _market) == 0) {
            underlyingToken.approve(_market, type(uint256).max);
        }

        _borrowableBalance += amount.toUint64();
        underlyingToken.safeTransferFrom(msg.sender, address(this), amount);

        emit Deposit(amount);
    }

    /// @inheritdoc ILiquidityPoolPrimary
    function withdraw(uint256 borrowableAmount, uint256 addonAmount) external onlyRole(OWNER_ROLE) {
        if (borrowableAmount == 0) {
            revert Error.InvalidAmount();
        }
        if (addonAmount != 0) {
            revert Error.InvalidAmount();
        }

        if (_borrowableBalance < borrowableAmount) {
            revert InsufficientBalance();
        }

        _borrowableBalance -= borrowableAmount.toUint64();

        IERC20(_token).safeTransfer(msg.sender, borrowableAmount + addonAmount);

        emit Withdrawal(borrowableAmount, addonAmount);
    }

    /// @inheritdoc ILiquidityPoolPrimary
    function rescue(address token_, uint256 amount) external onlyRole(OWNER_ROLE) {
        if (token_ == address(0)) {
            revert Error.ZeroAddress();
        }
        if (amount == 0) {
            revert Error.InvalidAmount();
        }

        IERC20(token_).safeTransfer(msg.sender, amount);

        emit Rescue(token_, amount);
    }

    // -------------------------------------------- //
    //  Hook transactional functions                //
    // -------------------------------------------- //

    /// @inheritdoc ILiquidityPoolHooks
    function onBeforeLoanTaken(uint256 loanId) external whenNotPaused onlyMarket {
        Loan.State memory loan = ILendingMarket(_market).getLoanState(loanId);
        uint64 principalAmount = loan.borrowedAmount + loan.addonAmount;
        if (principalAmount > _borrowableBalance) {
            revert InsufficientBalance();
        }
        unchecked {
            _borrowableBalance -= principalAmount;
        }
    }

    /// @inheritdoc ILiquidityPoolHooks
    function onAfterLoanPayment(uint256 loanId, uint256 amount) external whenNotPaused onlyMarket {
        loanId; // To prevent compiler warning about unused variable
        _borrowableBalance += amount.toUint64();
    }

    /// @inheritdoc ILiquidityPoolHooks
    function onAfterLoanRevocation(uint256 loanId) external whenNotPaused onlyMarket {
        Loan.State memory loan = ILendingMarket(_market).getLoanState(loanId);
        if (loan.borrowedAmount > loan.repaidAmount) {
            _borrowableBalance = _borrowableBalance + (loan.borrowedAmount - loan.repaidAmount) + loan.addonAmount;
        } else {
            _borrowableBalance = _borrowableBalance - (loan.repaidAmount - loan.borrowedAmount) + loan.addonAmount;
        }
    }

    // -------------------------------------------- //
    //  View functions                              //
    // -------------------------------------------- //

    /// @inheritdoc ILiquidityPoolConfiguration
    function isAdmin(address account) external view returns (bool) {
        return hasRole(ADMIN_ROLE, account);
    }

    /// @inheritdoc ILiquidityPoolPrimary
    function addonTreasury() external view returns (address) {
        return _addonTreasury;
    }

    /// @inheritdoc ILiquidityPoolPrimary
    function getBalances() external view returns (uint256, uint256) {
        return (_borrowableBalance, _addonsBalance);
    }

    /// @inheritdoc ILiquidityPoolPrimary
    function market() external view returns (address) {
        return _market;
    }

    /// @inheritdoc ILiquidityPoolPrimary
    function token() external view returns (address) {
        return _token;
    }

    // -------------------------------------------- //
    //  Pure functions                              //
    // -------------------------------------------- //

    /// @inheritdoc ILiquidityPoolPrimary
    function proveLiquidityPool() external pure {}

    // -------------------------------------------- //
    //  Internal functions                          //
    // -------------------------------------------- //

    /// @dev Sets the new address of the  addon treasury internally.
    function _setAddonTreasury(address newTreasury) internal {
        address oldTreasury = _addonTreasury;
        if (oldTreasury == newTreasury) {
            revert Error.AlreadyConfigured();
        }
        if (newTreasury == address(0)) {
            revert AddonTreasuryAddressZeroingProhibited();
        }
        if (IERC20(_token).allowance(newTreasury, _market) == 0) {
            revert AddonTreasuryZeroAllowanceForMarket();
        }
        emit AddonTreasuryChanged(newTreasury, oldTreasury);
        _addonTreasury = newTreasury;
    }

    /// @dev The upgrade validation function for the UUPSExtUpgradeable contract.
    /// @param newImplementation The address of the new implementation.
    ///
    function _validateUpgrade(address newImplementation) internal view override onlyRole(OWNER_ROLE) {
        try ILiquidityPool(newImplementation).proveLiquidityPool() {} catch {
            revert Error.ImplementationAddressInvalid();
        }
    }
}
