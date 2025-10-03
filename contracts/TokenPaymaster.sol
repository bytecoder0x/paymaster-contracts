// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ITokenPaymaster, PaymasterPaymentData} from "./interfaces/ITokenPaymaster.sol";
import {PostOpMode, PackedUserOperation} from "./interfaces/IPaymaster.sol";
import {StakeManager} from "./components/StakeManager.sol";
import {EIP712Service} from "./components/EIP712Service.sol";
import {UserOperationLib} from "./components/UserOperationLib.sol";
import {SIG_VALIDATION_FAILED, SIG_VALIDATION_SUCCESS} from "./components/Constants.sol";

import "./errors/PaymasterErrors.sol";

contract TokenPaymaster is ITokenPaymaster, StakeManager, EIP712Service {
    using SafeERC20 for IERC20;

    uint256 public immutable postOpCost;

    constructor(
        address owner,
        address operator,
        address entryPoint_,
        uint256 postOpCost_
    ) StakeManager(entryPoint_) EIP712Service(operator) {
        postOpCost = postOpCost_;
        _grantRole(DEFAULT_ADMIN_ROLE, owner);
    }

    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external onlyEntryPoint returns (bytes memory context, uint256 validationData) {
        PaymasterPaymentData memory paymentData;

        (paymentData, validationData) = _validateAndDecodeUserOpData(userOp);

        uint256 maxFeePerGas = UserOperationLib.unpackMaxFeePerGas(userOp);
        uint256 tokenAmount = ((maxCost + postOpCost * maxFeePerGas) * paymentData.tokenPriceWei) /
            _tokenPriceDenominator();

        bool prefunded = IERC20(paymentData.token).trySafeTransferFrom(userOp.sender, address(this), tokenAmount);

        if (validationData == SIG_VALIDATION_FAILED || !prefunded) return (bytes(""), SIG_VALIDATION_FAILED);

        context = abi.encodePacked(
            paymentData.token,
            tokenAmount,
            paymentData.tokenPriceWei,
            userOp.sender,
            userOpHash
        );
        validationData = SIG_VALIDATION_SUCCESS;
    }

    function postOp(
        PostOpMode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 actualUserOpFeePerGas
    ) external onlyEntryPoint {
        if (context.length == 0 || context.length > 136) revert InvalidPostOpContextLength(context.length);

        address token = address(bytes20(context[0:20]));
        uint256 tokenAmount = uint256(bytes32(context[20:52]));
        uint256 tokenPriceWei = uint256(bytes32(context[52:84]));
        address sender = address(bytes20(context[84:104]));
        bytes32 userOpHash = bytes32(context[104:136]);

        _validatePostOpContext(token, tokenAmount, tokenPriceWei, sender, userOpHash);

        uint256 actualTokenNeeded = ((actualGasCost + postOpCost * actualUserOpFeePerGas) * tokenPriceWei) /
            _tokenPriceDenominator();

        if (actualTokenNeeded > tokenAmount) revert InsufficientTokenPrepayment(actualTokenNeeded, tokenAmount);

        IERC20(token).safeTransferFrom(address(this), sender, tokenAmount - actualTokenNeeded);

        emit UserOperationSponsored(sender, userOpHash, token, actualTokenNeeded, tokenPriceWei);
    }

    function withdrawTokens(IERC20 token, address recipient, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (amount == type(uint256).max) amount = token.balanceOf(address(this));
        token.safeTransfer(recipient, amount);
    }

    function _validateAndDecodeUserOpData(
        PackedUserOperation calldata userOp
    ) private returns (PaymasterPaymentData memory paymentData, uint256 validationData) {
        if (userOp.sender.code.length == 0 && userOp.initCode.length == 0) revert OnlyEIP7702();

        paymentData = _validateAndDecodePaymasterAndData(userOp.paymasterAndData, userOp.sender);

        validationData = _validatePaymentSignature(userOp.sender, paymentData);
    }

    function _validateAndDecodePaymasterAndData(
        bytes calldata paymasterAndData,
        address sender
    ) private pure returns (PaymasterPaymentData memory data) {
        data = _parsePaymasterAndData(paymasterAndData);
        if (data.token == address(0) || data.user == address(0)) revert ZeroAddress();
        if (data.tokenPriceWei == 0) revert ZeroUint256();
        if (data.user != sender) revert InvalidSender(data.user, sender);
    }

    function _parsePaymasterAndData(
        bytes calldata paymasterAndData
    ) private pure returns (PaymasterPaymentData memory) {
        // 52 bytes => paymaster address + gas limit data
        // 320 bytes => PaymasterPaymentData struct (32 x 10)
        if (paymasterAndData.length < 53 || paymasterAndData.length > 372) {
            revert InvalidPaymasterAndDataLength(paymasterAndData.length);
        }
        return abi.decode(paymasterAndData[UserOperationLib.PAYMASTER_DATA_OFFSET:], (PaymasterPaymentData));
    }

    function _validatePostOpContext(
        address token,
        uint256 tokenAmount,
        uint256 tokenPriceWei,
        address sender,
        bytes32 userOpHash
    ) private pure {
        if (token == address(0) || sender == address(0)) revert ZeroAddress();
        if (tokenAmount == 0 || tokenPriceWei == 0) revert ZeroUint256();
        if (userOpHash == bytes32(0)) revert ZeroBytes32();
    }

    function _tokenPriceDenominator() private pure returns (uint256) {
        return 1e18;
    }
}
