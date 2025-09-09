// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { ILendingMarketTypesV2 } from "../interfaces/ILendingMarketTypesV2.sol";

/**
 * @title LendingMarketStorageV2 contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the storage layout for the lending market contract.
 */
abstract contract LendingMarketStorageLayoutV2 is ILendingMarketTypesV2 {
    // ------------------ Constants ------------------------------- //

    /// TODO
    uint256 internal constant STORAGE_KIND_MARKET = 0xAA55;

    // ------------------ Storage layout -------------------------- //

    /**
     * @dev The storage location for the lending market.
     *
     * See: ERC-7201 "Namespaced Storage Layout" for more details.
     *
     * The value is the same as:
     *
     * ```solidity
     * string memory id = "cloudwalk.storage.LendingMarketV2";
     * bytes32 location = keccak256(abi.encode(uint256(keccak256(id) - 1)) & ~bytes32(uint256(0xff));
     * ```
     */
    bytes32 private constant LENDING_MARKET_STORAGE_LOCATION =
        0x27e9a497aa8e1867f33bd8bb7ff668e694c5f7d641b7a1234b1516e32cb50000;

    /**
     * @dev Defines the contract storage structure.
     *
     * The fields: TODO
     * - The sub-loan identifier counter.
     * - The program identifier counter.
     * - The mapping of sub-loan ID to its state.
     * - The mapping of program identifier to associated credit line.
     * - The mapping of program identifier to associated liquidity pool.
     *
     * @custom:storage-location erc7201:cloudwalk.storage.LendingMarket
     */
    struct LendingMarketStorageV2 {
        // Slot 1
        address token;
        uint40 subLoanCounter;
        uint24 programCounter;
        // uint32 __reserved; // Reserved until the end of the storage slot

        // Slot 2
        address engine;
        uint40 lastSubLoanId;
        uint16 storageKind;

        // Slots 2...5
        mapping(uint256 subLoanId => SubLoan) subLoans;
        mapping(uint256 programId => address) programCreditLines;
        mapping(uint256 programId => address) programLiquidityPools;
        mapping(uint256 subLoanId => mapping(uint256 operationId => Operation)) subLoanOperations;
    }

    // ------------------ Internal functions ---------------------- //

    /// @dev Returns the storage slot location for the `LendingMarketStorage` struct.
    function _getLendingMarketStorage() internal pure returns (LendingMarketStorageV2 storage $) {
        assembly {
            $.slot := LENDING_MARKET_STORAGE_LOCATION
        }
    }
}
