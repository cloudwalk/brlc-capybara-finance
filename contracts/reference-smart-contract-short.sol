// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

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
 * @dev The simplified interface of an ERC-20 token smart-contract with only needed functions.
 *
 * Details about the ERC-20 standard and its functions can be found here: https://eips.ethereum.org/EIPS/eip-20
 */
interface IERC20 {
    function transferFrom(address from, address to, uint256 value) external;
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
contract ReferenceContract is ReferenceContractStorage, Versionable, IReferenceContract {
    // ------------------ Constants ------------------------------- //

    /// @dev The kind of operation that is deposit.
    uint256 internal constant OPERATION_KIND_DEPOSIT = 0;

    /// @dev The kind of operation that is withdrawal.
    uint256 internal constant OPERATION_KIND_WITHDRAWAL = 1;

    // ------------------ Constructor ----------------------------- //

    /**
     * @dev Provides the initial configuration of the smart contract.
     * @param token_ The address of the token to set as the underlying one.
     */
    constructor(address token_) {
        if (token_ == address(0)) {
            revert ReferenceContract_TokenAddressZero();
        }

        _token = token_;

        emit UnderlyingTokenChanged(token_, address(0));
    }

    // ------------------ Transactional functions ----------------- //

    /**
     * @inheritdoc IReferenceContractConfiguration
     *
     * @dev Requirements:
     *
     * - The new operational treasury address must not be zero.
     * - The new operational treasury address must not be the same as already configured.
     */
    function setOperationalTreasury(address newTreasury) external {
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
     * - The provided account address must not be zero.
     * - The provided operation identifier must not be zero.
     */
    function deposit(
        address account, // Tools: this comment prevents Prettier from formatting into a single line.
        uint256 amount,
        bytes32 opId
    ) external {
        _checkOperationParameters(account, amount, opId);
        _executeOperation(account, amount, opId, OPERATION_KIND_DEPOSIT);
    }

    /**
     * @inheritdoc IReferenceContractPrimary
     *
     * @dev Requirements:
     *
     * - The provided account address must not be zero.
     * - The provided operation identifier must not be zero.
     */
    function withdraw(
        address account, // Tools: this comment prevents Prettier from formatting into a single line.
        uint256 amount,
        bytes32 opId
    ) external {
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
}
