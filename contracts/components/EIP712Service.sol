// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {AccessControlEnumerable} from "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import {SIG_VALIDATION_FAILED, SIG_VALIDATION_SUCCESS} from "@account-abstraction/contracts/core/Helpers.sol";

import {PaymasterPaymentData} from "../interfaces/ITokenPaymaster.sol";
import {ZeroAddress, ZeroUint256, InvalidSender} from "../errors/PaymasterErrors.sol";

abstract contract EIP712Service is AccessControlEnumerable, EIP712 {
    /// @dev Mapping: operator => user => nonce (for replay protection)
    mapping(address => mapping(address => uint256)) public operatorUserNonces;

    /// @dev keccak256("PaymasterPaymentData(address token,uint256 tokenPriceWei,address user,bytes32 callDataHash,uint256 nonce,uint256 deadline)")
    bytes32 public constant PAYMASTER_PAYMENT_TYPEHASH =
        0x39a28d7a0e7d79abb107bbcaebdf123fbdcf7d3fd6562d234d759c004a60d57d;

    /// @dev keccak256("OPERATOR_ROLE")
    bytes32 public constant OPERATOR_ROLE = 0x97667070c54ef182b0f5858b034beac1b6f3089aa2d3188bb1e8929f4fa9b929;

    constructor(address operator) EIP712("TokenPaymaster", "1") {
        if (operator == address(0)) revert ZeroAddress();
        _grantRole(OPERATOR_ROLE, operator);
    }

    /**
     * @notice Computes the EIP-712 compliant hash for the given struct data.
     * @dev This function uses the `_hashTypedDataV4` function from the parent contract to generate the hash.
     * It is used for EIP-712 signature validation.
     * @param structHash The hash of the struct data to be typed.
     * @return The EIP-712 compliant hash of the given struct data.
     */
    function hashTypedDataV4(bytes32 structHash) external view returns (bytes32) {
        return super._hashTypedDataV4(structHash);
    }

    function _validatePaymentSignature(
        address from,
        PaymasterPaymentData memory param,
        bytes calldata callData
    ) internal returns (uint256 validationData) {
        // Basic validation
        if (param.token == address(0)) revert ZeroAddress();
        if (param.tokenPriceWei == 0) revert ZeroUint256();

        // Check signature deadline
        if (param.deadline < block.timestamp) {
            return SIG_VALIDATION_FAILED;
        }

        // Create callDataHash for validation
        bytes32 callDataHash = keccak256(callData);

        // Encode data that was signed by operator
        bytes memory encodedData = abi.encode(
            PAYMASTER_PAYMENT_TYPEHASH,
            param.token,
            param.tokenPriceWei,
            from,              // user address (from userOp.sender)
            callDataHash,      // callData hash (computed from userOp.callData)
            param.nonce,       // nonce for replay protection
            param.deadline
        );

        bytes32 digest = _hashTypedDataV4(keccak256(encodedData));
        (address recovered, ECDSA.RecoverError error,) = ECDSA.tryRecover(digest, param.v, param.r, param.s);
        
        if (error != ECDSA.RecoverError.NoError) {
            return SIG_VALIDATION_FAILED;
        }

        // Check the recovered address has operator role
        if (recovered == address(0) || !hasRole(OPERATOR_ROLE, recovered)) {
            return SIG_VALIDATION_FAILED;
        }

        // Validate nonce to prevent replay attacks (using recovered operator address)
        uint256 currentNonce = operatorUserNonces[recovered][from];
        if (param.nonce != currentNonce) {
            return SIG_VALIDATION_FAILED;
        }

        // Update nonce after successful validation - more gas efficient than separate read/increment
        operatorUserNonces[recovered][from] = currentNonce + 1;

        return SIG_VALIDATION_SUCCESS;
    }


}
