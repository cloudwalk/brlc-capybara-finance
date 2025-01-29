// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { CreditLine } from "../CreditLine.sol";

/// @title CreditLineTestable contract
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Version of the credit line contract with additions required for testing.
contract CreditLineTestable is CreditLine {
    /// @dev Sets the borrower state for testing purposes.
    /// @param borrower The address of the borrower.
    /// @param newState The new borrower state.
    function setBorrowerState(address borrower, BorrowerState calldata newState) external {
        _borrowerStates[borrower] = newState;
    }

    /// @dev Calls the internal initialize function of the parent contract to check
    /// that the 'onlyInitializing' modifier is present.
    /// @param lender_ The address of the lender.
    /// @param market_ The address of the market.
    /// @param token_ The address of the token.
    function call_parent_initialize(
        address lender_, // Tools: this comment prevents Prettier from formatting into a single line.
        address market_,
        address token_
    ) public {
        __CreditLineConfigurable_init(lender_, market_, token_);
    }

    /// @dev Calls the internal initialize_unchained function of the parent contract
    /// to check that the 'onlyInitializing' modifier is present.
    /// @param lender_ The address of the lender.
    /// @param market_ The address of the market.
    /// @param token_ The address of the token.
    function call_parent_initialize_unchained(
        address lender_, // Tools: this comment prevents Prettier from formatting into a single line.
        address market_,
        address token_
    ) public {
        __CreditLineConfigurable_init_unchained(lender_, market_, token_);
    }

    /// @dev Sets the admin role for a given role for testing purposes.
    /// @param role The role to set the admin for.
    /// @param adminRole The admin role to set. 
    function setRoleAdmin(bytes32 role, bytes32 adminRole) external {
        _setRoleAdmin(role, adminRole);
    }
}
