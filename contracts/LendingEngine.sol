// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { UUPSExtUpgradeable } from "./base/UUPSExtUpgradeable.sol";
import { Versionable } from "./base/Versionable.sol";

import { ILendingEngine } from "./interfaces/ILendingEngine.sol";

import { LendingMarketCore } from "./core/LendingMarketCore.sol";

/**
 * @title LendingEngine contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The lending engine contract. TODO: add description
 *
 * See additional notes in the comments of the interface `ILendingMarket.sol`.
 */
contract LendingEngine is
    OwnableUpgradeable,
    LendingMarketCore,
    Versionable,
    UUPSExtUpgradeable,
    ILendingEngine
{
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
        __Ownable_init(_msgSender());
        __UUPSExt_init_unchained();
    }

    // ------------------ Transactional functions ------------------ //


    /// @inheritdoc ILendingEngine
    // TODO: Remove `For` in the name, consider the same for other fucntions
    function takeLoan(
        address borrower,
        uint256 programId,
        uint256 interestRateRemuneratory,
        uint256 interestRateMoratory,
        uint256 lateFeeRate,
        SubLoanTakingRequest[] calldata subLoanTakingRequests
    ) external returns (uint256 firstSubLoanId) {
        uint256 subLoanCount = subLoanTakingRequests.length;

        _checkSubLoanCount(subLoanCount);
        _checkSubLoanParameters(subLoanTakingRequests);
        _checkSubLoanRates(interestRateRemuneratory, interestRateMoratory, lateFeeRate);
        uint256 packedRates = _packRates(interestRateRemuneratory, interestRateMoratory, lateFeeRate);
        (uint256 totalBorrowedAmount, uint256 totalAddonAmount) = _calculateTotalAmounts(subLoanTakingRequests);
        _checkMainLoanParameters(borrower, programId, totalBorrowedAmount, totalAddonAmount);

        for (uint256 i = 0; i < subLoanCount; ++i) {
            uint256 subLoanId = _takeSubLoan(
                borrower, // Tools: prevent Prettier one-liner
                programId,
                packedRates,
                subLoanTakingRequests[i]
            );
            if (i == 0) {
                firstSubLoanId = subLoanId;
            }
            _setLoanPartsData(subLoanId, firstSubLoanId, subLoanCount);
        }

        {
            (address creditLine, address liquidityPool) = _getCreditLineAndLiquidityPool(programId);
            emit LoanTaken(
                firstSubLoanId, // Tools: prevent Prettier one-liner
                borrower,
                programId,
                subLoanCount,
                totalBorrowedAmount,
                totalAddonAmount,
                creditLine,
                liquidityPool
            );
        }

        _transferTokensOnLoanTaking(firstSubLoanId, totalBorrowedAmount, totalAddonAmount);
    }

    /// @inheritdoc ILendingEngine
    function revokeLoan(uint256 subLoanId) external {
        SubLoan storage subLoanStored = _getExitingSubLoanInStorage(subLoanId);

        uint256 firstSubLoanId = subLoanStored.firstSubLoanId;
        uint256 subLoanCount = subLoanStored.subLoanCount;
        uint256 ongoingSubLoanCount = 0;
        OperationAdditionRequest[] memory addingOperationRequests = new OperationAdditionRequest[](subLoanCount);

        for (uint256 i = 0; i < subLoanCount; ++i) {
            subLoanStored = _getNonRevokedSubLoanInStorage(firstSubLoanId + i);
            if (subLoanStored.status != SubLoanStatus.FullyRepaid) {
                ++ongoingSubLoanCount;
            }
            addingOperationRequests[i] = OperationAdditionRequest({
                subLoanId: firstSubLoanId + i,
                kind: uint256(OperationKind.Revocation),
                timestamp: 0,
                inputValue: 0,
                account: address(0)
            });
        }

        // If all the sub-loans are repaid the revocation is prohibited
        if (ongoingSubLoanCount == 0) {
            revert LoanStatusFullyRepaid();
        }

        _modifyOperationBatch(new OperationVoidingRequest[](0), addingOperationRequests);

        emit LoanRevoked(
            firstSubLoanId, // Tools: prevent Prettier one-liner
            subLoanCount
        );

        _transferTokensOnLoanRevocation(firstSubLoanId, subLoanCount);
    }

    function repaySubLoanBatch(RepaymentRequest[] calldata repaymentRequests) external {
        _executeRepaymentBatch(repaymentRequests);
    }

    // TODO: Ask if discount can be greater than the principal amount

    function discountSubLoanBatch(SubLoanOperationRequest[] calldata operationRequests) external {
        _executeOperationBatch(uint256(OperationKind.Discounting), operationRequests);
    }

    function setSubLoanDurationBatch(SubLoanOperationRequest[] calldata operationRequests) external {
        _executeOperationBatch(uint256(OperationKind.SetDuration), operationRequests);
    }

    function setSubLoanInterestRateRemuneratoryBatch(SubLoanOperationRequest[] calldata operationRequests) external {
        _executeOperationBatch(uint256(OperationKind.SetInterestRateRemuneratory), operationRequests);
    }

    function setSubLoanInterestRateMoratoryBatch(SubLoanOperationRequest[] calldata operationRequests) external {
        _executeOperationBatch(uint256(OperationKind.SetInterestRateMoratory), operationRequests);
    }

    function setSubLoanLateFeeRateBatch(SubLoanOperationRequest[] calldata operationRequests) external {
        _executeOperationBatch(uint256(OperationKind.SetLateFeeRate), operationRequests);
    }

    function freezeSubLoanBatch(SubLoanOperationRequest[] calldata operationRequests) external {
        _executeOperationBatch(uint256(OperationKind.Freezing), operationRequests);
    }

    function unfreezeSubLoanBatch(SubLoanOperationRequest[] calldata operationRequests) external {
        _executeOperationBatch(uint256(OperationKind.Unfreezing), operationRequests);
    }

    function voidOperationBatch(OperationVoidingRequest[] calldata voidOperationRequests) external {
        _modifyOperationBatch(voidOperationRequests, new OperationAdditionRequest[](0));
    }

    // ------------------ Pure functions -------------------------- //

    /// @inheritdoc ILendingEngine
    function proveLendingEngine() external pure {}

    // ------------------ Internal functions -------------------- //

    /**
     * @dev The upgrade validation function for the UUPSExtUpgradeable contract.
     * @param newImplementation The address of the new implementation.
     */
    function _validateUpgrade(address newImplementation) internal view override onlyOwner() {
        try ILendingEngine(newImplementation).proveLendingEngine() {} catch {
            revert ImplementationAddressInvalid();
        }
    }
}
