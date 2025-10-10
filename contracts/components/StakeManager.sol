// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControlEnumerable} from "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {IStakeManager} from "@account-abstraction/contracts/interfaces/IStakeManager.sol";

import {ValidationModifiers} from "./ValidationModifiers.sol";
import {OnlyEntryPoint} from "../errors/PaymasterErrors.sol";

abstract contract StakeManager is ValidationModifiers, AccessControlEnumerable {
    IEntryPoint public immutable entryPoint;

    modifier onlyEntryPoint() {
        if (msg.sender != address(entryPoint)) revert OnlyEntryPoint();
        _;
    }

    constructor(address entryPoint_) nonZeroAddress(entryPoint_) {
        entryPoint = IEntryPoint(entryPoint_);
    }

    function deposit() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
    }

    function withdrawTo(
        address payable withdrawAddress,
        uint256 amount
    ) external nonZeroAddress(withdrawAddress) onlyRole(DEFAULT_ADMIN_ROLE) {
        entryPoint.withdrawTo(withdrawAddress, amount);
    }

    function addStake(uint32 unstakeDelaySec) external payable onlyRole(DEFAULT_ADMIN_ROLE) {
        entryPoint.addStake{value: msg.value}(unstakeDelaySec);
    }

    function unlockStake() external onlyRole(DEFAULT_ADMIN_ROLE) {
        entryPoint.unlockStake();
    }

    function withdrawStake(
        address payable withdrawAddress
    ) external nonZeroAddress(withdrawAddress) onlyRole(DEFAULT_ADMIN_ROLE) {
        entryPoint.withdrawStake(withdrawAddress);
    }

    function getDeposit() external view returns (uint256) {
        return entryPoint.balanceOf(address(this));
    }

    function getStakeInfo()
        external
        view
        returns (uint256 depositAmount, bool staked, uint112 stake, uint32 unstakeDelaySec, uint48 withdrawTime)
    {
        IStakeManager.DepositInfo memory info = entryPoint.getDepositInfo(address(this));
        return (info.deposit, info.staked, info.stake, info.unstakeDelaySec, info.withdrawTime);
    }
}
