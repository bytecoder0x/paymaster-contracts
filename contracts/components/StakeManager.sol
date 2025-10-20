// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControlEnumerable} from "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import {ERC165Checker} from "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {IStakeManager} from "@account-abstraction/contracts/interfaces/IStakeManager.sol";
import {INonceManager} from "@account-abstraction/contracts/interfaces/INonceManager.sol";

import {ValidationModifiers} from "./ValidationModifiers.sol";
import {EntryPointNotWhitelisted, InvalidArray} from "../errors/PaymasterErrors.sol";

abstract contract StakeManager is ValidationModifiers, AccessControlEnumerable {
    using ERC165Checker for address;

    /**
     * @notice Emitted when the EntryPoint whitelist status is updated.
     * @param entryPoint The EntryPoint address.
     * @param status True if added to whitelist, false if removed.
     */
    event SetEntryPointWhitelistStatus(address entryPoint, bool status);

    /// @notice Maps whitelisted EntryPoint addresses.
    mapping(address => bool) public entryPointWhitelist;

    /**
     * @notice Ensures that only a whitelisted EntryPoint can invoke the function.
     */
    modifier onlySupportedEntryPoint(address entryPoint) {
        if (!entryPointWhitelist[entryPoint]) revert EntryPointNotWhitelisted(entryPoint);
        _;
    }

    /**
     * @notice Initializes the StakeManager with an array of allowed EntryPoint addresses.
     * @param entryPoints Array of EntryPoint contract addresses to whitelist.
     */
    constructor(address[] memory entryPoints) {
        uint256 length = entryPoints.length;
        if (length == 0) revert InvalidArray();

        for (uint256 i = 0; i < length; ++i) {
            _setEntryPointWhitelist(entryPoints[i], true);
        }
    }

    /**
     * @notice Deposits ETH into the specified EntryPoint for this contract.
     * @param entryPoint The EntryPoint contract to deposit into.
     */
    function deposit(address entryPoint) external payable onlySupportedEntryPoint(entryPoint) {
        IEntryPoint(entryPoint).depositTo{value: msg.value}(address(this));
    }

    /**
     * @notice Withdraws ETH from the specified EntryPoint to a recipient address.
     * @param entryPoint The EntryPoint contract to withdraw from.
     * @param withdrawAddress The address receiving the withdrawn ETH.
     * @param amount The amount of ETH to withdraw.
     */
    function withdrawTo(
        address entryPoint,
        address payable withdrawAddress,
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nonZeroAddress(withdrawAddress) {
        IEntryPoint(entryPoint).withdrawTo(withdrawAddress, amount);
    }

    /**
     * @notice Stakes ETH in the specified EntryPoint with a given unstake delay.
     * @param entryPoint The EntryPoint contract to stake into.
     * @param unstakeDelaySec The time in seconds before the stake can be unlocked.
     */
    function addStake(
        address entryPoint,
        uint32 unstakeDelaySec
    ) external payable onlyRole(DEFAULT_ADMIN_ROLE) onlySupportedEntryPoint(entryPoint) {
        IEntryPoint(entryPoint).addStake{value: msg.value}(unstakeDelaySec);
    }

    /**
     * @notice Initiates the unstaking process for previously staked ETH.
     * @param entryPoint The EntryPoint contract from which to unlock the stake.
     */
    function unlockStake(address entryPoint) external onlyRole(DEFAULT_ADMIN_ROLE) {
        IEntryPoint(entryPoint).unlockStake();
    }

    /**
     * @notice Withdraws previously unlocked staked ETH to a recipient.
     * @param entryPoint The EntryPoint contract to withdraw from.
     * @param withdrawAddress The address receiving the withdrawn stake.
     */
    function withdrawStake(
        address entryPoint,
        address payable withdrawAddress
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nonZeroAddress(withdrawAddress) {
        IEntryPoint(entryPoint).withdrawStake(withdrawAddress);
    }

    /**
     * @notice Retrieves the current ETH deposit held for this contract in a given EntryPoint.
     * @param entryPoint The EntryPoint contract to query.
     * @return The amount of ETH currently deposited.
     */
    function getDeposit(address entryPoint) external view returns (uint256) {
        return IEntryPoint(entryPoint).balanceOf(address(this));
    }

    /**
     * @notice Retrieves stake details associated with this contract in a given EntryPoint.
     * @param entryPoint The EntryPoint contract to query.
     * @return depositAmount The amount currently deposited.
     * @return staked Whether this contract is currently staked.
     * @return stake Amount of ETH currently staked.
     * @return unstakeDelaySec Unstake delay in seconds.
     * @return withdrawTime Timestamp when stake becomes withdrawable.
     */
    function getStakeInfo(
        address entryPoint
    )
        external
        view
        returns (uint256 depositAmount, bool staked, uint112 stake, uint32 unstakeDelaySec, uint48 withdrawTime)
    {
        IStakeManager.DepositInfo memory info = IEntryPoint(entryPoint).getDepositInfo(address(this));
        return (info.deposit, info.staked, info.stake, info.unstakeDelaySec, info.withdrawTime);
    }

    /**
     * @notice Adds or removes an EntryPoint address from the whitelist.
     * @param entryPoint The EntryPoint address to update.
     * @param status True to whitelist, false to revoke.
     */
    function setEntryPointWhitelist(address entryPoint, bool status) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setEntryPointWhitelist(entryPoint, status);
    }

    function _setEntryPointWhitelist(address entryPoint, bool status) private nonZeroAddress(entryPoint) {
        entryPointWhitelist[entryPoint] = status;
        emit SetEntryPointWhitelistStatus(entryPoint, status);
    }
}
