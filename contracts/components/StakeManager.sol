// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControlEnumerable} from "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";

import {IEntryPoint} from "../interfaces/IEntryPoint.sol";
import {OnlyEntryPoint} from "../errors/PaymasterErrors.sol";

abstract contract StakeManager is AccessControlEnumerable {
    IEntryPoint public immutable entryPoint;

    modifier onlyEntryPoint() {
        if (msg.sender != address(entryPoint)) revert OnlyEntryPoint();
        _;
    }

    constructor(address entryPoint_) {
        entryPoint = IEntryPoint(entryPoint_);
    }

    function deposit() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
    }

    function withdrawTo(address payable withdrawAddress, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        entryPoint.withdrawTo(withdrawAddress, amount);
    }

    function addStake(uint32 unstakeDelaySec) external payable onlyRole(DEFAULT_ADMIN_ROLE) {
        entryPoint.addStake{value: msg.value}(unstakeDelaySec);
    }

    function getDeposit() external view returns (uint256) {
        return entryPoint.balanceOf(address(this));
    }

    function unlockStake() external onlyRole(DEFAULT_ADMIN_ROLE) {
        entryPoint.unlockStake();
    }

    function withdrawStake(address payable withdrawAddress) external onlyRole(DEFAULT_ADMIN_ROLE) {
        entryPoint.withdrawStake(withdrawAddress);
    }
}
