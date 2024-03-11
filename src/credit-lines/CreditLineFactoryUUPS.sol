// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { CreditLineFactory } from "./CreditLineFactory.sol";

/// @title CreditLineFactoryUUPS contract
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @notice Upgradeable version of the credit line factory contract.
contract CreditLineFactoryUUPS is CreditLineFactory, UUPSUpgradeable {
    /// @dev Constructor that prohibits the initialization of the implementation of the upgradable contract.
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @inheritdoc UUPSUpgradeable
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner { }
}