// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ZeroAddress, ZeroUint256} from "../errors/PaymasterErrors.sol";

abstract contract ValidationModifiers {
    modifier nonZeroAddress(address addr) {
        if (addr == address(0)) revert ZeroAddress();
        _;
    }

    modifier nonZeroUint256(uint256 value) {
        if (value == 0) revert ZeroUint256();
        _;
    }
}
