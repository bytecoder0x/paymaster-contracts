// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/IPaymaster.sol";
import {UserOperationLib} from "@account-abstraction/contracts/core/UserOperationLib.sol";
import {SIG_VALIDATION_FAILED, SIG_VALIDATION_SUCCESS} from "@account-abstraction/contracts/core/Helpers.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {ITokenPaymaster, PaymasterPaymentData} from "./interfaces/ITokenPaymaster.sol";
import {StakeManager} from "./components/StakeManager.sol";
import {EIP712Service} from "./components/EIP712Service.sol";
import {ValidationModifiers} from "./components/ValidationModifiers.sol";
import {InsufficientTokenAmount, InvalidPostOpContextLength, InvalidPaymasterAndDataLength} from "./errors/PaymasterErrors.sol";

contract TokenPaymaster is ITokenPaymaster, ValidationModifiers, StakeManager, EIP712Service, Pausable {
    using SafeERC20 for IERC20;

    uint256 public immutable postOpCost;

    uint256 private constant CONTEXT_LENGTH = 136;
    uint256 private constant PAYMASTER_DATA_LENGTH = 276; // 52 + 224 bytes (paymaster address + gas limits + PaymasterPaymentData)
    uint256 private constant TOKEN_PRICE_DENOMINATOR = 1e18;

    constructor(
        address owner,
        address operator,
        address entryPoint_,
        uint256 postOpCost_
    ) nonZeroAddress(owner) nonZeroUint256(postOpCost_) StakeManager(entryPoint_) EIP712Service(operator) {
        postOpCost = postOpCost_;
        _grantRole(DEFAULT_ADMIN_ROLE, owner);
    }

    /**
     * @notice Emergency pause function - only admin can pause/unpause
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external onlyEntryPoint whenNotPaused returns (bytes memory context, uint256 validationData) {
        address token;
        uint256 tokenPriceWei;

        (token, tokenPriceWei, validationData) = _validateAndDecodePaymasterAndData(userOp);
        if (validationData == SIG_VALIDATION_FAILED) return (bytes(""), SIG_VALIDATION_FAILED);

        uint256 maxFeePerGas = UserOperationLib.unpackMaxFeePerGas(userOp);

        // Gas optimization: Use unchecked arithmetic where overflow is impossible
        uint256 tokenAmount;
        unchecked {
            tokenAmount = ((maxCost + postOpCost * maxFeePerGas) * tokenPriceWei) / TOKEN_PRICE_DENOMINATOR;
        }

        if (tokenAmount == 0) revert InsufficientTokenAmount();

        IERC20(token).safeTransferFrom(userOp.sender, address(this), tokenAmount);

        context = abi.encodePacked(token, tokenAmount, tokenPriceWei, userOp.sender, userOpHash);
        validationData = SIG_VALIDATION_SUCCESS;
    }

    function postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 actualUserOpFeePerGas
    ) external onlyEntryPoint whenNotPaused {
        if (context.length != CONTEXT_LENGTH) revert InvalidPostOpContextLength(context.length);

        (address token, uint256 tokenAmount, uint256 tokenPriceWei, address sender, bytes32 userOpHash) = _parseContext(
            context
        );

        // Gas optimization: Calculate actual token needed with unchecked arithmetic
        uint256 actualTokenNeeded;
        unchecked {
            actualTokenNeeded =
                ((actualGasCost + postOpCost * actualUserOpFeePerGas) * tokenPriceWei) /
                TOKEN_PRICE_DENOMINATOR;
        }

        // Cap actual token needed to pre-authorized amount
        if (actualTokenNeeded > tokenAmount) {
            actualTokenNeeded = tokenAmount;
        }

        // Refund excess tokens to user if operation succeeded and refund is significant (>10%)
        // If operation failed, we keep the pre-charged amount as penalty to prevent griefing attacks
        if (mode == PostOpMode.opSucceeded && tokenAmount > actualTokenNeeded) {
            uint256 refundAmount = tokenAmount - actualTokenNeeded;
            // Only refund if the excess is more than 10% of actual cost to avoid micro-transactions
            if (refundAmount > (actualTokenNeeded * 10) / 100) {
                IERC20(token).safeTransfer(sender, refundAmount);
            }
        }

        emit UserOperationSponsored(sender, userOpHash, token, actualTokenNeeded, tokenPriceWei);
    }

    function withdrawTokens(
        IERC20 token,
        address recipient,
        uint256 amount
    ) external nonZeroAddress(recipient) nonZeroUint256(amount) onlyRole(DEFAULT_ADMIN_ROLE) {
        if (amount == type(uint256).max) amount = token.balanceOf(address(this));
        token.safeTransfer(recipient, amount);
    }

    /**
     * @notice Securely parses context data using assembly for gas efficiency
     * @param context The context bytes to parse
     * @return token The token address
     * @return tokenAmount The token amount
     * @return tokenPriceWei The token price in wei
     * @return sender The sender address
     * @return userOpHash The user operation hash
     */
    function _parseContext(
        bytes calldata context
    )
        private
        pure
        returns (address token, uint256 tokenAmount, uint256 tokenPriceWei, address sender, bytes32 userOpHash)
    {
        assembly {
            // Load data directly from calldata using assembly for gas efficiency
            // shr(96, ...) shifts right by 96 bits to extract address (160 bits) from 256-bit word
            token := shr(96, calldataload(add(context.offset, 0))) // bytes 0-19: address (20 bytes)
            tokenAmount := calldataload(add(context.offset, 20)) // bytes 20-51: uint256 (32 bytes)
            tokenPriceWei := calldataload(add(context.offset, 52)) // bytes 52-83: uint256 (32 bytes)
            sender := shr(96, calldataload(add(context.offset, 84))) // bytes 84-103: address (20 bytes)
            userOpHash := calldataload(add(context.offset, 104)) // bytes 104-135: bytes32 (32 bytes)
        }
    }

    function _validateAndDecodePaymasterAndData(
        PackedUserOperation calldata userOp
    ) private returns (address token, uint256 tokenPriceWei, uint256 validationData) {
        // Validate exact paymaster data length for fixed PaymasterPaymentData structure
        if (userOp.paymasterAndData.length != PAYMASTER_DATA_LENGTH) {
            revert InvalidPaymasterAndDataLength(userOp.paymasterAndData.length);
        }

        // Decode PaymasterPaymentData from fixed offset
        PaymasterPaymentData memory paymentData = abi.decode(
            userOp.paymasterAndData[UserOperationLib.PAYMASTER_DATA_OFFSET:],
            (PaymasterPaymentData)
        );

        validationData = _validatePaymentSignature(userOp.sender, paymentData, userOp.callData);

        token = paymentData.token;
        tokenPriceWei = paymentData.tokenPriceWei;
    }
}
