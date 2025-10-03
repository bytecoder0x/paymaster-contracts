// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

enum PostOpMode {
    // User op succeeded.
    opSucceeded,
    // User op reverted. Still has to pay for gas.
    opReverted,
    // Only used internally in the EntryPoint (cleanup after postOp reverts). Never calling paymaster with this value
    postOpReverted
}

struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    bytes signature;
}

interface IPaymaster {
    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external returns (bytes memory context, uint256 validationData);

    function postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 actualUserOpFeePerGas
    ) external;
}
