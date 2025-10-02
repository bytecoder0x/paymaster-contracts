// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {AccessControlEnumerable} from "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";

import {PaymasterPaymentData} from "../interfaces/ITokenPaymaster.sol";

abstract contract EIP712Service is AccessControlEnumerable, EIP712 {
    /// @dev Mapping to track signature nonces, operator's address => caller's address => signature nonce
    mapping(address => mapping(address => uint256)) public operatorUserNonces;

    /// @dev keccak256("PaymasterPaymentData(address token,uint256 tokenPriceWei,address user,bytes32 userOpHash,uint256 tokenAmount,uint256 nonce,uint256 deadline)")
    bytes32 public constant PAYMASTER_PAYMENT_TYPEHASH =
        0x895ab807e93dfa72b0b2a0ac47b520af6b1d2adcceb91ce175c8bde03fe6d661;

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

    function _validatePaymentSignature(PaymasterPaymentData calldata param) internal {
        bytes memory encodedData = abi.encode(
            PAYMASTER_PAYMENT_TYPEHASH,
            param.token,
            param.tokenPriceWei,
            param.user,
            param.userOpHash,
            param.tokenAmount,
            param.nonce,
            param.deadline
        );
        (bool success, string memory errorReason) = _verifySignature(
            encodedData,
            _msgSender(),
            param.operator,
            param.nonce,
            param.deadline,
            param.v,
            param.r,
            param.s
        );
        require(success, errorReason);
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
    ) private returns (bool result, string memory errorReason) {
        if (operator == address(0)) {
            return (false, "UNAUTHORIZED_OPERATION");
        }

        if (deadline < block.timestamp) {
            return (false, "SIGNATURE_EXPIRED");
        }

        if (nonce != _useNonce(operator, from)) {
            return (false, "MISMATCHING_NONCES");
        }

        bytes32 digest = _hashTypedDataV4(keccak256(encodedData));

        address recoveredAddress = ECDSA.recover(digest, v, r, s);

        if (recoveredAddress == address(0) || recoveredAddress != operator) {
            return (false, "INVALID_SIGNATURE");
        }

        if (!hasRole(OPERATOR_ROLE, recoveredAddress)) {
            return (false, "OPERATOR_FORBIDDEN");
        }

        return (true, "");
    }

    function _useNonce(address operator, address from) private returns (uint256) {
        unchecked {
            return operatorUserNonces[operator][from]++;
        }
    }
}
