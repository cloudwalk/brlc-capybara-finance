// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ILiquidityPool } from "../interfaces/ILiquidityPool.sol";

contract ReentrantERC20Mock is ERC20 {
    ILiquidityPool public liquidityPool;
    uint256 public attackCount;
    uint256 public maxAttacks;

    constructor(address _liquidityPool) ERC20("ReentrantToken", "REENT") {
        liquidityPool = ILiquidityPool(_liquidityPool);
        maxAttacks = 3;
    }

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }

    function _update(address from, address to, uint256 amount) internal virtual override {
        if (to == address(liquidityPool) && attackCount < maxAttacks) {
            attackCount++;
            try liquidityPool.deposit(1000) {
                revert("Reentrancy attack succeeded");
            } catch Error(string memory reason) {
                require(
                    keccak256(bytes(reason)) == keccak256(bytes("ReentrancyGuard: reentrant call")),
                    "Expected reentrancy guard error"
                );
            }
        }
        super._update(from, to, amount);
    }
}
