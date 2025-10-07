// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/IPaymaster.sol";
import {UserOperationLib} from "@account-abstraction/contracts/core/UserOperationLib.sol";
import {SIG_VALIDATION_FAILED, SIG_VALIDATION_SUCCESS} from "@account-abstraction/contracts/core/Helpers.sol";

import {ITokenPaymaster, PaymasterPaymentData} from "./interfaces/ITokenPaymaster.sol";
import {StakeManager} from "./components/StakeManager.sol";
import {EIP712Service} from "./components/EIP712Service.sol";
import {InsufficientTokenAmount, InvalidPostOpContextLength, InvalidPaymasterAndDataLength} from "./errors/PaymasterErrors.sol";

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
        address token;
        uint256 tokenPriceWei;

        (token, tokenPriceWei, validationData) = _validateAndDecodePaymasterAndData(userOp);
        if (validationData == SIG_VALIDATION_FAILED) return (bytes(""), SIG_VALIDATION_FAILED);

        uint256 maxFeePerGas = UserOperationLib.unpackMaxFeePerGas(userOp);
        uint256 tokenAmount = ((maxCost + postOpCost * maxFeePerGas) * tokenPriceWei) / _tokenPriceDenominator();

        if (tokenAmount == 0) revert InsufficientTokenAmount();

        IERC20(token).safeTransferFrom(userOp.sender, address(this), tokenAmount);

        context = abi.encodePacked(token, tokenAmount, tokenPriceWei, userOp.sender, userOpHash);
        validationData = SIG_VALIDATION_SUCCESS;
    }

    function postOp(
        PostOpMode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 actualUserOpFeePerGas
    ) external onlyEntryPoint {
        if (context.length != 136) revert InvalidPostOpContextLength(context.length);

        address token = address(bytes20(context[0:20]));
        uint256 tokenAmount = uint256(bytes32(context[20:52]));
        uint256 tokenPriceWei = uint256(bytes32(context[52:84]));
        address sender = address(bytes20(context[84:104]));
        bytes32 userOpHash = bytes32(context[104:136]);

        uint256 actualTokenNeeded = ((actualGasCost + postOpCost * actualUserOpFeePerGas) * tokenPriceWei) /
            _tokenPriceDenominator();

        IERC20(token).safeTransfer(sender, tokenAmount - actualTokenNeeded);

        emit UserOperationSponsored(sender, userOpHash, token, actualTokenNeeded, tokenPriceWei);
    }

    function withdrawTokens(IERC20 token, address recipient, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (amount == type(uint256).max) amount = token.balanceOf(address(this));
        token.safeTransfer(recipient, amount);
    }

    function _validateAndDecodePaymasterAndData(
        PackedUserOperation calldata userOp
    ) private returns (address token, uint256 tokenPriceWei, uint256 validationData) {
        uint256 length = userOp.paymasterAndData.length;

        // 52 bytes => paymaster address + gas limit data
        // 288 bytes => PaymasterPaymentData struct (32 x 9)
        if (length < 53 || length > 340) {
            revert InvalidPaymasterAndDataLength(userOp.paymasterAndData.length);
        }

        PaymasterPaymentData memory paymentData = abi.decode(
            userOp.paymasterAndData[UserOperationLib.PAYMASTER_DATA_OFFSET:],
            (PaymasterPaymentData)
        );

        validationData = _validatePaymentSignature(userOp.sender, paymentData);

        token = paymentData.token;
        tokenPriceWei = paymentData.tokenPriceWei;
    }

    function _tokenPriceDenominator() private pure returns (uint256) {
        return 1e18;
    }
}
