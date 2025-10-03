// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ITokenPaymaster, PaymasterPaymentData} from "./interfaces/ITokenPaymaster.sol";
import {PostOpMode, PackedUserOperation} from "./interfaces/IPaymaster.sol";
import {StakeManager} from "./components/StakeManager.sol";
import {EIP712Service} from "./components/EIP712Service.sol";
import {UserOperationLib} from "./components/UserOperationLib.sol";
import {SIG_VALIDATION_SUCCESS} from "./components/Helpers.sol";
import {OnlyEIP7702, InvalidPaymasterAndDataLength, ZeroAddress, ZeroUint256, InvalidSender} from "./errors/PaymasterErrors.sol";

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
        PaymasterPaymentData memory paymentData = _validateAndDecodeUserOpData(userOp);

        uint256 maxFeePerGas = UserOperationLib.unpackMaxFeePerGas(userOp);
        uint256 tokenAmount = ((maxCost + postOpCost * maxFeePerGas) * paymentData.tokenPriceWei) /
            _tokenPriceDenominator();

        IERC20(paymentData.token).safeTransferFrom(userOp.sender, address(this), tokenAmount);

        context = abi.encodePacked(paymentData.token, paymentData.tokenPriceWei, userOp.sender, userOpHash);
        validationData = SIG_VALIDATION_SUCCESS;
    }

    function postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 actualUserOpFeePerGas
    ) external onlyEntryPoint {}

    function _parsePaymasterAndData(
        bytes calldata paymasterAndData
    ) private pure returns (PaymasterPaymentData memory) {
        // 52 bytes => paymaster address + gas limit data
        // 288 bytes => PaymasterPaymentData struct (32 x 9)
        if (paymasterAndData.length < 53 || paymasterAndData.length > 340) {
            revert InvalidPaymasterAndDataLength(paymasterAndData.length);
        }
        return abi.decode(paymasterAndData[UserOperationLib.PAYMASTER_DATA_OFFSET:], (PaymasterPaymentData));
    }

    function _validateAndDecodeUserOpData(
        PackedUserOperation calldata userOp
    ) private returns (PaymasterPaymentData memory paymentData) {
        if (userOp.sender.code.length == 0) revert OnlyEIP7702();
        paymentData = _parsePaymasterAndData(userOp.paymasterAndData);
        if (paymentData.token == address(0) || paymentData.user == address(0)) revert ZeroAddress();
        if (paymentData.tokenPriceWei == 0) revert ZeroUint256();
        if (paymentData.user != userOp.sender) revert InvalidSender(paymentData.user, userOp.sender);
        _validatePaymentSignature(paymentData);
    }

    function _tokenPriceDenominator() private pure returns (uint256) {
        return 1e18;
    }
}
