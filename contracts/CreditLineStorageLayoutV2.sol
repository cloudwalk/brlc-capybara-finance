// SPDX-License-Identifier: MIT

pragma solidity ^0.8.18;

import { ICreditLineTypesV2 } from "./interfaces/ICreditLineV2.sol";

/**
 * @title CreditLineStorageLayoutV2 contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the storage layout for the credit line V2 contract.
 */
abstract contract CreditLineStorageLayoutV2 is ICreditLineTypesV2 {
    // ------------------ Storage layout -------------------------- //

    /**
     * @dev The storage location for the credit line.
     *
     * See: ERC-7201 "Namespaced Storage Layout" for more details.
     *
     * The value is the same as:
     *
     * ```solidity
     * string memory id = "cloudwalk.storage.CreditLineV2";
     * bytes32 location = keccak256(abi.encode(uint256(keccak256(id) - 1)) & ~bytes32(uint256(0xff));
     * ```
     */
    bytes32 private constant CREDIT_LINE_STORAGE_LOCATION =
        0x572a836ea1bae82e3ca6e51518ab584428b44d4354f1d91e3b73adf14e348500;

    /**
     * @dev Defines the contract storage structure.
     *
     * TODO
     * - The mapping of borrower to borrower configuration.
     * - The mapping of a borrower to the borrower state.
     *
     * @custom:storage-location erc7201:cloudwalk.storage.LendingMarket
     */
    struct CreditLineStorageV2 {
        // Slots 1, 2
        mapping(address borrower => BorrowerConfig) borrowerConfigs;
        mapping(address borrower => BorrowerState) borrowerStates;
        // No reserve until the end of the storage slot

        // Slot 3
        address linkedCreditLine;
        // uint96 __reserved; // Reserved until the end of the storage slot
    }

    // ------------------ Internal functions ---------------------- //

    /// @dev Returns the storage slot location for the `LendingMarketStorage` struct.
    function _getCreditLineStorage() internal pure returns (CreditLineStorageV2 storage $) {
        assembly {
            $.slot := CREDIT_LINE_STORAGE_LOCATION
        }
    }
}
