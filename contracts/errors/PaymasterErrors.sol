// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

error OnlyEntryPoint();
error InvalidPaymasterAndDataLength(uint256 length);
error ZeroAddress();
error ZeroUint256();
error InvalidSender(address paymentUser, address sender);
error InvalidPostOpContextLength(uint256 postOpContextLength);
error InsufficientTokenAmount();
