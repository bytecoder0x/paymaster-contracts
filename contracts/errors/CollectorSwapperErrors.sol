// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @notice Reverts if the opaque payload has an invalid length.
 * @param length The actual length of the opaque payload.
 */
error InvalidOpaqueLength(uint256 length);

/**
 * @notice Reverts when a function is called by an address that is not the expected paymaster.
 */
error Unauthorized();

/**
 * @notice Reverts if the try swap when contract is paused.
 */
error Paused();

/**
 * @notice Reverts if the try swap when the token being swapped is the same as the canonical token.
 */
error TokenIsCanonical();

/**
 * @notice Reverts if the try swap when the token is not enabled for swapping.
 * @param token The address of the unsupported token.
 */
error UnsupportedToken(address token);

/**
 * @notice Reverts if the token configuration is invalid for swap.
 */
error InvalidTokenConfig();

/**
 * @notice Reverts if the slippage to set is invalid. Must be between 0 and 10000.
 */
error InvalidSlippage();

/**
 * @notice Reverts if the amount out from quote is 0.
 */
error InvalidAmountOut();