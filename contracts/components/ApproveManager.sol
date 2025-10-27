// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

abstract contract ApproveManager {
    using SafeERC20 for IERC20;

    /**
     * @notice Approves a spender to use infinite amount of tokens for gas efficiency
     * @dev Uses infinite approval strategy (type(uint256).max) to save gas on future operations.
     *      Only approves if current allowance is less than required amount.
     *      For safety with non-standard tokens (like USDT), resets allowance to 0 
     *      before setting the new approval if there's an existing allowance.
     *      
     *      Gas optimization: After first approval, all subsequent operations save ~45k gas
     *      by skipping the approval step entirely.
     *      
     *      Security: Safe because spender is admin-controlled (CollectorSwapper with onlyPaymaster).
     * 
     * @param token The address of the ERC20 token to approve
     * @param spender The address that will be approved to spend tokens
     * @param amount The minimum amount needed for current operation (used for allowance check only)
     */
    function _approveToken(address token, address spender, uint256 amount) internal {
        IERC20 tokenContract = IERC20(token);
        uint256 currentAllowance = tokenContract.allowance(address(this), spender);

        if (currentAllowance < amount) {
            // Approve infinite amount for gas efficiency on future operations
            // Approval reset is already handled in the forceApprove
            tokenContract.forceApprove(spender, type(uint256).max);
        }
    }
}
