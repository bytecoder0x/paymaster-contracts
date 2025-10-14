// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControlEnumerable} from "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {IStakeManager} from "@account-abstraction/contracts/interfaces/IStakeManager.sol";

import {ValidationModifiers} from "./ValidationModifiers.sol";
import {OnlyEntryPoint} from "../errors/PaymasterErrors.sol";

abstract contract StakeManager is ValidationModifiers, AccessControlEnumerable {
    /// @notice The EntryPoint contract this paymaster interacts with.
    IEntryPoint public immutable entryPoint;

    /**
     * @notice Ensures that only the EntryPoint contract can call the function.
     */
    modifier onlyEntryPoint() {
        if (msg.sender != address(entryPoint)) revert OnlyEntryPoint();
        _;
    }

    /**
     * @notice Initializes the StakeManager with the given EntryPoint address.
     * @param entryPoint_ The address of the ERC-4337 EntryPoint contract.
     */
    constructor(address entryPoint_) nonZeroAddress(entryPoint_) {
        entryPoint = IEntryPoint(entryPoint_);
    }

    /**
     * @notice Deposits ETH to the EntryPoint for this contract to sponsor operations.
     */
    function deposit() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
    }

    /**
     * @notice Withdraws deposited ETH from EntryPoint to a specified address.
     * @param withdrawAddress The address receiving the withdrawn ETH.
     * @param amount The amount of ETH to withdraw.
     */
    function withdrawTo(
        address payable withdrawAddress,
        uint256 amount
    ) external nonZeroAddress(withdrawAddress) onlyRole(DEFAULT_ADMIN_ROLE) {
        entryPoint.withdrawTo(withdrawAddress, amount);
    }

    /**
     * @notice Adds stake to the EntryPoint contract with a specified unstake delay.
     * @param unstakeDelaySec The delay in seconds before stake can be unlocked.
     */
    function addStake(uint32 unstakeDelaySec) external payable onlyRole(DEFAULT_ADMIN_ROLE) {
        entryPoint.addStake{value: msg.value}(unstakeDelaySec);
    }

    /**
     * @notice Unlocks the staked ETH after the unstake delay.
     */
    function unlockStake() external onlyRole(DEFAULT_ADMIN_ROLE) {
        entryPoint.unlockStake();
    }

    /**
     * @notice Withdraws the previously unlocked stake to a given address.
     * @param withdrawAddress The address receiving the withdrawn stake.
     */
    function withdrawStake(
        address payable withdrawAddress
    ) external nonZeroAddress(withdrawAddress) onlyRole(DEFAULT_ADMIN_ROLE) {
        entryPoint.withdrawStake(withdrawAddress);
    }

    /**
     * @notice Returns the current ETH deposit balance for this contract in the EntryPoint.
     * @return The amount of ETH deposited.
     */
    function getDeposit() external view returns (uint256) {
        return entryPoint.balanceOf(address(this));
    }

    /**
     * @notice Returns detailed stake information for this contract.
     * @return depositAmount Amount of ETH deposited.
     * @return staked Whether the contract is currently staked.
     * @return stake Amount of staked ETH.
     * @return unstakeDelaySec Delay before stake can be unlocked.
     * @return withdrawTime Timestamp when stake becomes withdrawable.
     */
    function getStakeInfo()
        external
        view
        returns (uint256 depositAmount, bool staked, uint112 stake, uint32 unstakeDelaySec, uint48 withdrawTime)
    {
        IStakeManager.DepositInfo memory info = entryPoint.getDepositInfo(address(this));
        return (info.deposit, info.staked, info.stake, info.unstakeDelaySec, info.withdrawTime);
    }
}
