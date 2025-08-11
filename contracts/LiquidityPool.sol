// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { AccessControlExtUpgradeable } from "./base/AccessControlExtUpgradeable.sol";
import { PausableExtUpgradeable } from "./base/PausableExtUpgradeable.sol";
import { UUPSExtUpgradeable } from "./base/UUPSExtUpgradeable.sol";
import { Versionable } from "./base/Versionable.sol";

import { Error } from "./libraries/Error.sol";
import { SafeCast } from "./libraries/SafeCast.sol";

import { ICreditLine } from "./interfaces/ICreditLine.sol";
import { IERC20Mintable } from "./interfaces/IERC20Mintable.sol";
import { ILiquidityPool } from "./interfaces/ILiquidityPool.sol";
import { ILiquidityPoolConfiguration } from "./interfaces/ILiquidityPool.sol";
import { ILiquidityPoolHooks } from "./interfaces/ILiquidityPool.sol";
import { ILiquidityPoolPrimary } from "./interfaces/ILiquidityPool.sol";

import { LiquidityPoolStorage } from "./LiquidityPoolStorage.sol";

/**
 * @title LiquidityPool contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The upgradeable liquidity pool contract.
 */
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

    // ------------------ Constants ------------------------------- //

    /// @dev The role of an admin that is allowed to execute pool-related functions.
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    /// @dev The role of the liquidity operator that is allowed to move liquidity and execute related hook functions.
    bytes32 public constant LIQUIDITY_OPERATOR_ROLE = keccak256("LIQUIDITY_OPERATOR_ROLE");

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
     * @param owner_ The address of the liquidity pool owner.
     * @param liquidityOperator_ The address of the initial liquidity operator.
     * @param token_ The address of the token.
     * See details https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable.
     */
    function initialize(
        address owner_, // Tools: prevent Prettier one-liner
        address liquidityOperator_,
        address token_
    ) external initializer {
        if (owner_ == address(0)) {
            revert Error.ZeroAddress();
        }

        if (liquidityOperator_ == address(0)) {
            revert Error.ZeroAddress();
        }
        if (liquidityOperator_.code.length == 0) {
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

        _token = token_;

        _configureLiquidityOperator(liquidityOperator_);
    }

    // ----------- Configuration transactional functions ---------- //

    /// @inheritdoc ILiquidityPoolConfiguration
    function setAddonTreasury(address newTreasury) external onlyRole(OWNER_ROLE) {
        _setAddonTreasury(newTreasury);
    }

    /// @inheritdoc ILiquidityPoolConfiguration
    function setOperationalTreasury(address newTreasury) external onlyRole(OWNER_ROLE) {
        _setOperationalTreasury(newTreasury);
    }

    /// @inheritdoc ILiquidityPoolConfiguration
    function configureLiquidityOperator(address newOperator) external onlyRole(OWNER_ROLE) {
        _configureLiquidityOperator(newOperator);
    }

    /// @inheritdoc ILiquidityPoolConfiguration
    function deconfigureLiquidityOperator(address newOperator) external onlyRole(OWNER_ROLE) {
        _deconfigureLiquidityOperator(newOperator);
    }

    /**
     * @dev Initializes the admin role for already deployed contracts.
     *
     * This function can be removed after the admin role is initialized in all deployed contracts.
     */
    function initAdminRole() external onlyRole(OWNER_ROLE) {
        _setRoleAdmin(ADMIN_ROLE, OWNER_ROLE);
        _grantRole(ADMIN_ROLE, msg.sender);
    }

    // -------------- Primary transactional functions ------------- //

    /// @inheritdoc ILiquidityPoolPrimary
    function deposit(uint256 amount) external onlyRole(OWNER_ROLE) {
        _deposit(amount, msg.sender);
    }

    /// @inheritdoc ILiquidityPoolPrimary
    function depositFromOperationalTreasury(uint256 amount) external onlyRole(ADMIN_ROLE) {
        _deposit(amount, _getAndCheckOperationalTreasury());
    }

    /// @inheritdoc ILiquidityPoolPrimary
    function depositFromReserve(uint256 amount) external onlyRole(ADMIN_ROLE) {
        IERC20Mintable(_token).mintFromReserve(address(this), amount);
        _deposit(amount, address(this));
    }

    /// @inheritdoc ILiquidityPoolPrimary
    function withdraw(uint256 borrowableAmount, uint256 addonAmount) external onlyRole(OWNER_ROLE) {
        _withdraw(borrowableAmount, addonAmount, msg.sender);
    }

    /// @inheritdoc ILiquidityPoolPrimary
    function withdrawToOperationalTreasury(uint256 amount) external onlyRole(ADMIN_ROLE) {
        _withdraw(amount, 0, _getAndCheckOperationalTreasury());
    }

    /// @inheritdoc ILiquidityPoolPrimary
    function withdrawToReserve(uint256 amount) external onlyRole(ADMIN_ROLE) {
        _withdraw(amount, 0, address(this));
        IERC20Mintable(_token).burnToReserve(amount);
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

    // -------------- Service transactional functions ------------- //
    /**
     * @dev Migrate the liquidity pool state to a new version.
     *
     * Actually, this function just clears the `_market` address,
     */
    function migrate() external {
        _market = address(0);
    }

    // ------------------ Hook transactional functions ------------ //

    /// @inheritdoc ILiquidityPoolHooks
    function onBeforeLiquidityIn(uint256 amount) external whenNotPaused onlyRole(LIQUIDITY_OPERATOR_ROLE) {
        if (amount > type(uint64).max) {
            revert BalanceExcess();
        }
        uint256 balance = _borrowableBalance;
        unchecked {
            balance += amount;
        }
        if (balance > type(uint64).max) {
            revert BalanceExcess();
        }
        _borrowableBalance = uint64(balance);
    }

    /// @inheritdoc ILiquidityPoolHooks
    function onBeforeLiquidityOut(uint256 amount) external whenNotPaused onlyRole(LIQUIDITY_OPERATOR_ROLE) {
        uint256 balance = _borrowableBalance;
        if (amount > balance) {
            revert BalanceInsufficient();
        }
        unchecked {
            balance -= amount;
        }
        _borrowableBalance = uint64(balance);
    }

    // ------------------ View functions -------------------------- //

    /// @inheritdoc ILiquidityPoolConfiguration
    function isLiquidityOperator(address operator) external view returns (bool) {
        return _isLiquidityOperator(operator);
    }

    /// @inheritdoc ILiquidityPoolPrimary
    function addonTreasury() external view returns (address) {
        return _addonTreasury;
    }

    /// @inheritdoc ILiquidityPoolPrimary
    function operationalTreasury() external view returns (address) {
        return _operationalTreasury;
    }

    /// @inheritdoc ILiquidityPoolPrimary
    function getBalances() external view returns (uint256, uint256) {
        return (_borrowableBalance, _addonsBalance);
    }

    /// @inheritdoc ILiquidityPoolPrimary
    function token() external view returns (address) {
        return _token;
    }

    // ------------------ Pure functions -------------------------- //

    /// @inheritdoc ILiquidityPool
    function proveLiquidityPool() external pure {}

    // ------------------ Internal functions ---------------------- //

    /**
     * @dev Deposits the tokens into the liquidity pool internally.
     * @param amount The amount of tokens to deposit.
     * @param sender The address of the tokens sender.
     */
    function _deposit(uint256 amount, address sender) internal {
        if (amount == 0) {
            revert Error.InvalidAmount();
        }

        IERC20 underlyingToken = IERC20(_token);

        _borrowableBalance += amount.toUint64();
        if (sender != address(this)) {
            underlyingToken.safeTransferFrom(sender, address(this), amount);
        }

        emit Deposit(amount);
    }

    /**
     * @dev Withdraws the tokens from the liquidity pool internally.
     * @param borrowableAmount The amount of borrowable tokens to withdraw.
     * @param addonAmount The amount of addon tokens to withdraw.
     * @param recipient The address of the tokens recipient.
     */
    function _withdraw(uint256 borrowableAmount, uint256 addonAmount, address recipient) internal {
        if (borrowableAmount == 0) {
            revert Error.InvalidAmount();
        }
        if (addonAmount != 0) {
            revert Error.InvalidAmount();
        }

        if (_borrowableBalance < borrowableAmount) {
            revert BalanceInsufficient();
        }

        _borrowableBalance -= borrowableAmount.toUint64();

        if (recipient != address(this)) {
            IERC20(_token).safeTransfer(recipient, borrowableAmount);
        }

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
        emit AddonTreasuryChanged(newTreasury, oldTreasury);
        _addonTreasury = newTreasury;
    }

    /**
     * @dev Sets the new address of the operational treasury internally.
     * @param newTreasury The new address of the operational treasury.
     */
    function _setOperationalTreasury(address newTreasury) internal {
        address oldTreasury = _operationalTreasury;
        if (oldTreasury == newTreasury) {
            revert Error.AlreadyConfigured();
        }
        if (newTreasury != address(0)) {
            if (IERC20(_token).allowance(newTreasury, address(this)) == 0) {
                revert OperationalTreasuryZeroAllowanceForPool();
            }
        }
        emit OperationalTreasuryChanged(newTreasury, oldTreasury);
        _operationalTreasury = newTreasury;
    }

    /**
     * @dev Configures a new liquidity operator internally.
     * @param newOperator The new address of the liquidity operator to configure.
     */
    function _configureLiquidityOperator(address newOperator) internal {
        if (newOperator == address(0)) {
            revert Error.ZeroAddress();
        }
        if (hasRole(LIQUIDITY_OPERATOR_ROLE, newOperator)) {
            revert Error.AlreadyConfigured();
        }
        _grantRole(LIQUIDITY_OPERATOR_ROLE, newOperator);

        IERC20 underlyingToken = IERC20(_token);

        if (underlyingToken.allowance(address(this), newOperator) == 0) {
            underlyingToken.approve(newOperator, type(uint256).max);
        }

        emit LiquidityOperatorConfigured(newOperator);
    }

    /**
     * @dev Deconfigures a liquidity operator internally.
     * @param operator The address of the liquidity operator to deconfigure.
     */
    function _deconfigureLiquidityOperator(address operator) internal {
        if (!hasRole(LIQUIDITY_OPERATOR_ROLE, operator)) {
            revert Error.AlreadyConfigured();
        }
        _revokeRole(LIQUIDITY_OPERATOR_ROLE, operator);

        IERC20 underlyingToken = IERC20(_token);
        underlyingToken.approve(operator, 0);

        emit LiquidityOperatorDeconfigured(operator);
    }

    /**
     * @dev Checks if an address is a liquidity operator internally.
     * @param operator The address to check.
     * @return True if the address is a liquidity operator, false otherwise.
     */
    function _isLiquidityOperator(address operator) internal view returns (bool) {
        IERC20 underlyingToken = IERC20(_token);

        return
            hasRole(LIQUIDITY_OPERATOR_ROLE, operator) &&
            underlyingToken.allowance(address(this), operator) > 0;
    }

    /// @dev Returns the operational treasury address and validates it.
    function _getAndCheckOperationalTreasury() internal view returns (address) {
        address operationalTreasury_ = _operationalTreasury;
        if (operationalTreasury_ == address(0)) {
            revert OperationalTreasuryAddressZero();
        }
        return operationalTreasury_;
    }

    /**
     * @dev The upgrade validation function for the UUPSExtUpgradeable contract.
     * @param newImplementation The address of the new implementation.
     *
     */
    function _validateUpgrade(address newImplementation) internal view override onlyRole(OWNER_ROLE) {
        try ILiquidityPool(newImplementation).proveLiquidityPool() {} catch {
            revert Error.ImplementationAddressInvalid();
        }
    }
}
