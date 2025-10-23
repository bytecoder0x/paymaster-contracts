// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ISwapRouter } from "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

import { ZeroAddress } from "../errors/PaymasterErrors.sol";
import { InvalidTokenConfig, Unauthorized } from "../errors/CollectorSwapperErrors.sol";
import { ICollectorSwapper } from "../interfaces/ICollectorSwapper.sol";

abstract contract StorageCollectorSwapper is ICollectorSwapper, AccessControl, Pausable {
    using SafeERC20 for IERC20;

    /// @notice The canonical token address that all collected tokens are swapped to (e.g., USDC)
    address public canonicalToken;
    
    /// @notice The Uniswap V3 SwapRouter address used for token swaps
    address public router; 
    
    /// @notice The authorized paymaster address that can trigger token swaps
    address public paymaster;

    /// @notice Mapping of token addresses to their swap configuration (enabled status and pool fee)
    mapping(address => TokenConfig) public tokenConfig;

    /**
     * @notice Modifier to restrict function access to only the authorized paymaster
     * @dev Reverts with Unauthorized error if caller is not the paymaster
     */
    modifier onlyPaymaster() {
        if (msg.sender != paymaster) revert Unauthorized();
        _;
    }

    /**
     * @notice Initializes the CollectorSwapper storage with essential addresses
     * @dev Sets up the paymaster, canonical token, router, and grants admin role.
     *      All addresses must be non-zero, otherwise the transaction will revert.
     * @param _paymaster The authorized paymaster address that can trigger swaps
     * @param _canonicalToken The target token address for all swaps (e.g., USDC, USDT)
     * @param _router The Uniswap V3 SwapRouter address for executing swaps
     * @param _admin The admin address that will receive DEFAULT_ADMIN_ROLE privileges
     */
    constructor(address _paymaster, address _canonicalToken, address _router, address _admin) {
        if (_paymaster == address(0)) revert ZeroAddress();
        if (_canonicalToken == address(0)) revert ZeroAddress();
        if (_router == address(0)) revert ZeroAddress();
        if (_admin == address(0)) revert ZeroAddress();

        paymaster = _paymaster;
        canonicalToken = _canonicalToken;
        router = _router;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    /// @inheritdoc ICollectorSwapper
    /// @dev Only callable by admin. Used to whitelist tokens and specify the Uniswap V3 pool fee tier.
    ///      Token address and pool fee must be non-zero. Pool fee typically is 500 (0.05%), 3000 (0.3%), or 10000 (1%).
    function setTokenConfig(address token, TokenConfig calldata cfg) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (token == address(0) || cfg.poolFee == 0) {
            revert InvalidTokenConfig();
        }

        tokenConfig[token] = cfg;
        emit TokenConfigUpdated(token, cfg.enabled, cfg.poolFee);
    }

    /// @inheritdoc ICollectorSwapper
    /// @dev Only callable by admin. This is the target token for all swap operations (e.g., USDC).
    ///      The address must be non-zero, otherwise the transaction will revert.
    function setCanonicalToken(address canonicalToken_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (canonicalToken_ == address(0)) revert ZeroAddress();
        canonicalToken = canonicalToken_;
        emit CanonicalTokenUpdated(canonicalToken);
    }

    /// @inheritdoc ICollectorSwapper
    /// @dev Only callable by admin. This address is used for all swap operations via exactInputSingle.
    ///      The address must be non-zero, otherwise the transaction will revert.
    function setRouter(address router_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (router_ == address(0)) revert ZeroAddress();
        router = router_;
        emit RouterUpdated(router);
    }

    /// @inheritdoc ICollectorSwapper
    /// @dev Only callable by admin. The paymaster is the only address allowed to call swap functions.
    ///      Used to authorize which paymaster contract can initiate token collection and swapping.
    ///      The address must be non-zero, otherwise the transaction will revert.
    function setPaymaster(address paymaster_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (paymaster_ == address(0)) revert ZeroAddress();
        paymaster = paymaster_;
        emit PaymasterUpdated(paymaster);
    }

    /// @inheritdoc ICollectorSwapper
    /// @dev Only callable by admin. When paused, all functions with whenNotPaused modifier will revert.
    ///      Used as an emergency stop mechanism to prevent swaps during critical situations.
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /// @inheritdoc ICollectorSwapper
    /// @dev Only callable by admin. Removes the pause state and allows normal operations to continue.
    ///      Should be called after resolving any issues that required pausing.
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /// @inheritdoc ICollectorSwapper
    /// @dev Returns the TokenConfig struct containing enabled status and pool fee.
    ///      If the token has not been configured, returns default values (enabled=false, poolFee=0).
    function getTokenConfig(address token) external view returns (TokenConfig memory) {
        return tokenConfig[token];
    }

    /// @inheritdoc ICollectorSwapper
    /// @dev This is a convenience function to quickly verify if a token can be swapped.
    ///      Returns false if the token has not been configured or has been disabled.
    function isTokenEnabled(address token) external view returns (bool enabled) {
        return tokenConfig[token].enabled;
    }
}