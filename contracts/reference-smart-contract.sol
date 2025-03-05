// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title IReferenceContractTypes interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the types used in the reference smart contract.
 *
 * See details about the contract in the comments of the {IReferenceContract} interface.
 *
 * The place in the project file structure: file `<main_smart_contracts_folder>/interfaces/IReferenceContractTypes.sol`.
 */
interface IReferenceContractTypes {
    /**
     * @dev Possible statuses of a an operation used in the reference smart contract.
     *
     * The values:
     *
     * - Nonexistent = 0 -- The operation does not exist (the default value).
     * - Deposit = 1 ------ The deposit operation has been executed.
     * - Withdrawal = 2 --- The withdrawal operation has been executed.
     */
    enum OperationStatus {
        Nonexistent,
        Deposit,
        Withdrawal
    }

    /**
     * @dev The structure with data of a single operation of the reference smart-contract.
     *
     * The fields:
     *
     * - status --- The status of the operation according to the {OperationStatus} enum.
     * - account -- The address of the account involved in the operation.
     * - amount --- The amount parameter of the related operation.
     */
    struct Operation {
        OperationStatus status;
        address account;
        uint64 amount;
        // uint24 __reserved; // Reserved for future use until the end of the storage slot.
    }
}

/**
 * @title IReferenceContractPrimary interface
 * @author CloudWalk Inc. (See https://cloudwalk.io)
 * @dev The primary part of the reference smart contract interface.
 *
 * The place in the project file structure: file `<main_smart_contracts_folder>/interfaces/IReferenceContract.sol`.
 */
interface IReferenceContractPrimary is IReferenceContractTypes {
    // ------------------ Events ---------------------------------- //

    /**
     * @dev Emitted when the balance of a specific account on the smart contract has been updated.
     *
     * The balance update can happen due to a deposit or withdrawal operation.
     *
     * @param opId The off-chain identifier of the operation.
     * @param account The account whose balance has been updated.
     * @param newBalance The updated balance of the account.
     * @param oldBalance The previous balance of the account.
     */
    event BalanceUpdated(
        bytes32 indexed opId, // Tools: this comment prevents Prettier from formatting into a single line.
        address indexed account,
        uint256 newBalance,
        uint256 oldBalance
    );

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Deposits tokens to the smart-contract.
     *
     * During the function call the specified amount of tokens will be transferred from the caller to
     * the configured treasury of the contract and the balance of the provided account will be increased accordingly.
     *
     * This function can be called only by an account with a special role.
     *
     * Emits a {BalanceUpdated} event.
     *
     * @param account The account to increase balance for.
     * @param amount The amount to increase the balance by.
     * @param opId The off-chain identifier of the operation.
     */
    function deposit(
        address account, // Tools: this comment prevents Prettier from formatting into a single line.
        uint256 amount,
        bytes32 opId
    ) external;

    /**
     * @dev Withdraws tokens from the smart-contract.
     *
     * During the function call the specified amount of tokens will be transferred back from
     * the configured treasury of the contract to the provided account and
     * the balance of the account will be decreased accordingly.
     *
     * This function can be called only by an account with a special role.
     *
     * Emits a {BalanceUpdated} event.
     *
     * @param account The account to decrease the balance for.
     * @param amount The amount to decrease the balance by.
     * @param opId The off-chain identifier of the operation.
     */
    function withdraw(
        address account, // Tools: this comment prevents Prettier from formatting into a single line.
        uint256 amount,
        bytes32 opId
    ) external;

    // ------------------ View and pure functions ----------------- //

    /**
     * @dev Returns the data of a single operation on the smart-contract.
     * @param opId The off-chain identifier of the operation.
     * @return operation The data of the operation.
     */
    function getOperation(bytes32 opId) external view returns (Operation memory operation);

    /**
     * @dev Retrieves the balance of an account.
     *
     * @param account The account to check the balance of.
     * @return The resulting amount of tokens that were transferred to the contract after all operations.
     */
    function balanceOf(address account) external view returns (uint256);

    /// @dev Returns the address of the underlying token contract.
    function underlyingToken() external view returns (address);

    /**
     * @dev Proves the contract is the reference one. A marker function.
     *
     * It is used for simple contract compliance checks, e.g. during an upgrade.
     * This avoids situations where a wrong contract address is specified by mistake.
     */
    function proveReferenceContract() external pure;
}

/**
 * @title IReferenceContractConfiguration interface
 * @author CloudWalk Inc. (See https://cloudwalk.io)
 * @dev The configuration part of the reference smart contract interface.
 *
 * The place in the project file structure: file `<main_smart_contracts_folder>/interfaces/IReferenceContract.sol`.
 */
interface IReferenceContractConfiguration {
    // ------------------ Events ---------------------------------- //

    /**
     * @dev Emitted when the underlying token address has been changed.
     *
     * Currently the underlying token address is only set during initialization but it might be changed in the future.
     *
     * @param newToken The updated address of the operational treasury.
     * @param oldToken The previous address of the operational treasury.
     */
    event UnderlyingTokenChanged(address newToken, address oldToken);

    /**
     * @dev Emitted when the operational treasury address has been changed.
     *
     * See the {operationalTreasury} view function comments for more details.
     *
     * @param newTreasury The updated address of the operational treasury.
     * @param oldTreasury The previous address of the operational treasury.
     */
    event OperationalTreasuryChanged(address newTreasury, address oldTreasury);

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Sets the operational treasury address.
     *
     * This function can be called only by an account with a special role.
     *
     * Emits an {OperationalTreasuryChanged} event.
     *
     * @param newTreasury The new address of the operational treasury to set.
     */
    function setOperationalTreasury(address newTreasury) external;

    // ------------------ View functions -------------------------- //

    /// @dev Returns the address of the operational treasury of this smart-contract.
    function operationalTreasury() external view returns (address);
}

/**
 * @title IReferenceContractErrors interface
 * @author CloudWalk Inc. (See https://cloudwalk.io)
 * @dev Defines the custom errors used in the reference contract.
 *
 * The errors are ordered alphabetically.
 *
 * The place in the project file structure: file `<main_smart_contracts_folder>/interfaces/IReferenceContract.sol`.
 */
interface IReferenceContractErrors {
    /// @dev Thrown if the provided account address is zero.
    error ReferenceContract_AccountAddressZero();

    /// @dev Thrown if the provided amount is greater than the allowed maximum.
    error ReferenceContract_AmountExcess();

    /// @dev Thrown if the provided new implementation address is not of a reference contract.
    error ReferenceContract_ImplementationAddressInvalid();

    /**
     * @dev Thrown if the operation with the provided identifier is already executed.
     * @param opId The provided off-chain identifier of the related operation.
     */
    error ReferenceContract_OperationAlreadyExecuted(bytes32 opId);

    /// @dev Thrown if the provided operation ID is zero.
    error ReferenceContract_OperationIdZero();

    /**
     * @dev Thrown if the provided underlying token address is zero.
     *
     * This error can be thrown during the contract initialization.
     */
    error ReferenceContract_TokenAddressZero();

    /// @dev Thrown if the provided treasury address is already configured.
    error ReferenceContract_TreasuryAddressAlreadyConfigured();

    /// @dev Thrown if the provided treasury address is zero.
    error ReferenceContract_TreasuryAddressZero();
}

/**
 * @title IReferenceContract interface
 * @author CloudWalk Inc. (See https://cloudwalk.io)
 * @dev The full interface of the reference smart contract.
 *
 * The smart contract is designed to deposit or withdraw tokens with specifying an external (off-chain) identifier.
 * The contract itself does not store tokens on its account.
 * It uses an external storage called the operational treasury that can be configured by the owner of the contract.
 * The contract can be paused, in that case only configuration and non-transactional functions can be called.
 * Depositing, withdrawal, and similar functions are reverted if the contract is paused.
 *
 * The place in the project file structure: file `<main_smart_contracts_folder>/interfaces/IReferenceContract.sol`.
 */
interface IReferenceContract is IReferenceContractPrimary, IReferenceContractConfiguration, IReferenceContractErrors {}

/**
 * @title IVersionable interface
 * @author CloudWalk Inc. (See https://cloudwalk.io)
 * @dev Defines the function of getting the contract version.
 *
 * The place in the project file structure: file `<main_smart_contracts_folder>/interfaces/IVersionable.sol`.
 */
interface IVersionable {
    /**
     * @dev The structure for the contract version.
     *
     * The fields:
     *
     * - major -- The major version of contract.
     * - minor -- The minor version of contract.
     * - patch -- The patch version of contract.
     */
    struct Version {
        uint16 major;
        uint16 minor;
        uint16 patch;
    }

    /// @dev Returns the version of the contract.
    function $__VERSION() external pure returns (Version memory);
}

/**
 * @title AccessControlExtUpgradeable base contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Extends the OpenZeppelin's {AccessControlUpgradeable} contract by adding the functions
 *      for granting and revoking roles in batch.
 *
 * The place in the project file structure: file `<main_smart_contracts_folder>/base/AccessControlExtUpgradeable.sol`.
 */
abstract contract AccessControlExtUpgradeable is AccessControlUpgradeable {
    // ------------------ Initializers ---------------------------- //

    /**
     * @dev Internal initializer of the upgradable contract.
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
     */
    function __AccessControlExt_init() internal onlyInitializing {
        __Context_init_unchained();
        __ERC165_init_unchained();
        __AccessControl_init_unchained();

        __AccessControlExt_init_unchained();
    }

    /**
     * @dev Unchained internal initializer of the upgradable contract.
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
     */
    function __AccessControlExt_init_unchained() internal onlyInitializing {}

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Grants a role to accounts in batch.
     *
     * Emits a {RoleGranted} event for each account that has not been granted the provided role previously.
     *
     * Requirement: the caller must have the role that is the admin for the role that is being granted.
     *
     * @param role The role to grant.
     * @param accounts The accounts to grant the role to.
     */
    function grantRoleBatch(bytes32 role, address[] memory accounts) public virtual onlyRole(getRoleAdmin(role)) {
        for (uint i = 0; i < accounts.length; i++) {
            _grantRole(role, accounts[i]);
        }
    }

    /**
     * @dev Revokes a role to accounts in batch.
     *
     * Emits a {RoleRevoked} event for each account that has the provided role previously.
     *
     * Requirement: the caller must have the role that is the admin for the role that is being revoked.
     * @param role The role to revoke.
     * @param accounts The accounts to revoke the role from.
     */
    function revokeRoleBatch(bytes32 role, address[] memory accounts) public virtual onlyRole(getRoleAdmin(role)) {
        for (uint i = 0; i < accounts.length; i++) {
            _revokeRole(role, accounts[i]);
        }
    }
}

/**
 * @title PausableExtUpgradeable base contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Extends the OpenZeppelin's {PausableUpgradeable} contract by adding the {PAUSER_ROLE} role and implementing
 *      the external pausing and unpausing functions.
 *
 * The place in the project file structure: file `<main_smart_contracts_folder>/base/PausableExtUpgradeable.sol`.
 */
abstract contract PausableExtUpgradeable is AccessControlExtUpgradeable, PausableUpgradeable {
    // ------------------ Constants ------------------------------- //

    /// @dev The role of pauser that is allowed to trigger the paused or unpaused state of the contract.
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // ------------------ Initializers ---------------------------- //

    /**
     * @dev Internal initializer of the upgradable contract.
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
     *
     * @param pauserRoleAdmin The admin for the {PAUSER_ROLE} role.
     */
    function __PausableExt_init(bytes32 pauserRoleAdmin) internal onlyInitializing {
        __Context_init_unchained();
        __ERC165_init_unchained();
        __AccessControl_init_unchained();
        __AccessControlExt_init_unchained();
        __Pausable_init_unchained();

        __PausableExt_init_unchained(pauserRoleAdmin);
    }

    /**
     * @dev Unchained internal initializer of the upgradable contract.
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
     *
     * @param pauserRoleAdmin The admin for the {PAUSER_ROLE} role.
     */
    function __PausableExt_init_unchained(bytes32 pauserRoleAdmin) internal onlyInitializing {
        _setRoleAdmin(PAUSER_ROLE, pauserRoleAdmin);
    }

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Triggers the paused state of the contract.
     *
     * Requirement: the caller must have the {PAUSER_ROLE} role.
     */
    function pause() public onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /**
     * @dev Triggers the unpaused state of the contract.
     *
     * Requirement: the caller must have the {PAUSER_ROLE} role.
     */
    function unpause() public onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}

/**
 * @title RescuableUpgradeable base contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Allows to rescue ERC20 tokens locked up in the contract using the {RESCUER_ROLE} role.
 *
 * The place in the project file structure: file `<main_smart_contracts_folder>/base/RescuableUpgradeable.sol`.
 */
abstract contract RescuableUpgradeable is AccessControlExtUpgradeable {
    /// @dev The role of rescuer that is allowed to rescue tokens locked up in the contract.
    bytes32 public constant RESCUER_ROLE = keccak256("RESCUER_ROLE");

    // ------------------ Initializers ---------------------------- //

    /**
     * @dev Internal initializer of the upgradable contract.
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
     *
     * @param rescuerRoleAdmin The admin for the {RESCUER_ROLE} role.
     */
    function __Rescuable_init(bytes32 rescuerRoleAdmin) internal onlyInitializing {
        __Context_init_unchained();
        __ERC165_init_unchained();
        __AccessControl_init_unchained();
        __AccessControlExt_init_unchained();

        __Rescuable_init_unchained(rescuerRoleAdmin);
    }

    /**
     * @dev Unchained internal initializer of the upgradable contract.
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
     *
     * @param rescuerRoleAdmin The admin for the {RESCUER_ROLE} role.
     */
    function __Rescuable_init_unchained(bytes32 rescuerRoleAdmin) internal onlyInitializing {
        _setRoleAdmin(RESCUER_ROLE, rescuerRoleAdmin);
    }

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Rescues tokens from this contract that accidentally were transferred to it.
     *
     * Does not emit special events except ones related to the token transfer.
     *
     * Requirements:
     *
     * - The caller must have the {RESCUER_ROLE} role.
     * - The provided account address must not be zero.
     *
     * @param token The address of the token smart contract to rescue its coins from this smart contract's account.
     * @param account The account to transfer the rescued tokens to.
     * @param amount The amount the tokens to rescue.
     */
    function rescueERC20(
        address token, // Tools: this comment prevents Prettier from formatting into a single line.
        address account,
        uint256 amount
    ) public onlyRole(RESCUER_ROLE) {
        IERC20(token).transfer(account, amount);
    }
}

/**
 * @title UUPSExtUpgradeable base contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Extends the OpenZeppelin's {UUPSUpgradeable} contract with additional checks for the new implementation address.
 *
 * The place in the project file structure: file `<main_smart_contracts_folder>/base/UUPSExtUpgradeable.sol`.
 */
abstract contract UUPSExtUpgradeable is UUPSUpgradeable {
    // ------------------ Errors ---------------------------------- //

    /// @dev Thrown if the provided new implementation address is not a contract.
    error UUPSExtUpgradeable_ImplementationAddressNotContract();

    /// @dev Thrown if the provided new implementation contract address is zero.
    error UUPSExtUpgradeable_ImplementationAddressZero();

    // ------------------ Internal functions ---------------------- //

    /**
     * @dev Overrides the upgrade authorization function for UUPSProxy.
     * @param newImplementation The address of the new implementation of a proxy smart contract.
     */
    function _authorizeUpgrade(address newImplementation) internal override {
        if (newImplementation == address(0)) {
            revert UUPSExtUpgradeable_ImplementationAddressZero();
        }

        if (newImplementation.code.length == 0) {
            revert UUPSExtUpgradeable_ImplementationAddressNotContract();
        }

        _validateUpgrade(newImplementation);
    }

    /**
     * @dev Executes further validation steps of the upgrade including authorization and implementation address checks.
     *
     * It is expected that this function will be overridden in successor contracts.
     *
     * @param newImplementation The address of the new implementation.
     */
    function _validateUpgrade(address newImplementation) internal virtual;
}

/**
 * @title Versionable base contract
 * @author CloudWalk Inc. (See https://cloudwalk.io)
 * @dev Defines the contract version.
 *
 * The place in the project file structure: file `<main_smart_contracts_folder>/base/Versionable.sol`.
 */
abstract contract Versionable is IVersionable {
    /// @inheritdoc IVersionable
    function $__VERSION() external pure returns (Version memory) {
        return Version(1, 0, 0);
    }
}

/**
 * @title ReferenceContractStorage contract
 * @author CloudWalk Inc. (See https://cloudwalk.io)
 * @dev Defines the storage layout for the reference smart-contract.
 *
 * See details about the contract in the comments of the {IReferenceContract} interface.
 *
 * The place in the project file structure: file `<main_smart_contracts_folder>/ReferenceContractStorage.sol`.
 */
abstract contract ReferenceContractStorage is IReferenceContractTypes {
    /// @dev The address of the underlying token.
    address internal _token;

    /**
     * @dev The address of the operational treasury.
     *
     * The operational treasury is used to deposit and withdraw tokens through special functions.
     */
    address internal _operationalTreasury;

    /// @dev The mapping of an operation structure for a given off-chain operation identifier.
    mapping(bytes32 => Operation) internal _operations;

    /// @dev The mapping of a balance for a given account.
    mapping(address => uint256) internal _balances;

    /**
     * @dev This empty reserved space is put in place to allow future versions
     *      to add new variables without shifting down storage in the inheritance chain.
     */
    uint256[46] private __gap;
}

/**
 * @title ReferenceContract contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The contract that responsible for freezing operations on the underlying token contract.
 *
 * See details about the contract in the comments of the {IReferenceContract} interface.
 */
contract ReferenceContract is
    ReferenceContractStorage,
    AccessControlExtUpgradeable,
    PausableExtUpgradeable,
    RescuableUpgradeable,
    UUPSExtUpgradeable,
    Versionable,
    IReferenceContract
{
    // ------------------ Constants ------------------------------- //

    /// @dev The role of this contract owner.
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");

    /// @dev The role of manager that is allowed to deposit and withdraw tokens to the contract.
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    /// @dev The kind of operation that is deposit.
    uint256 internal constant OPERATION_KIND_DEPOSIT = 0;

    /// @dev The kind of operation that is withdrawal.
    uint256 internal constant OPERATION_KIND_WITHDRAWAL = 1;

    // ------------------ Constructor ----------------------------- //

    /// @dev Constructor that prohibits the initialization of the implementation of the upgradable contract.
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // ------------------ Initializers ---------------------------- //

    /**
     * @dev Initializer of the upgradable contract.
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
     *
     * @param token_ The address of the token to set as the underlying one.
     */
    function initialize(address token_) external initializer {
        __ReferenceContract_init(token_);
    }

    /**
     * @dev Internal initializer of the upgradable contract.
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
     *
     * @param token_ The address of the token to set as the underlying one.
     */
    function __ReferenceContract_init(address token_) internal onlyInitializing {
        __Context_init_unchained();
        __ERC165_init_unchained();
        __AccessControl_init_unchained();
        __AccessControlExt_init_unchained();
        __Pausable_init_unchained();
        __PausableExt_init_unchained(OWNER_ROLE);
        __Rescuable_init_unchained(OWNER_ROLE);
        __UUPSUpgradeable_init_unchained();

        __ReferenceContract_init_unchained(token_);
    }

    /**
     * @dev Unchained internal initializer of the upgradable contract.
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
     *
     * Requirement: the passed address of the underlying token must not be zero.
     *
     * @param token_ The address of the token to set as the underlying one.
     */
    function __ReferenceContract_init_unchained(address token_) internal onlyInitializing {
        if (token_ == address(0)) {
            revert ReferenceContract_TokenAddressZero();
        }

        _token = token_;

        _setRoleAdmin(OWNER_ROLE, OWNER_ROLE);
        _setRoleAdmin(MANAGER_ROLE, OWNER_ROLE);
        _grantRole(OWNER_ROLE, _msgSender());

        emit UnderlyingTokenChanged(token_, address(0));
    }

    // ------------------ Transactional functions ----------------- //

    /**
     * @inheritdoc IReferenceContractConfiguration
     *
     * @dev Requirements:
     *
     * - The caller must have the {MANAGER_ROLE} role.
     * - The new operational treasury address must not be zero.
     * - The new operational treasury address must not be the same as already configured.
     */
    function setOperationalTreasury(address newTreasury) external onlyRole(MANAGER_ROLE) {
        if (newTreasury == address(0)) {
            revert ReferenceContract_TreasuryAddressZero();
        }
        address oldTreasury = _operationalTreasury;
        if (newTreasury == oldTreasury) {
            revert ReferenceContract_TreasuryAddressAlreadyConfigured();
        }

        emit OperationalTreasuryChanged(newTreasury, oldTreasury);
        _operationalTreasury = newTreasury;
    }

    /**
     * @inheritdoc IReferenceContractPrimary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {MANAGER_ROLE} role.
     * - The provided account address must not be zero.
     * - The provided operation identifier must not be zero.
     */
    function deposit(
        address account, // Tools: this comment prevents Prettier from formatting into a single line.
        uint256 amount,
        bytes32 opId
    ) external whenNotPaused onlyRole(MANAGER_ROLE) {
        _checkOperationParameters(account, amount, opId);
        _executeOperation(account, amount, opId, OPERATION_KIND_DEPOSIT);
    }

    /**
     * @inheritdoc IReferenceContractPrimary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {MANAGER_ROLE} role.
     * - The provided account address must not be zero.
     * - The provided operation identifier must not be zero.
     */
    function withdraw(
        address account, // Tools: this comment prevents Prettier from formatting into a single line.
        uint256 amount,
        bytes32 opId
    ) external whenNotPaused onlyRole(MANAGER_ROLE) {
        _checkOperationParameters(account, amount, opId);
        _executeOperation(account, amount, opId, OPERATION_KIND_WITHDRAWAL);
    }

    // ------------------ View functions -------------------------- //

    /// @inheritdoc IReferenceContractPrimary
    function getOperation(bytes32 opId) external view returns (Operation memory) {
        return _operations[opId];
    }

    /// @inheritdoc IReferenceContractPrimary
    function balanceOf(address account) public view returns (uint256) {
        return _balances[account];
    }

    /// @inheritdoc IReferenceContractPrimary
    function underlyingToken() external view returns (address) {
        return _token;
    }

    /// @inheritdoc IReferenceContractConfiguration
    function operationalTreasury() external view returns (address) {
        return _operationalTreasury;
    }

    // ------------------ Pure functions -------------------------- //

    /// @inheritdoc IReferenceContractPrimary
    function proveReferenceContract() external pure {}

    // ------------------ Internal functions ---------------------- //

    /**
     * @dev Checks the parameters of an operation.
     * @param account The account involved in the operation.
     * @param amount The amount of the operation.
     * @param opId The off-chain identifier of the operation.
     */
    function _checkOperationParameters(address account, uint256 amount, bytes32 opId) internal view {
        if (account == address(0)) {
            revert ReferenceContract_AccountAddressZero();
        }
        if (opId == bytes32(0)) {
            revert ReferenceContract_OperationIdZero();
        }
        if (_operations[opId].status == OperationStatus.Nonexistent) {
            revert ReferenceContract_OperationAlreadyExecuted(opId);
        }
        if (amount >= type(uint256).max) {
            revert ReferenceContract_AmountExcess();
        }
    }

    /**
     * @dev Executes an operation on the contract.
     * @param account The account involved in the operation.
     * @param amount The amount of the operation.
     * @param opId The off-chain identifier of the operation.
     * @param operationKind The kind of operation: 0 - deposit, 1 - withdrawal.
     */
    function _executeOperation(address account, uint256 amount, bytes32 opId, uint256 operationKind) internal {
        address treasury = _getAndCheckOperationalTreasury();
        uint256 oldBalance = _balances[account];
        uint256 newBalance = oldBalance;

        Operation storage operation = _operations[opId];
        operation.account = account;
        operation.amount = uint64(amount);

        if (operationKind == OPERATION_KIND_DEPOSIT) {
            operation.status = OperationStatus.Deposit;
            newBalance += amount;
        } else {
            newBalance -= amount;
            operation.status = OperationStatus.Withdrawal;
        }

        _balances[account] = newBalance;

        emit BalanceUpdated(
            opId, // Tools: this comment prevents Prettier from formatting into a single line.
            account,
            newBalance,
            oldBalance
        );

        if (operationKind == OPERATION_KIND_DEPOSIT) {
            IERC20(_token).transferFrom(treasury, account, amount);
        } else {
            IERC20(_token).transferFrom(account, treasury, amount);
        }
    }

    /**
     * @dev Returns the operational treasury address and checks it.
     *
     * @return The operational treasury address.
     */
    function _getAndCheckOperationalTreasury() internal view returns (address) {
        address operationalTreasury_ = _operationalTreasury;
        if (operationalTreasury_ == address(0)) {
            revert ReferenceContract_TreasuryAddressZero();
        }
        return operationalTreasury_;
    }

    /**
     * @dev The upgrade validation function for the UUPSExtUpgradeable contract.
     * @param newImplementation The address of the new implementation.
     */
    function _validateUpgrade(address newImplementation) internal view override onlyRole(OWNER_ROLE) {
        try IReferenceContract(newImplementation).proveReferenceContract() {} catch {
            revert ReferenceContract_ImplementationAddressInvalid();
        }
    }
}
