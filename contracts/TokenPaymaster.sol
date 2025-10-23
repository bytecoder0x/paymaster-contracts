// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/IPaymaster.sol";
import {UserOperationLib} from "@account-abstraction/contracts/core/UserOperationLib.sol";
import {SIG_VALIDATION_FAILED, SIG_VALIDATION_SUCCESS} from "@account-abstraction/contracts/core/Helpers.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IPaymaster} from "@account-abstraction/contracts/interfaces/IPaymaster.sol";

import {ITokenPaymaster, PaymasterPaymentData} from "./interfaces/ITokenPaymaster.sol";
import {ICollectorSwapper} from "./interfaces/ICollectorSwapper.sol";
import {ApproveManager} from "./components/ApproveManager.sol";
import {StakeManager} from "./components/StakeManager.sol";
import {EIP712Service} from "./components/EIP712Service.sol";
import {ValidationModifiers} from "./components/ValidationModifiers.sol";
import {InvalidPostOpContextLength, InvalidPaymasterAndDataLength, ArrayLengthMismatch, ZeroAddress} from "./errors/PaymasterErrors.sol";


contract TokenPaymaster is ITokenPaymaster, ValidationModifiers, StakeManager, EIP712Service, ApproveManager, Pausable {
    using SafeERC20 for IERC20;

    /// @dev context length has at least 136 without opaque part
    uint256 private constant MIN_CONTEXT_LENGTH = 136;
    /// @dev paymaster data length has at least 372 bytes without opaque part
    /// where 20 + 32 (paymaster address) + 32 (gas limits) + 320 (64 - opaque part if zero bytes) (PaymasterPaymentData)
    uint256 private constant MIN_PAYMASTER_DATA_LENGTH = 372; 

    uint256 private constant TOKEN_PRICE_DENOMINATOR = 1e18;

    /// @notice Address of the contract that will handle the swap for token fee
    ICollectorSwapper public collectorSwapper;

    /// @notice Flag to enable/disable automatic fee token swap in postOp
    bool public postOpSwapEnabled;

    /**
     * @notice Initializes the TokenPaymaster with the admin, operator, EntryPoint.
     * @param owner The address granted DEFAULT_ADMIN_ROLE.
     * @param operator The address granted OPERATOR_ROLE for signing paymaster authorizations.
     * @param entryPoints The ERC-4337 EntryPoint contract address.
     */
    constructor(
        address owner,
        address operator,
        address[] memory entryPoints
    ) nonZeroAddress(owner) StakeManager(entryPoints) EIP712Service(operator) {
        _grantRole(DEFAULT_ADMIN_ROLE, owner);
    }

    /// @inheritdoc IPaymaster
    /// @dev Validates paymaster authorization without pre-charging tokens.
    /// Token transfer happens in postOp after actual gas usage is known.
    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 /* maxCost */
    )
        external
        onlySupportedEntryPoint(msg.sender)
        whenNotPaused
        returns (bytes memory context, uint256 validationData)
    {
        address token;
        uint256 exchangeRate;
        uint256 postOpCost;
        bytes memory opaque;

        (token, exchangeRate, postOpCost, opaque, validationData) = _validateAndDecodePaymasterAndData(userOp);
        if (validationData == SIG_VALIDATION_FAILED) return (bytes(""), SIG_VALIDATION_FAILED);

        context = abi.encodePacked(token, exchangeRate, postOpCost, userOp.sender, userOpHash, opaque);
        validationData = SIG_VALIDATION_SUCCESS;
    }

    /// @inheritdoc IPaymaster
    /// @dev Transfers exact token amount based on actual gas usage and swap fee token if enabled.
    /// No pre-funding or refunds - user pays only what was actually consumed.
    function postOp(
        PostOpMode /* mode */,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 actualUserOpFeePerGas
    ) external onlySupportedEntryPoint(msg.sender) whenNotPaused {
        if (context.length < MIN_CONTEXT_LENGTH) revert InvalidPostOpContextLength(context.length);

        (
            address token,
            uint256 exchangeRate,
            uint256 postOpCost,
            address sender,
            bytes32 userOpHash,
            bytes memory opaque
        ) = _parseContext(context);

        // Calculate exact token amount needed based on actual gas consumption
        uint256 actualTokenNeeded;
        unchecked {
            actualTokenNeeded =
                ((actualGasCost + postOpCost * actualUserOpFeePerGas) * exchangeRate) /
                TOKEN_PRICE_DENOMINATOR;
        }


        // Transfer exact token amount from user to paymaster
        // User must have sufficient allowance or include approve in userOp calldata
        IERC20(token).safeTransferFrom(sender, address(this), actualTokenNeeded);

        // If swap is enabled and the token is supported, swap the token
        if (postOpSwapEnabled && address(collectorSwapper) != address(0) && collectorSwapper.isTokenEnabled(token)) {
            _approveToken(token, address(collectorSwapper), actualTokenNeeded);
            collectorSwapper.postOpHandle(opaque, token, actualTokenNeeded);
        }

        emit UserOperationSponsored(sender, userOpHash, token, actualTokenNeeded, exchangeRate);
    }

    function setCollectorSwapper(address swapper) external nonZeroAddress(swapper) onlyRole(DEFAULT_ADMIN_ROLE) {
        collectorSwapper = ICollectorSwapper(swapper);
        emit CollectorSwapperUpdated(swapper);
    }

    function setPostOpSwapEnabled(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        postOpSwapEnabled = enabled;
        emit PostOpTrySwapEnabledUpdated(enabled);
    }

    /**
     * @notice Withdraws a specified amount of a single ERC-20 token from the paymaster to a recipient.
     * @param recipient The address that will receive the withdrawn tokens.
     * @param amount The amount of tokens to withdraw, or `type(uint256).max` to withdraw the full balance.
     */
    function withdrawTokens(
        IERC20 token,
        address recipient,
        uint256 amount
    ) external nonZeroAddress(recipient) nonZeroUint256(amount) onlyRole(DEFAULT_ADMIN_ROLE) {
        IERC20[] memory tokens = new IERC20[](1);
        uint256[] memory amounts = new uint256[](1);
        tokens[0] = token;
        amounts[0] = amount;

        _withdrawTokensBatch(tokens, amounts, recipient);
    }

    /**
     * @notice Batch withdraw multiple tokens to recipient.
     * @param tokens Array of ERC20 tokens to withdraw.
     * @param amounts Array of amounts to withdraw (use type(uint256).max for full balance).
     * @param recipient Address to receive the tokens.
     */
    function withdrawTokensBatch(
        IERC20[] calldata tokens,
        uint256[] calldata amounts,
        address recipient
    ) external nonZeroAddress(recipient) onlyRole(DEFAULT_ADMIN_ROLE) {
        _withdrawTokensBatch(tokens, amounts, recipient);
    }

    /**
     * @notice Pauses all paymaster operations.
     * @dev Can only be called by an account with the DEFAULT_ADMIN_ROLE.
     *      When paused, the contract rejects UserOperations and postOp execution.
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Resumes paymaster operations after a pause.
     * @dev Can only be called by an account with the DEFAULT_ADMIN_ROLE.
     *      Enables UserOperation validation and postOp logic to proceed normally.
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function _withdrawTokensBatch(
        IERC20[] memory tokens,
        uint256[] memory amounts,
        address recipient
    ) private nonZeroUint256(tokens.length) {
        if (tokens.length != amounts.length) revert ArrayLengthMismatch(tokens.length, amounts.length);

        // Arrays to store actual withdrawn data for event
        address[] memory withdrawnTokens = new address[](tokens.length);
        uint256[] memory withdrawnAmounts = new uint256[](tokens.length);

        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];
            uint256 amount = amounts[i];

            // Validate token address is not zero
            if (address(token) == address(0)) revert ZeroAddress();

            // Handle max amount case
            if (amount == type(uint256).max) {
                amount = token.balanceOf(address(this));
            }

            // Store data for event
            withdrawnTokens[i] = address(token);
            withdrawnAmounts[i] = amount;

            // Only transfer if amount > 0
            if (amount > 0) {
                token.safeTransfer(recipient, amount);
            }
        }

        emit TokensWithdrawn(recipient, withdrawnTokens, withdrawnAmounts);
    }

    function _parseContext(
        bytes calldata context
    )
        private
        pure
        returns (
            address token,
            uint256 exchangeRate,
            uint256 postOpCost,
            address sender,
            bytes32 userOpHash,
            bytes memory opaque
        )
    {
        uint256 offset = 0;

        assembly {
            // address token (20 bytes)
            token := shr(96, calldataload(add(context.offset, offset)))
            offset := add(offset, 20)

            // uint256 exchangeRate (32 bytes)
            exchangeRate := calldataload(add(context.offset, offset))
            offset := add(offset, 32)

            // uint256 postOpCost (32 bytes)
            postOpCost := calldataload(add(context.offset, offset))
            offset := add(offset, 32)

            // address sender (20 bytes)
            sender := shr(96, calldataload(add(context.offset, offset)))
            offset := add(offset, 20)

            // bytes32 userOpHash (32 bytes)
            userOpHash := calldataload(add(context.offset, offset))
            offset := add(offset, 32)
        }

        // Get the opaque payload from the context
        opaque = context[offset:];
    }

    function _validateAndDecodePaymasterAndData(
        PackedUserOperation calldata userOp
    ) private returns (address, uint256, uint256, bytes memory, uint256) {
        // Validate exact paymaster data length for PaymasterPaymentData structure
        if (userOp.paymasterAndData.length < MIN_PAYMASTER_DATA_LENGTH) {
            revert InvalidPaymasterAndDataLength(userOp.paymasterAndData.length);
        }

        // Decode PaymasterPaymentData from fixed offset but without the opaque part
        // We cannot decode directly with a trailing `bytes` argument here like opaque because after shifting
        // to UserOperationLib.PAYMASTER_DATA_OFFSET offsets - for dynamic types (like `bytes`) would be invalid.
        (
            address token,
            uint256 exchangeRate,
            uint256 postOpCost,
            uint256 nonce,
            uint256 deadline,
            uint8 v,
            bytes32 r,
            bytes32 s
        ) = abi.decode(
                userOp.paymasterAndData[UserOperationLib.PAYMASTER_DATA_OFFSET:],
                (address, uint256, uint256, uint256, uint256, uint8, bytes32, bytes32)
            );

        // MIN_PAYMASTER_DATA_LENGTH is the offset of the opaque part
        bytes memory opaque = userOp.paymasterAndData[MIN_PAYMASTER_DATA_LENGTH:];

        PaymasterPaymentData memory paymentData = PaymasterPaymentData(
            token,
            exchangeRate,
            postOpCost,
            nonce,
            deadline,
            v,
            r,
            s,
            opaque
        );

        uint256 validationData = _validatePaymentSignature(userOp.sender, paymentData, userOp.callData);

        return (token, exchangeRate, postOpCost, opaque, validationData);
    }
}