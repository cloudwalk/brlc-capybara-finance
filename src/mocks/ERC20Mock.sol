// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title ERC20Mock contract
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @notice Mock of the `ERC20` token contract used for testing
contract ERC20Mock is ERC20 {
    /// @notice Contract constructor
    constructor(uint256 amount) ERC20("NAME", "SYMBOL") {
        _mint(msg.sender, amount * 10 ** decimals());
    }

    /// @notice Mints tokens
    /// @param to The address to mint tokens to
    /// @param amount The amount of tokens to mint
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
