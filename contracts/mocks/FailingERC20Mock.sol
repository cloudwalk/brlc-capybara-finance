// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract FailingERC20Mock is ERC20 {
    bool public shouldFailTransfers;
    bool public shouldFailTransferFroms;

    constructor() ERC20("FailingToken", "FAIL") {}

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }

    function setShouldFailTransfers(bool _shouldFail) external {
        shouldFailTransfers = _shouldFail;
    }

    function setShouldFailTransferFroms(bool _shouldFail) external {
        shouldFailTransferFroms = _shouldFail;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (shouldFailTransfers) {
            revert("ERC20: transfer failed");
        }
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (shouldFailTransferFroms) {
            revert("ERC20: transfer failed");
        }
        return super.transferFrom(from, to, amount);
    }
}
