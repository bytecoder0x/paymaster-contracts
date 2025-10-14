// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Reverts when a function is called by an address other than the EntryPoint.
error OnlyEntryPoint();

/// @notice Reverts if the length of `paymasterAndData` is invalid.
/// @param length The actual length provided.
error InvalidPaymasterAndDataLength(uint256 length);

/// @notice Reverts if a required address is zero.
error ZeroAddress();

/// @notice Reverts if a required uint256 value is zero.
error ZeroUint256();

/// @notice Reverts if the post-operation context length is incorrect.
/// @param postOpContextLength The actual context length received.
error InvalidPostOpContextLength(uint256 postOpContextLength);

/// @notice Reverts if the input arrays `tokens` and `amounts` have mismatched lengths.
/// @param tokensLength Length of the `tokens` array.
/// @param amountsLength Length of the `amounts` array.
error ArrayLengthMismatch(uint256 tokensLength, uint256 amountsLength);
