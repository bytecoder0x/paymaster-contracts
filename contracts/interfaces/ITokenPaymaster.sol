// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IPaymaster} from "@account-abstraction/contracts/interfaces/IPaymaster.sol";

/**
 * @notice Off-chain payment authorization used by the paymaster.
 * @param token ERC-20 token used to pay for gas.
 * @param tokenPriceWei The token exchange rate - how many tokens one full ETH (1e18 wei) is worth.
 * @param nonce Operator nonce for replay protection.
 * @param deadline Expiration timestamp for the signature.
 * @param v ECDSA signature component.
 * @param r ECDSA signature component.
 * @param s ECDSA signature component.
 */
struct PaymasterPaymentData {
    address token;
    uint256 tokenPriceWei;
    uint256 nonce;
    uint256 deadline;
    uint8 v;
    bytes32 r;
    bytes32 s;
}

interface ITokenPaymaster is IPaymaster {
    /**
     * @notice Emitted after a successful token-based gas payment.
     * @param sender User who submitted the operation.
     * @param userOpHash Hash of the user operation.
     * @param token Token used for gas payment.
     * @param tokenAmount Actual amount of tokens charged.
     * @param tokenPrice Token price used in calculation.
     */
    event UserOperationSponsored(
        address indexed sender,
        bytes32 indexed userOpHash,
        address indexed token,
        uint256 tokenAmount,
        uint256 tokenPrice
    );

    /**
     * @notice Emitted when tokens are withdrawn by the admin.
     * @param recipient Address receiving the withdrawn tokens.
     * @param tokens List of token addresses.
     * @param amounts Corresponding token amounts withdrawn.
     */
    event TokensWithdrawn(address indexed recipient, address[] tokens, uint256[] amounts);
}
