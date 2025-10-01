// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ITokenPaymaster} from "./interfaces/ITokenPaymaster.sol";

contract TokenPaymaster is ITokenPaymaster {
    /// @inheritdoc ITokenPaymaster
    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external override returns (bytes memory context, uint256 validationData) {
        // _requireFromEntryPoint();
        // return _validatePaymasterUserOp(userOp, userOpHash, maxCost);
    }

    /// @inheritdoc ITokenPaymaster
    function postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 actualUserOpFeePerGas
    ) external override {
        // _requireFromEntryPoint();
        // _postOp(mode, context, actualGasCost, actualUserOpFeePerGas);
    }
}
