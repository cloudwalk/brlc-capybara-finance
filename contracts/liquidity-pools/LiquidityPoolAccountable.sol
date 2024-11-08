// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

import { Loan } from "../common/libraries/Loan.sol";
import { Error } from "../common/libraries/Error.sol";
import { SafeCast } from "../common/libraries/SafeCast.sol";

import { ICreditLine } from "../common/interfaces/core/ICreditLine.sol";
import { ILendingMarket } from "../common/interfaces/core/ILendingMarket.sol";
import { ILiquidityPool } from "../common/interfaces/core/ILiquidityPool.sol";
import { ILiquidityPoolAccountable } from "../common/interfaces/ILiquidityPoolAccountable.sol";
import { AccessControlExtUpgradeable } from "../common/AccessControlExtUpgradeable.sol";
import { Versionable } from "../common/Versionable.sol";

/// @title LiquidityPoolAccountable contract
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Implementation of the accountable liquidity pool contract.
contract LiquidityPoolAccountable is
    AccessControlExtUpgradeable,
    PausableUpgradeable,
    ILiquidityPoolAccountable,
    Versionable
{
    using SafeERC20 for IERC20;
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

    /// @dev The borrowable balance of the liquidity pool.
    uint64 internal _borrowableBalance;

    /// @dev The addons balance of the liquidity pool.
    uint64 internal _addonsBalance;

    /// @dev This empty reserved space is put in place to allow future versions
    /// to add new variables without shifting down storage in the inheritance chain.
    uint256[46] private __gap;

    // -------------------------------------------- //
    //  Errors                                      //
    // -------------------------------------------- //

    /// @dev Thrown when the token source balance is insufficient.
    error InsufficientBalance();

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
    /// @param lender_ The address of the liquidity pool lender.
    /// @param market_ The address of the lending market.
    /// @param token_ The address of the token.
    /// See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
    function initialize(
        address lender_, // Tools: this comment prevents Prettier from formatting into a single line.
        address market_,
        address token_
    ) external initializer {
        __LiquidityPoolAccountable_init(lender_, market_, token_);
    }

    /// @dev Internal initializer of the upgradable contract.
    /// @param lender_ The address of the liquidity pool lender.
    /// @param market_ The address of the lending market.
    /// @param token_ The address of the token.
    /// See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
    function __LiquidityPoolAccountable_init(
        address lender_,
        address market_,
        address token_
    ) internal onlyInitializing {
        __Context_init_unchained();
        __ERC165_init_unchained();
        __AccessControl_init_unchained();
        __AccessControlExt_init_unchained();
        __Pausable_init_unchained();
        __LiquidityPoolAccountable_init_unchained(lender_, market_, token_);
    }

    /// @dev Unchained internal initializer of the upgradable contract.
    /// @param lender_ The address of the liquidity pool lender.
    /// @param market_ The address of the lending market.
    /// @param token_ The address of the token.
    /// See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
    function __LiquidityPoolAccountable_init_unchained(
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
    //  Owner functions                            //
    // -------------------------------------------- //

    /// @inheritdoc ILiquidityPoolAccountable
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

    /// @inheritdoc ILiquidityPoolAccountable
    function withdraw(uint256 borrowableAmount, uint256 addonAmount) external onlyRole(OWNER_ROLE) {
        if (borrowableAmount == 0 && addonAmount == 0) {
            revert Error.InvalidAmount();
        }

        if (_borrowableBalance < borrowableAmount) {
            revert InsufficientBalance();
        }
        if (_addonsBalance < addonAmount) {
            revert InsufficientBalance();
        }

        _borrowableBalance -= borrowableAmount.toUint64();
        _addonsBalance -= addonAmount.toUint64();

        IERC20(_token).safeTransfer(msg.sender, borrowableAmount + addonAmount);

        emit Withdrawal(borrowableAmount, addonAmount);
    }

    /// @inheritdoc ILiquidityPoolAccountable
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
    //  Admin functions                             //
    // -------------------------------------------- //

    /// @inheritdoc ILiquidityPoolAccountable
    function autoRepay(uint256[] memory loanIds, uint256[] memory amounts) external onlyRole(ADMIN_ROLE) {
        if (loanIds.length != amounts.length) {
            revert Error.ArrayLengthMismatch();
        }

        emit AutoRepayment(loanIds.length);

        ILendingMarket lendingMarket = ILendingMarket(_market);
        for (uint256 i = 0; i < loanIds.length; i++) {
            lendingMarket.repayLoan(loanIds[i], amounts[i]);
        }
    }

    // -------------------------------------------- //
    //  Market functions                            //
    // -------------------------------------------- //

    /// @inheritdoc ILiquidityPool
    function onBeforeLoanTaken(uint256 loanId) external whenNotPaused onlyMarket returns (bool) {
        Loan.State memory loan = ILendingMarket(_market).getLoanState(loanId);
        _borrowableBalance -= loan.borrowAmount + loan.addonAmount;
        _addonsBalance += loan.addonAmount;
        return true;
    }

    /// @inheritdoc ILiquidityPool
    function onAfterLoanPayment(uint256 loanId, uint256 amount) external whenNotPaused onlyMarket returns (bool) {
        loanId; // To prevent compiler warning about unused variable
        _borrowableBalance += amount.toUint64();
        return true;
    }

    /// @inheritdoc ILiquidityPool
    function onAfterLoanRevocation(uint256 loanId) external whenNotPaused onlyMarket returns (bool) {
        Loan.State memory loan = ILendingMarket(_market).getLoanState(loanId);
        if (loan.borrowAmount > loan.repaidAmount) {
            _borrowableBalance = _borrowableBalance + (loan.borrowAmount - loan.repaidAmount) + loan.addonAmount;
        } else if (loan.borrowAmount != loan.repaidAmount) {
            _borrowableBalance = _borrowableBalance - (loan.repaidAmount - loan.borrowAmount) + loan.addonAmount;
        }
        _addonsBalance -= loan.addonAmount;
        return true;
    }

    // -------------------------------------------- //
    //  View functions                              //
    // -------------------------------------------- //

    /// @inheritdoc ILiquidityPoolAccountable
    function getBalances() external view returns (uint256, uint256) {
        return (_borrowableBalance, _addonsBalance);
    }

    /// @inheritdoc ILiquidityPoolAccountable
    function isAdmin(address account) external view returns (bool) {
        return hasRole(ADMIN_ROLE, account);
    }

    /// @inheritdoc ILiquidityPool
    function market() external view returns (address) {
        return _market;
    }

    /// @inheritdoc ILiquidityPool
    function token() external view returns (address) {
        return _token;
    }
}
