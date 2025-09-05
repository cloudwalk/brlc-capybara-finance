// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import { AccessControlExtUpgradeable } from "./base/AccessControlExtUpgradeable.sol";
import { PausableExtUpgradeable } from "./base/PausableExtUpgradeable.sol";
import { UUPSExtUpgradeable } from "./base/UUPSExtUpgradeable.sol";
import { Versionable } from "./base/Versionable.sol";

import { ILendingMarketV2 } from "./interfaces/ILendingMarketV2.sol";
import { ILendingEngine } from "./interfaces/ILendingEngine.sol";
import { ILendingMarketConfigurationV2 } from "./interfaces/ILendingMarketV2.sol";
import { ILendingMarketPrimaryV2 } from "./interfaces/ILendingMarketV2.sol";

import { LendingMarketCore } from "./core/LendingMarketCore.sol";

/**
 * @title LendingMarket contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The lending market contract.
 * TODO: add description
 * See additional notes in the comments of the interface `ILendingMarket.sol`.
 */
contract LendingMarketV2 is
    LendingMarketCore,
    Initializable,
    AccessControlExtUpgradeable,
    PausableExtUpgradeable,
    ILendingMarketV2,
    Versionable,
    UUPSExtUpgradeable
{
    // ------------------ Constants ------------------------------- //

    /// @dev The role of an admin that is allowed to execute loan-related functions.
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

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
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
     */
    function initialize() external initializer {
        __AccessControlExt_init_unchained();
        __PausableExt_init_unchained();
        __UUPSExt_init_unchained();

        _setRoleAdmin(ADMIN_ROLE, GRANTOR_ROLE);
        _grantRole(OWNER_ROLE, _msgSender());

        _getLendingMarketStorage().storageKind = uint16(STORAGE_KIND_MARKET);
    }

    // ----------- Configuration transactional functions ---------- //

    /// @inheritdoc ILendingMarketConfigurationV2
    function createProgram(
        address creditLine, // Tools: prevent Prettier one-liner
        address liquidityPool
    ) external whenNotPaused onlyRole(OWNER_ROLE) {
        _checkCreditLineAndLiquidityPool(creditLine, liquidityPool);

        uint256 programId = _increaseProgramId();
        emit ProgramCreated(programId);

        _updateProgram(programId, creditLine, liquidityPool);
    }

    /// @inheritdoc ILendingMarketConfigurationV2
    function updateProgram(
        uint32 programId, // Tools: prevent Prettier one-liner
        address creditLine,
        address liquidityPool
    ) external whenNotPaused onlyRole(OWNER_ROLE) {
        if (programId == 0) {
            revert ProgramNonexistent();
        }
        _checkCreditLineAndLiquidityPool(creditLine, liquidityPool);
        _updateProgram(programId, creditLine, liquidityPool);
    }

    // -------------- Primary transactional functions ------------- //

    // All functions are redirected to the engine contract functions with the same name and parameters.

    /// @inheritdoc ILendingMarketPrimaryV2
    function takeLoan(
        address, uint256, uint256, uint256, uint256, SubLoanTakingRequest[] calldata
    ) external whenNotPaused onlyRole(ADMIN_ROLE) returns (uint256 firstSubLoanId) {
        bytes memory ret = _delegateToEngine(msg.data);
        return abi.decode(ret, (uint256));
    }

    /// @inheritdoc ILendingMarketPrimaryV2
    function revokeLoan(uint256) external whenNotPaused onlyRole(ADMIN_ROLE) {
        _delegateToEngine(msg.data);
    }

    /// @inheritdoc ILendingMarketPrimaryV2
    function repaySubLoanBatch(RepaymentRequest[] calldata) external whenNotPaused onlyRole(ADMIN_ROLE) {
        _delegateToEngine(msg.data);
    }

    /// @inheritdoc ILendingMarketPrimaryV2
    function discountSubLoanBatch(SubLoanOperationRequest[] calldata) external whenNotPaused onlyRole(ADMIN_ROLE) {
        _delegateToEngine(msg.data);
    }

    /// @inheritdoc ILendingMarketPrimaryV2
    function setSubLoanDurationBatch(SubLoanOperationRequest[] calldata) external whenNotPaused onlyRole(ADMIN_ROLE) {
        _delegateToEngine(msg.data);
    }

    /// @inheritdoc ILendingMarketPrimaryV2
    function setSubLoanInterestRateRemuneratoryBatch(
        SubLoanOperationRequest[] calldata
    ) external whenNotPaused onlyRole(ADMIN_ROLE) {
        _delegateToEngine(msg.data);
    }

    /// @inheritdoc ILendingMarketPrimaryV2
    function setSubLoanInterestRateMoratoryBatch(
        SubLoanOperationRequest[] calldata
    ) external whenNotPaused onlyRole(ADMIN_ROLE) {
        _delegateToEngine(msg.data);
    }

    /// @inheritdoc ILendingMarketPrimaryV2
    function setSubLoanLateFeeRateBatch(
        SubLoanOperationRequest[] calldata
    ) external whenNotPaused onlyRole(ADMIN_ROLE) {
        _delegateToEngine(msg.data);
    }

    /// @inheritdoc ILendingMarketPrimaryV2
    function freezeSubLoanBatch(SubLoanOperationRequest[] calldata) external whenNotPaused onlyRole(ADMIN_ROLE) {
        _delegateToEngine(msg.data);
    }

    /// @inheritdoc ILendingMarketPrimaryV2
    function unfreezeSubLoanBatch(SubLoanOperationRequest[] calldata) external whenNotPaused onlyRole(ADMIN_ROLE) {
        _delegateToEngine(msg.data);
    }

    /// @inheritdoc ILendingMarketPrimaryV2
    function voidOperationBatch(OperationVoidingRequest[] calldata) external {
        _delegateToEngine(msg.data);
    }

    // ------------------ View functions -------------------------- //

    /// @inheritdoc ILendingMarketPrimaryV2
    function getProgramCreditLineAndLiquidityPool(
        uint32 programId
    ) external view returns (address creditLine, address liquidityPool) {
        (creditLine, liquidityPool) = _getCreditLineAndLiquidityPool(programId);
    }

    /// @inheritdoc ILendingMarketPrimaryV2
    function getSubLoanStateBatch(uint256[] calldata subLoanIds) external view returns (SubLoan[] memory) {
        uint256 len = subLoanIds.length;
        SubLoan[] memory subLoans = new SubLoan[](len);
        LendingMarketStorageV2 storage storageStruct = _getLendingMarketStorage();
        for (uint256 i = 0; i < len; ++i) {
            // TODO: Replace with a special view struct
            subLoans[i] = storageStruct.subLoans[subLoanIds[i]];
        }

        return subLoans;
    }

    /// @inheritdoc ILendingMarketPrimaryV2
    function getSubLoanPreviewBatch(
        uint256[] calldata subLoanIds,
        uint256 timestamp
    ) external view returns (SubLoanPreview[] memory) {
        if (timestamp == 0) {
            timestamp = _blockTimestamp();
        }

        uint256 len = subLoanIds.length;
        SubLoanPreview[] memory previews = new SubLoanPreview[](len);
        for (uint256 i = 0; i < len; ++i) {
            ProcessingSubLoan memory subLoan = _getSubLoan(subLoanIds[i]);
            _accrueInterest(subLoan, timestamp);
            previews[i] = _getSubLoanPreview(subLoan);
        }

        return previews;
    }

    /// @inheritdoc ILendingMarketPrimaryV2
    function getLoanPreviewBatch(
        uint256[] calldata subLoanIds,
        uint256 timestamp
    ) external pure returns (LoanPreview[] memory) {
        // TODO: Implement this function
        subLoanIds; // Prevent unused variable warning
        timestamp; // Prevent unused variable warning
        return new LoanPreview[](0); // _getLoanPreview(subLoanId, timestamp);
    }

    /// @inheritdoc ILendingMarketPrimaryV2
    function interestRateFactor() external pure returns (uint256) {
        return INTEREST_RATE_FACTOR;
    }

    /// @inheritdoc ILendingMarketPrimaryV2
    function dayBoundaryOffset() external pure returns (int256) {
        return -int256(NEGATIVE_DAY_BOUNDARY_OFFSET);
    }

    /// @inheritdoc ILendingMarketPrimaryV2
    function subLoanCounter() external view returns (uint256) {
        return _getLendingMarketStorage().subLoanIdCounter;
    }

    /// @inheritdoc ILendingMarketPrimaryV2
    function programCounter() external view returns (uint256) {
        return _getLendingMarketStorage().programIdCounter;
    }

    /// @inheritdoc ILendingMarketPrimaryV2
    function getSubLoanOperations(uint256 subLoanId) external view returns (OperationView[] memory) {
        LendingMarketStorageV2 storage $ = _getLendingMarketStorage();
        SubLoan storage subLoan = $.subLoans[subLoanId];
        OperationView[] memory operations = new OperationView[](subLoan.operationCount);
        uint256 operationId = subLoan.earliestOperationId;
        for (uint256 i = 0; operationId != 0; ++i) {
            operations[i] = _getOperationView(subLoanId, operationId);
            operationId = $.subLoanOperations[subLoanId][operationId].nextOperationId;
        }
        return operations;
    }

    // ------------------ Pure functions -------------------------- //

    /// @inheritdoc ILendingMarketV2
    function proveLendingMarket() external pure {}

    // ------------------ Internal functions ---------------------- //

    /// @dev TODO
    function _updateProgram(
        uint256 programId,
        address creditLine,
        address liquidityPool
    ) internal {
        LendingMarketStorageV2 storage $ = _getLendingMarketStorage();
        if ($.programCreditLines[programId] == creditLine && $.programLiquidityPools[programId] == liquidityPool) {
            revert AlreadyConfigured();
        }

        emit ProgramUpdated(programId, creditLine, liquidityPool);

        $.programCreditLines[programId] = creditLine;
        $.programLiquidityPools[programId] = liquidityPool;
    }

    /**
     * TODO
     */
    function _delegateToEngine(bytes memory callData) internal returns (bytes memory) {
        address engine = _getLendingMarketStorage().engine;
        if (engine == address(0)) {
            revert EngineUnconfigured();
        }
        (bool ok, bytes memory ret) = engine.delegatecall(callData);
        if (!ok) {
            _bubbleRevert(ret);
        }
        return ret;
    }

    /**
     * TODO
     */
    function _bubbleRevert(bytes memory revertData) private pure {
        assembly {
            revert(add(revertData, 0x20), mload(revertData))
        }
    }

    /**
     * @dev The upgrade validation function for the UUPSExtUpgradeable contract.
     * @param newImplementation The address of the new implementation.
     */
    function _validateUpgrade(address newImplementation) internal view override onlyRole(OWNER_ROLE) {
        try ILendingMarketV2(newImplementation).proveLendingMarket() {} catch {
            revert ImplementationAddressInvalid();
        }
    }
}
