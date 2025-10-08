// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IPaymaster} from "@account-abstraction/contracts/interfaces/IPaymaster.sol";

/**
 * @dev Optimized payment data struct for paymaster operations  
 * EIP-712 uses uint256 for compatibility, but encoding uses smaller types for gas efficiency
 */
struct PaymasterPaymentData {
    address token;              // ERC20 token address for payment
    uint256 tokenPriceWei;      // Token price in wei (uint256 for EIP-712, encoded as uint64)
    uint256 nonce;              // Operator nonce for replay protection (uint256 for EIP-712, encoded as uint32)
    uint256 deadline;           // Signature expiration timestamp (uint256 for EIP-712, encoded as uint32)
    uint8 v;                    // ECDSA signature component
    bytes32 r;                  // ECDSA signature component
    bytes32 s;                  // ECDSA signature component
}

interface ITokenPaymaster is IPaymaster {
    event UserOperationSponsored(
        address indexed sender,
        bytes32 indexed userOpHash,
        address indexed token,
        uint256 tokenAmount,
        uint256 tokenPrice
    );
}
