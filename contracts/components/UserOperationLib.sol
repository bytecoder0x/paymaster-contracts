// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PackedUserOperation} from "../interfaces/IPaymaster.sol";

library UserOperationLib {
    uint256 public constant PAYMASTER_VALIDATION_GAS_OFFSET = 20;
    uint256 public constant PAYMASTER_POSTOP_GAS_OFFSET = 36;
    uint256 public constant PAYMASTER_DATA_OFFSET = 52;

    function unpackUints(bytes32 packed) internal pure returns (uint256 high128, uint256 low128) {
        return (unpackHigh128(packed), unpackLow128(packed));
    }

    // Unpack just the high 128-bits from a packed value
    function unpackHigh128(bytes32 packed) internal pure returns (uint256) {
        return uint256(packed) >> 128;
    }

    // Unpack just the low 128-bits from a packed value
    function unpackLow128(bytes32 packed) internal pure returns (uint256) {
        return uint128(uint256(packed));
    }

    function unpackMaxPriorityFeePerGas(PackedUserOperation calldata userOp) internal pure returns (uint256) {
        return unpackHigh128(userOp.gasFees);
    }

    function unpackMaxFeePerGas(PackedUserOperation calldata userOp) internal pure returns (uint256) {
        return unpackLow128(userOp.gasFees);
    }

    function unpackVerificationGasLimit(PackedUserOperation calldata userOp) internal pure returns (uint256) {
        return unpackHigh128(userOp.accountGasLimits);
    }

    function unpackCallGasLimit(PackedUserOperation calldata userOp) internal pure returns (uint256) {
        return unpackLow128(userOp.accountGasLimits);
    }

    function unpackPaymasterVerificationGasLimit(PackedUserOperation calldata userOp) internal pure returns (uint256) {
        return uint128(bytes16(userOp.paymasterAndData[PAYMASTER_VALIDATION_GAS_OFFSET:PAYMASTER_POSTOP_GAS_OFFSET]));
    }

    function unpackPostOpGasLimit(PackedUserOperation calldata userOp) internal pure returns (uint256) {
        return uint128(bytes16(userOp.paymasterAndData[PAYMASTER_POSTOP_GAS_OFFSET:PAYMASTER_DATA_OFFSET]));
    }
}
