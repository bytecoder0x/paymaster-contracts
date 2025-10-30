// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title ICollectorSwapper
 * @notice Interface for the CollectorSwapper contract that consolidates fee tokens into a canonical token
 */
interface ICollectorSwapper {

    /**
     * @notice Emitted when the slippage is updated
     * @param slippage The new slippage in basis points
     */
    event SlippageUpdated(uint256 slippage);

    /**
     * @notice Emitted when the Uniswap V3 router address is updated
     * @param router The new router address
     */
    event RouterUpdated(address indexed router);
    
    /**
     * @notice Emitted when the canonical token address is updated
     * @param canonicalToken The new canonical token address
     */
    event CanonicalTokenUpdated(address indexed canonicalToken);
    
    /**
     * @notice Emitted when the authorized paymaster address is updated
     * @param paymaster The new paymaster address
     */
    event PaymasterUpdated(address indexed paymaster);
    
    /**
     * @notice Emitted when the Uniswap V3 Quoter address is updated
     * @param quoter The new quoter address
     */
    event QuoterUpdated(address indexed quoter);

    /**
     * @notice Emitted when the Uniswap V3 Factory address is updated
     * @param factory The new factory address
     */
    event FactoryUpdated(address indexed factory);

    /**
     * @notice Emitted when a token swap completes successfully
     * @param tokenIn The input token that was swapped
     * @param amountIn The amount of input token swapped
     * @param amountOut The amount of canonical token received
     */
    event SwapSucceeded(address indexed tokenIn, uint256 amountIn, uint256 amountOut);
    
    /**
     * @notice Emitted when a token swap fails for any reason
     * @param tokenIn The input token that failed to swap
     * @param amountIn The amount that was attempted to swap
     * @param reason The encoded error reason for the failure
     */
    event SwapFailed(address indexed tokenIn, uint256 amountIn, bytes reason);

    /**
     * @notice Handles post-operation token swap from fee token to canonical token
     * @param opaque Encoded swap parameters (deadline, poolFee override)
     * @param tokenIn The token address to swap from
     * @param amountIn The amount of tokens to swap
     */
    function postOpHandle(bytes calldata opaque, address tokenIn, uint256 amountIn) external;

    /**
     * @notice Gets the minimum amount out for a swap
     * @param tokenIn The token to swap from
     * @param amountIn The amount of tokens to swap
     * @param poolFee The Uniswap V3 pool fee tier
     * @return amountOutMin The minimum amount out for the swap
     */
    function getAmountOutMin(address tokenIn, uint256 amountIn, uint24 poolFee) external returns (uint256 amountOutMin);

    /**
     * @notice Updates the slippage in basis points what is allowed for the swap
     * @param slippageBps_ The new slippage in basis points to set
     */
    function setSlippageBps(uint256 slippageBps_) external;

    /**
     * @notice Updates the canonical token address that all collected tokens will be swapped to
     * @param canonicalToken_ The new canonical token address to set
     */
    function setCanonicalToken(address canonicalToken_) external;

    /**
     * @notice Updates the Uniswap V3 Factory address used to search for pools
     * @param factory_ The new Uniswap V3 Factory address to set
     */
    function setFactory(address factory_) external;

    /**
     * @notice Updates the Uniswap V3 SwapRouter address used for executing token swaps
     * @param router_ The new Uniswap V3 SwapRouter address to set
     */
    function setRouter(address router_) external;

    /**
     * @notice Updates the Uniswap V3 Quoter address used for real-time quotes
     * @param quoter_ The new Uniswap V3 Quoter address to set
     */
    function setQuoter(address quoter_) external;

    /**
     * @notice Updates the authorized paymaster address that can trigger token swaps
     * @param paymaster_ The new authorized paymaster address to set
     */
    function setPaymaster(address paymaster_) external;

    /**
     * @notice Pauses all swap operations in the contract
     */
    function pause() external;

    /**
     * @notice Resumes all swap operations in the contract
     */
    function unpause() external;

    /**
     * @notice Checks whether a swap pool exists for the given token pair and pool fee
     * @param tokenIn The token to swap from
     * @param poolFee The Uniswap V3 pool fee tier
     * @return True if the swap pool exists, false otherwise
     */
    function isSwapAvailable(address tokenIn, uint24 poolFee) external view returns (bool);

    /**
     * @notice Checks whether a swap pool exists by decoding the provided opaque payload
     * @param tokenIn The token to swap from
     * @param opaque Encoded swap parameters containing the pool fee
     * @return True if the swap pool exists, false otherwise
     */
    function isSwapAvailable(address tokenIn, bytes calldata opaque) external view returns (bool);
}
