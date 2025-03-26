// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {IERC20Mintable} from "../interfaces/IERC20Mintable.sol";

/// @title ERC20Mock contract
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Mock of the `ERC20` token contract used for testing.
contract ERC20Mock is ERC20, IERC20Mintable {
    // -------------------------------------------- //
    //  Events                                      //
    // -------------------------------------------- //

    /// @dev Emitted when the minting of tokens from the reserve is imitated.
    ///
    /// @param sender The address of the sender.
    /// @param account The address of the account to mint tokens to.
    /// @param amount The amount of tokens to mint.
    event MockMintingFromReserve(
        address sender, // Tools: this comment prevents Prettier from formatting into a single line.
        address account,
        uint256 amount
    );

    /// @dev Emitted when the burning of tokens to the reserve is imitated.
    ///
    /// @param sender The address of the sender.
    /// @param amount The amount of tokens to burn.
    event MockBurningToReserve(
        address sender, // Tools: this comment prevents Prettier from formatting into a single line.
        uint256 amount
    );

    // -------------------------------------------- //
    //  Constructor                                 //
    // -------------------------------------------- //

    /// @dev Contract constructor.
    constructor() ERC20("NAME", "SYMBOL") {}

    // -------------------------------------------- //
    //  Transactional functions                     //
    // -------------------------------------------- //

    /// @dev Mints tokens.
    /// @param account The address to mint tokens to.
    /// @param amount The amount of tokens to mint.
    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }

    /// @dev Imitates minting tokens from reserve.
    ///
    /// Executes the regular minting process and emits the event about mock minting from reserve.
    ///
    /// @param account The address to mint tokens to.
    /// @param amount The amount of tokens to mint.
    function mintFromReserve(address account, uint256 amount) external {
        _mint(account, amount);
        emit MockMintingFromReserve(msg.sender, account, amount);
    }

    /// @dev Imitates burning tokens to reserve.
    ///
    /// Executes the regular burning process and emits the event about mock burning to reserve.
    ///
    /// @param amount The amount of tokens to burn.
    function burnToReserve(uint256 amount) external {
        _burn(msg.sender, amount);
        emit MockBurningToReserve(msg.sender, amount);
    }
}
