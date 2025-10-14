// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {AccessControlEnumerable} from "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import {SIG_VALIDATION_FAILED, SIG_VALIDATION_SUCCESS} from "@account-abstraction/contracts/core/Helpers.sol";

import {PaymasterPaymentData} from "../interfaces/ITokenPaymaster.sol";
import {ValidationModifiers} from "./ValidationModifiers.sol";

abstract contract EIP712Service is ValidationModifiers, AccessControlEnumerable, EIP712 {
    /**
     * @notice Tracks used nonces per operator-user pair to prevent replay attacks.
     * @dev Mapping: operator => user => nonce
     */
    mapping(address => mapping(address => uint256)) public operatorUserNonces;

    /// @dev keccak256("PaymasterPaymentData(address token,uint256 tokenPriceWei,address user,bytes32 callDataHash,uint256 nonce,uint256 deadline)")
    bytes32 public constant PAYMASTER_PAYMENT_TYPEHASH =
        0x39a28d7a0e7d79abb107bbcaebdf123fbdcf7d3fd6562d234d759c004a60d57d;

    /// @dev keccak256("OPERATOR_ROLE")
    bytes32 public constant OPERATOR_ROLE = 0x97667070c54ef182b0f5858b034beac1b6f3089aa2d3188bb1e8929f4fa9b929;

    /**
     * @notice Initializes the EIP-712 domain and assigns the initial operator role.
     * @param operator The address granted OPERATOR_ROLE to sign paymaster authorizations.
     */
    constructor(address operator) nonZeroAddress(operator) EIP712("TokenPaymaster", "1") {
        _grantRole(OPERATOR_ROLE, operator);
    }

    function _validatePaymentSignature(
        address from,
        PaymasterPaymentData memory param,
        bytes calldata callData
    ) internal nonZeroAddress(param.token) nonZeroUint256(param.tokenPriceWei) returns (uint256 validationData) {
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
            from, // user address (from userOp.sender)
            callDataHash, // callData hash (computed from userOp.callData)
            param.nonce, // nonce for replay protection
            param.deadline
        );

        bytes32 digest = _hashTypedDataV4(keccak256(encodedData));
        (address recovered, , ) = ECDSA.tryRecover(digest, param.v, param.r, param.s);

        // Check the recovered address has operator role
        if (recovered == address(0) || !hasRole(OPERATOR_ROLE, recovered)) {
            return SIG_VALIDATION_FAILED;
        }

        // Validate nonce to prevent replay attacks (using recovered operator address)
        if (param.nonce != _useNonce(recovered, from)) {
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
