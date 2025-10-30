// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IUniswapV3Factory} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import {ISwapRouter} from "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import {IQuoterV2} from "@uniswap/v3-periphery/contracts/interfaces/IQuoterV2.sol";

import {ApproveManager} from "./components/ApproveManager.sol";
import {StorageCollectorSwapper} from "./components/StorageCollectorSwapper.sol";
import {ICollectorSwapper} from "./interfaces/ICollectorSwapper.sol";
import {ZeroAddress} from "./errors/PaymasterErrors.sol";
import {Unauthorized, TokenIsCanonical, SwapIsNotPossible, InvalidOpaqueLength, InvalidAmountOut} from "./errors/CollectorSwapperErrors.sol";

contract CollectorSwapper is StorageCollectorSwapper, ApproveManager {
    using SafeERC20 for IERC20;

    /// @dev The length of the opaque payload (deadline + pool fee)
    uint256 private constant OPAQUE_LENGTH = 64;

    /**
     * @param paymaster_ The paymaster address
     * @param canonicalToken_ The canonical token address (e.g., USDC)
     * @param factory_ Uniswap V3 Factory address
     * @param router_ Uniswap V3 SwapRouter address
     * @param quoter_ Uniswap V3 Quoter address
     * @param admin_ Admin address for DEFAULT_ADMIN_ROLE
     */
    constructor(
        address paymaster_,
        address canonicalToken_,
        address factory_,
        address router_,
        address quoter_,
        address admin_
    ) StorageCollectorSwapper(paymaster_, canonicalToken_, factory_, router_, quoter_, admin_) { }

    /// @inheritdoc ICollectorSwapper
    /// @dev Performs validation checks before executing swap via Uniswap V3 router.
    ///      Operates in best-effort mode - returns early on validation failures to prevent reverts.
    ///      If swap succeeds, canonical tokens go to paymaster. If swap fails, original tokens are returned.
    ///      Emits SwapSucceeded or SwapFailed events for monitoring and off-chain tracking.
    function postOpHandle(bytes calldata opaque, address tokenIn, uint256 amountIn) external onlyPaymaster {
        // Validate the post-op handle
        if (!_validatePostOpHandle(opaque, tokenIn, amountIn)) return;

        // Parse the opaque payload
        (uint256 deadline, uint24 poolFee) = _parseOpaque(opaque);

        // Get the minimum amount out what we expect to receive
        uint256 amountOutMin = getAmountOutMin(tokenIn, amountIn, poolFee);
        // If the amount out min is 0 that means the swap is not possible, so we return
        if (amountOutMin == 0) return;

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

    /// @inheritdoc ICollectorSwapper
    /// @dev This function is used to get the minimum amount out for a swap including the slippage.
    function getAmountOutMin(address tokenIn, uint256 amountIn, uint24 poolFee) public returns (uint256 amountOutMin) {
        IQuoterV2.QuoteExactInputSingleParams memory params = IQuoterV2.QuoteExactInputSingleParams({
            tokenIn: tokenIn,
            tokenOut: canonicalToken,
            amountIn: amountIn,
            fee: poolFee,
            sqrtPriceLimitX96: 0
        });

        try IQuoterV2(quoter).quoteExactInputSingle(params)
            returns (uint256 amountOut, uint160, uint32, uint256)
        {
            if (amountOut != 0) {
                amountOutMin = amountOut * (MAX_BIPS - slippageBps) / MAX_BIPS;
            } else {
                emit SwapFailed(tokenIn, amountIn, abi.encodeWithSelector(InvalidAmountOut.selector));
            }
        } catch (bytes memory reason) {
            emit SwapFailed(tokenIn, amountIn, reason);
        }
    }

    /// @inheritdoc ICollectorSwapper
    function isSwapAvailable(address tokenIn, uint24 poolFee) public view returns (bool) {
        address pool = IUniswapV3Factory(factory).getPool(tokenIn, canonicalToken, poolFee);

        return pool != address(0);
    }

    /// @inheritdoc ICollectorSwapper
    function isSwapAvailable(address tokenIn, bytes calldata opaque) public view returns (bool) {
        if (opaque.length != OPAQUE_LENGTH) {
            return false;
        }

        (, uint24 poolFee) = _parseOpaque(opaque);

        return isSwapAvailable(tokenIn, poolFee);
    }

    function _validatePostOpHandle(
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

        if (!isSwapAvailable(tokenIn, opaque)) {
            emit SwapFailed(tokenIn, amountIn, abi.encodeWithSelector(SwapIsNotPossible.selector, tokenIn));
            return false;
        }

        isValid = true;
    }

    function _parseOpaque(bytes calldata opaque) private pure returns (uint256 deadline, uint24 poolFee) {
        uint256 offset = 0;

        assembly {
            // deadline (32 bytes)
            deadline := calldataload(add(opaque.offset, offset))
            offset := add(offset, 32)

            // poolFee (32 bytes)
            poolFee := calldataload(add(opaque.offset, offset))
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
