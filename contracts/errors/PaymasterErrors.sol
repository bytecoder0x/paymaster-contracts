// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

error OnlyEntryPoint();
error OnlyEIP7702();
error InvalidPaymasterAndDataLength(uint256 length);
error ZeroAddress();
error ZeroUint256();
error ZeroBytes32();
error InvalidSender(address paymentUser, address sender);
error InvalidPostOpContextLength(uint256 postOpContextLength);
error InsufficientTokenPrefund(uint256 actualTokenNeeded, uint256 tokenAmount);
error PrefundFailed();
error RefundFailed();
