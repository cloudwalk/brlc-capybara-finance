// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

/// @title AccessControlExtUpgradeable contract
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Extends the `AccessControlUpgradeable` contract by adding the `grantRoleBatch` and `revokeRoleBatch` functions.
abstract contract AccessControlExtUpgradeable is AccessControlUpgradeable {
    /// @dev Internal initializer of the upgradable contract.
    /// See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
    function __AccessControlExt_init() internal onlyInitializing {
        __Context_init_unchained();
        __ERC165_init_unchained();
        __AccessControl_init_unchained();
        __AccessControlExt_init_unchained();
    }

    /// @dev Unchained internal initializer of the upgradable contract.
    /// See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
    function __AccessControlExt_init_unchained() internal onlyInitializing {}

    /// @dev Grants `role` to `account` in batch.
    /// @param role The role to grant.
    /// @param accounts The accounts to grant the role to.
    /// See {AccessControlUpgradeable._grantRole} for more details.
    function grantRoleBatch(bytes32 role, address[] memory accounts) public virtual onlyRole(getRoleAdmin(role)) {
        for (uint i = 0; i < accounts.length; i++) {
            _grantRole(role, accounts[i]);
        }
    }

    /// @dev Revokes `role` from `account` in batch.
    /// @param role The role to revoke.
    /// @param accounts The accounts to revoke the role from.
    /// See {AccessControlUpgradeable._revokeRole} for more details.
    function revokeRoleBatch(bytes32 role, address[] memory accounts) public virtual onlyRole(getRoleAdmin(role)) {
        for (uint i = 0; i < accounts.length; i++) {
            _revokeRole(role, accounts[i]);
        }
    }
}
