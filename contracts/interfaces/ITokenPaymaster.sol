// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IPaymaster} from "./IPaymaster.sol";

struct PaymasterPaymentData {
    address token;
    uint256 tokenPriceWei;
    address user;
    address operator;
    uint256 nonce;
    uint256 deadline;
    uint8 v;
    bytes32 r;
    bytes32 s;
}

interface ITokenPaymaster is IPaymaster {
    event UserOperationSponsored(
        address indexed sender,
        bytes32 indexed userOpHash,
        address indexed token,
        uint256 tokenAmount,
        uint256 tokenPrice
    );
}
