// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

abstract contract ApproveManager {
    using SafeERC20 for IERC20;

    /**
     * @notice Approves a spender to use a specified amount of tokens
     * @dev Only approves if current allowance is less than required amount.
     *      For safety with non-standard tokens (like USDT), resets allowance to 0 
     *      before setting the new approval if there's an existing allowance.
     * @param token The address of the ERC20 token to approve
     * @param spender The address that will be approved to spend tokens
     * @param amount The amount of tokens to approve for spending
     */
    function _approveToken(address token, address spender, uint256 amount) internal {
        IERC20 tokenContract = IERC20(token);
        uint256 currentAllowance = tokenContract.allowance(address(this), spender);

        if (currentAllowance < amount) {
            // First reset to 0 if needed (some tokens require this)
            if (currentAllowance > 0) {
                tokenContract.forceApprove(spender, 0);
            }
            tokenContract.forceApprove(spender, amount);
        }
    }
}
