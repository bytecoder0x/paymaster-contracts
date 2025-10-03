// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {AccessControlEnumerable} from "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";

import {PaymasterPaymentData} from "../interfaces/ITokenPaymaster.sol";
import {SIG_VALIDATION_FAILED, SIG_VALIDATION_SUCCESS} from "./Constants.sol";

abstract contract EIP712Service is AccessControlEnumerable, EIP712 {
    /// @dev Mapping to track signature nonces, operator's address => caller's address => signature nonce
    mapping(address => mapping(address => uint256)) public operatorUserNonces;

    /// @dev keccak256("PaymasterPaymentData(address token,uint256 tokenPriceWei,address user,bytes32 userOpHash,uint256 nonce,uint256 deadline)")
    bytes32 public constant PAYMASTER_PAYMENT_TYPEHASH =
        0x7034e7fd039c6b0784686d708a174c22e8b7d0995f8a4ecbc7da215751c4e0db;

    /// @dev keccak256("OPERATOR_ROLE")
    bytes32 public constant OPERATOR_ROLE = 0x97667070c54ef182b0f5858b034beac1b6f3089aa2d3188bb1e8929f4fa9b929;

    constructor(address operator) EIP712("TokenPaymaster", "1") {
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
        PaymasterPaymentData memory param
    ) internal returns (uint256 validationData) {
        bytes memory encodedData = abi.encode(
            PAYMASTER_PAYMENT_TYPEHASH,
            param.token,
            param.tokenPriceWei,
            param.user,
            param.userOpHash,
            param.nonce,
            param.deadline
        );
        validationData = _verifySignature(
            encodedData,
            from,
            param.operator,
            param.nonce,
            param.deadline,
            param.v,
            param.r,
            param.s
        );
    }

    function _verifySignature(
        bytes memory encodedData,
        address from,
        address operator,
        uint256 nonce,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) private returns (uint256 validationData) {
        // Check if operator is valid and signature is within the allowed timeframe
        if (operator == address(0) || deadline < block.timestamp) {
            return SIG_VALIDATION_FAILED;
        }
        // Verify nonce
        if (nonce != _useNonce(operator, from)) {
            return SIG_VALIDATION_FAILED;
        }

        bytes32 digest = _hashTypedDataV4(keccak256(encodedData));
        address recovered = ECDSA.recover(digest, v, r, s);

        // Check the recovered address is valid and authorized
        if (recovered == address(0) || recovered != operator || !hasRole(OPERATOR_ROLE, recovered)) {
            return SIG_VALIDATION_FAILED;
        }

        return SIG_VALIDATION_SUCCESS;
    }

    function _useNonce(address operator, address from) private returns (uint256) {
        unchecked {
            return operatorUserNonces[operator][from]++;
        }
    }
}
