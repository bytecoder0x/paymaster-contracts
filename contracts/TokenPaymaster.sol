// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ITokenPaymaster} from "./interfaces/ITokenPaymaster.sol";
import {BasePaymaster} from "./components/BasePaymaster.sol";
import {OnlyEntryPoint} from "./errors/PaymasterErrors.sol";

contract TokenPaymaster is ITokenPaymaster, BasePaymaster {
    modifier onlyEntryPoint() {
        if (msg.sender != address(entryPoint)) revert OnlyEntryPoint();
        _;
    }

    constructor(address owner, address entryPoint_) BasePaymaster(owner, entryPoint_) {}

    /// @inheritdoc ITokenPaymaster
    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external onlyEntryPoint returns (bytes memory context, uint256 validationData) {
        return _validatePaymasterUserOp(userOp, userOpHash, maxCost);
    }

    /// @inheritdoc ITokenPaymaster
    function postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 actualUserOpFeePerGas
    ) external onlyEntryPoint {
        // _postOp(mode, context, actualGasCost, actualUserOpFeePerGas);
    }

    function _validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) internal returns (bytes memory context, uint256 validationResult) {}
}
