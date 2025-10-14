// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ZeroAddress, ZeroUint256} from "../errors/PaymasterErrors.sol";

abstract contract ValidationModifiers {
    /**
     * @notice Checks if the given address is not the zero address.
     * @param addr The address to validate.
     */
    modifier nonZeroAddress(address addr) {
        if (addr == address(0)) revert ZeroAddress();
        _;
    }

    /**
     * @notice Checks if the given uint256 value is not zero.
     * @param value The value to validate.
     */
    modifier nonZeroUint256(uint256 value) {
        if (value == 0) revert ZeroUint256();
        _;
    }
}
