// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title ICollectorSwapper
 * @notice Interface for the CollectorSwapper contract that consolidates fee tokens into a canonical token
 */
interface ICollectorSwapper {

    /**
     * @notice Configuration for a token that can be swapped
     * @param enabled Whether the token is enabled for swapping
     * @param poolFee The Uniswap V3 pool fee tier in basis points (e.g., 500, 3000, 10000)
     */
    struct TokenConfig {
        bool enabled;
        uint24 poolFee; 
    }

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
     * @notice Emitted when a token's swap configuration is updated
     * @param token The token address being configured
     * @param enabled Whether the token is enabled for swapping
     * @param poolFee The Uniswap V3 pool fee for this token
     */
    event TokenConfigUpdated(address indexed token, bool enabled, uint24 poolFee);

    /**
     * @notice Emitted when the Uniswap V3 Quoter address is updated
     * @param quoter The new quoter address
     */
    event QuoterUpdated(address indexed quoter);

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
     * @notice Updates the slippage in basis points what is allowed for the swap
     * @param slippageBps_ The new slippage in basis points to set
     */
    function setSlippageBps(uint256 slippageBps_) external;

    /**
     * @notice Configures a token for swapping by setting its enabled status and pool fee
     * @param token The ERC20 token address to configure
     * @param cfg The token configuration containing enabled flag and pool fee in basis points
     */
    function setTokenConfig(address token, TokenConfig calldata cfg) external;

    /**
     * @notice Updates the canonical token address that all collected tokens will be swapped to
     * @param canonicalToken_ The new canonical token address to set
     */
    function setCanonicalToken(address canonicalToken_) external;

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
     * @notice Retrieves the complete swap configuration for a specific token
     * @param token The ERC20 token address to query
     * @return The token configuration struct with enabled flag and pool fee
     */
    function getTokenConfig(address token) external view returns (TokenConfig memory);

    /**
     * @notice Checks if a token is enabled for swapping
     * @param token The token address to check
     * @return enabled True if the token can be swapped, false otherwise
     */
    function isTokenEnabled(address token) external view returns (bool enabled);
}
