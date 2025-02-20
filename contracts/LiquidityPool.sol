// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { AccessControlExtUpgradeable } from "./base/AccessControlExtUpgradeable.sol";
import { PausableExtUpgradeable } from "./base/PausableExtUpgradeable.sol";
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

import { LiquidityPoolStorage } from "./LiquidityPoolStorage.sol";

/// @title LiquidityPool contract
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev The upgradable liquidity pool contract.
contract LiquidityPool is
    LiquidityPoolStorage,
    AccessControlExtUpgradeable,
    PausableExtUpgradeable,
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
    /// @param owner_ The address of the liquidity pool owner.
    /// @param market_ The address of the lending market.
    /// @param token_ The address of the token.
    /// See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
    function initialize(
        address owner_, // Tools: this comment prevents Prettier from formatting into a single line.
        address market_,
        address token_
    ) external initializer {
        __LiquidityPool_init(owner_, market_, token_);
    }

    /// @dev Internal initializer of the upgradable contract.
    /// @param owner_ The address of the liquidity pool owner.
    /// @param market_ The address of the lending market.
    /// @param token_ The address of the token.
    /// See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
    function __LiquidityPool_init(
        address owner_, // Tools: this comment prevents Prettier from formatting into a single line.
        address market_,
        address token_
    ) internal onlyInitializing {
        __Context_init_unchained();
        __ERC165_init_unchained();
        __AccessControl_init_unchained();
        __AccessControlExt_init_unchained();
        __Pausable_init_unchained();
        __PausableExt_init_unchained(OWNER_ROLE);
        __LiquidityPool_init_unchained(owner_, market_, token_);
    }

    /// @dev Unchained internal initializer of the upgradable contract.
    /// @param owner_ The address of the liquidity pool owner.
    /// @param market_ The address of the lending market.
    /// @param token_ The address of the token.
    /// See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
    function __LiquidityPool_init_unchained(
        address owner_, // Tools: this comment prevents Prettier from formatting into a single line.
        address market_,
        address token_
    ) internal onlyInitializing {
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

        _setRoleAdmin(OWNER_ROLE, OWNER_ROLE);
        _grantRole(OWNER_ROLE, owner_);

        _market = market_;
        _token = token_;
    }

    // -------------------------------------------- //
    //  Configuration transactional functions       //
    // -------------------------------------------- //

    /// @inheritdoc ILiquidityPoolConfiguration
    function setAddonTreasury(address newTreasury) external onlyRole(OWNER_ROLE) {
        _setAddonTreasury(newTreasury);
    }

    /// @inheritdoc ILiquidityPoolConfiguration
    function setExternalTreasury(address newTreasury) external onlyRole(OWNER_ROLE) {
        _setExternalTreasury(newTreasury);
    }

    // -------------------------------------------- //
    //  Primary transactional functions             //
    // -------------------------------------------- //

    /// @inheritdoc ILiquidityPoolPrimary
    function deposit(uint256 amount) external onlyRole(OWNER_ROLE) {
        _deposit(amount, msg.sender);
    }

    /// @inheritdoc ILiquidityPoolPrimary
    function depositFromExternalTreasury(uint256 amount) external onlyRole(OWNER_ROLE) {
        _deposit(amount, _getAndCheckExternalTreasury());
    }

    /// @inheritdoc ILiquidityPoolPrimary
    function withdraw(uint256 borrowableAmount, uint256 addonAmount) external onlyRole(OWNER_ROLE) {
        _withdraw(borrowableAmount, addonAmount, msg.sender);
    }

    /// @inheritdoc ILiquidityPoolPrimary
    function withdrawToExternalTreasury(uint256 amount) external onlyRole(OWNER_ROLE) {
        _withdraw(amount, 0, _getAndCheckExternalTreasury());
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
    function onAfterLoanRepaymentUndoing(uint256 loanId, uint256 amount) external whenNotPaused onlyMarket {
        loanId; // To prevent compiler warning about unused variable
        _borrowableBalance -= amount.toUint64();
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

    /// @inheritdoc ILiquidityPoolPrimary
    function addonTreasury() external view returns (address) {
        return _addonTreasury;
    }

    /// @inheritdoc ILiquidityPoolPrimary
    function externalTreasury() external view returns (address) {
        return _externalTreasury;
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

    /// @dev Deposits the tokens into the liquidity pool internally.
    /// @param amount The amount of tokens to deposit.
    /// @param sender The address of the tokens sender.
    function _deposit(uint256 amount, address sender) internal {
        if (amount == 0) {
            revert Error.InvalidAmount();
        }

        IERC20 underlyingToken = IERC20(_token);

        if (underlyingToken.allowance(address(this), _market) == 0) {
            underlyingToken.approve(_market, type(uint256).max);
        }

        _borrowableBalance += amount.toUint64();
        underlyingToken.safeTransferFrom(sender, address(this), amount);

        emit Deposit(amount);
    }

    /// @dev Withdraws the tokens from the liquidity pool internally.
    /// @param borrowableAmount The amount of borrowable tokens to withdraw.
    /// @param addonAmount The amount of addon tokens to withdraw.
    /// @param recipient The address of the tokens recipient.
    function _withdraw(uint256 borrowableAmount, uint256 addonAmount, address recipient) internal {
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

        IERC20(_token).safeTransfer(recipient, borrowableAmount);

        emit Withdrawal(borrowableAmount, addonAmount);
    }

    /// @dev Sets the new address of the addon treasury internally.
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

    /// @dev Sets the new address of the external treasury internally.
    /// @param newTreasury The new address of the external treasury.
    function _setExternalTreasury(address newTreasury) internal {
        address oldTreasury = _externalTreasury;
        if (oldTreasury == newTreasury) {
            revert Error.AlreadyConfigured();
        }
        if (newTreasury != address(0)) {
            if (IERC20(_token).allowance(newTreasury, address(this)) == 0) {
                revert ExternalTreasuryZeroAllowanceForPool();
            }
        }
        emit ExternalTreasuryChanged(newTreasury, oldTreasury);
        _externalTreasury = newTreasury;
    }

    /// @dev Returns the external treasury address and validates it.
    function _getAndCheckExternalTreasury() internal view returns (address) {
        address externalTreasury_ = _externalTreasury;
        if (externalTreasury_ == address(0)) {
            revert ExternalTreasuryAddressZero();
        }
        return externalTreasury_;
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
