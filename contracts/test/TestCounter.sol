// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

contract TestCounter {
    event CalledFrom(address sender);

    mapping(address => uint256) public counters;

    function count() public {
        counters[msg.sender] = counters[msg.sender] + 1;
    }

    function countFail() public pure {
        revert("count failed");
    }

    function justEmit() public {
        emit CalledFrom(msg.sender);
    }

    function gasWaster() external pure {
        for (uint256 i = 1; i <= 10000000; i++) {}
    }
}
