// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapRouter} from "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

import {ApproveManager} from "./components/ApproveManager.sol";
import {StorageCollectorSwapper} from "./components/StorageCollectorSwapper.sol";
import {ICollectorSwapper} from "./interfaces/ICollectorSwapper.sol";
import {ZeroAddress} from "./errors/PaymasterErrors.sol";
import {Unauthorized, TokenIsCanonical, UnsupportedToken, InvalidOpaqueLength} from "./errors/CollectorSwapperErrors.sol";

contract CollectorSwapper is StorageCollectorSwapper, ApproveManager {
    using SafeERC20 for IERC20;

    uint256 private constant OPAQUE_LENGTH = 96;

    /**
     * @param canonicalToken_ The canonical token address (e.g., USDC)
     * @param router_ Uniswap V3 SwapRouter address
     * @param admin_ Admin address for DEFAULT_ADMIN_ROLE
     */
    constructor(
        address paymaster_,
        address canonicalToken_,
        address router_,
        address admin_
    ) StorageCollectorSwapper(paymaster_, canonicalToken_, router_, admin_) { }

    /// @inheritdoc ICollectorSwapper
    /// @dev Performs validation checks before executing swap via Uniswap V3 router.
    ///      Operates in best-effort mode - returns early on validation failures to prevent reverts.
    ///      If swap succeeds, canonical tokens go to paymaster. If swap fails, original tokens are returned.
    ///      Emits SwapSucceeded or SwapFailed events for monitoring and off-chain tracking.
    function postOpHandle(bytes calldata opaque, address tokenIn, uint256 amountIn) external onlyPaymaster {
        // Validate the post-op handle
        if (!_valdiatePostOpHandle(opaque, tokenIn, amountIn)) return;

        // Parse the opaque payload
        (uint256 amountOutMin, uint256 deadline, uint24 poolFee) = _parseOpaque(opaque, tokenIn);

        // receive the token from the paymaster
        IERC20(tokenIn).safeTransferFrom(paymaster, address(this), amountIn);
        // approve the token to the router
        _approveToken(tokenIn, router, amountIn);

        ISwapRouter.ExactInputSingleParams memory params = _generateSwapParams(tokenIn, amountIn, amountOutMin, deadline, poolFee);

        // execute the swap
        try ISwapRouter(router).exactInputSingle(params) returns (uint256 amountOut) {
            emit SwapSucceeded(tokenIn, amountIn, amountOut);
        } catch (bytes memory reason) {
            // Swap failed, return tokens to paymaster
            IERC20(tokenIn).safeTransfer(paymaster, amountIn);
            emit SwapFailed(tokenIn, amountIn, reason);
        }
    }

    function _valdiatePostOpHandle(
        bytes calldata opaque,
        address tokenIn,
        uint256 amountIn
    ) private returns (bool isValid) {
        if (tokenIn == address(0)) {
            emit SwapFailed(tokenIn, amountIn, abi.encodeWithSelector(ZeroAddress.selector));
            return false;
        }

        if (opaque.length != OPAQUE_LENGTH) {
            emit SwapFailed(tokenIn, amountIn, abi.encodeWithSelector(InvalidOpaqueLength.selector, opaque.length));
            return false;
        }

        if (paused()) {
            emit SwapFailed(tokenIn, amountIn, abi.encodeWithSelector(EnforcedPause.selector));
            return false;
        }

        if (tokenIn == canonicalToken) {
            emit SwapFailed(tokenIn, amountIn, abi.encodeWithSelector(TokenIsCanonical.selector));
            return false;
        }

        if (!tokenConfig[tokenIn].enabled) {
            emit SwapFailed(tokenIn, amountIn, abi.encodeWithSelector(UnsupportedToken.selector, tokenIn));
            return false;
        }

        isValid = true;
    }

    function _parseOpaque(
        bytes calldata opaque,
        address tokenIn
    )
        private
        view
        returns (
            uint256 amountOutMin,
            uint256 deadline,
            uint24 poolFee
        )
    {
        poolFee = tokenConfig[tokenIn].poolFee;

        uint256 offset = 0;

        assembly {
            // amountOutMin (32 bytes)
            amountOutMin := calldataload(add(opaque.offset, offset))
            offset := add(offset, 32)

            // deadline (32 bytes)
            deadline := calldataload(add(opaque.offset, offset))
            offset := add(offset, 32)

            // poolFee (32 bytes)
            let overriddenPoolFee := calldataload(add(opaque.offset, offset))
            
            // If overriddenPoolFee != 0 — update poolFee
            if overriddenPoolFee {
                poolFee := overriddenPoolFee
            }
        }
    }

    function _generateSwapParams(
        address tokenIn,
        uint256 amountIn,
        uint256 amountOutMin,
        uint256 deadline,
        uint24 poolFee
    ) private view returns (ISwapRouter.ExactInputSingleParams memory params) {
        params = ISwapRouter.ExactInputSingleParams({
            tokenIn: tokenIn,
            tokenOut: canonicalToken,
            fee: poolFee,
            recipient: paymaster,
            deadline: deadline,
            amountIn: amountIn,
            amountOutMinimum: amountOutMin,
            sqrtPriceLimitX96: 0
        });
    }
}
