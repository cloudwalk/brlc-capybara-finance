// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { LiquidityPool } from "../LiquidityPool.sol";

/// @title LiquidityPoolTestable contract
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Version of the liquidity pool contract with additions required for testing.
contract LiquidityPoolTestable is LiquidityPool {
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
        __LiquidityPool_init(lender_, market_, token_);
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
        __LiquidityPool_init_unchained(lender_, market_, token_);
    }
}
