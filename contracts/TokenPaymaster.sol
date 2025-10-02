// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PostOpMode, PackedUserOperation} from "./interfaces/IPaymaster.sol";
import {ITokenPaymaster} from "./interfaces/ITokenPaymaster.sol";
import {BasePaymaster} from "./components/BasePaymaster.sol";
import {OnlyEntryPoint} from "./errors/PaymasterErrors.sol";
import {EIP712Service} from "./components/EIP712Service.sol";

contract TokenPaymaster is ITokenPaymaster, BasePaymaster, EIP712Service {
    modifier onlyEntryPoint() {
        if (msg.sender != address(entryPoint)) revert OnlyEntryPoint();
        _;
    }

    constructor(
        address owner,
        address operator,
        address entryPoint_
    ) BasePaymaster(owner, entryPoint_) EIP712Service(operator) {}

    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external onlyEntryPoint returns (bytes memory context, uint256 validationData) {}

    function postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 actualUserOpFeePerGas
    ) external onlyEntryPoint {}
}
