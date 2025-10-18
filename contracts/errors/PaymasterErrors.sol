// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @notice Reverts when a function is called by an address that is not the expected EntryPoint.
 * @param entryPoint The address that attempted the call.
 */
error EntryPointNotWhitelisted(address entryPoint);

/**
 * @notice Reverts if the `paymasterAndData` field has an invalid length.
 * @param length The actual length provided in the UserOperation.
 */
error InvalidPaymasterAndDataLength(uint256 length);

/**
 * @notice Reverts if a required address is the zero address (0x00).
 */
error ZeroAddress();

/**
 * @notice Reverts if a required uint256 value is zero.
 */
error ZeroUint256();

/**
 * @notice Reverts if the post-operation context has an invalid length.
 * @param postOpContextLength The actual length of the postOp context data.
 */
error InvalidPostOpContextLength(uint256 postOpContextLength);

/**
 * @notice Reverts if the input arrays `tokens` and `amounts` do not have the same length.
 * @param tokensLength The length of the `tokens` array.
 * @param amountsLength The length of the `amounts` array.
 */
error ArrayLengthMismatch(uint256 tokensLength, uint256 amountsLength);

/**
 * @notice Reverts if an input array is malformed, empty, or otherwise invalid.
 */
error InvalidArray();
