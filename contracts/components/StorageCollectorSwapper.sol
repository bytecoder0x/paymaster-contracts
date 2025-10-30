// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ZeroAddress} from "../errors/PaymasterErrors.sol";
import {Unauthorized, InvalidSlippage} from "../errors/CollectorSwapperErrors.sol";
import {ICollectorSwapper} from "../interfaces/ICollectorSwapper.sol";

abstract contract StorageCollectorSwapper is ICollectorSwapper, AccessControl, Pausable {
    using SafeERC20 for IERC20;

    /// @notice The basis points for correct slippage calculation
    uint256 public constant MAX_BIPS = 100_00;

    /// @notice The default slippage in basis points
    uint256 public slippageBps = 2_00; // 2%

    /// @notice The canonical token address that all collected tokens are swapped to (e.g., USDC)
    address public canonicalToken;

    /// @notice The Uniswap V3 SwapRouter address used for token swaps
    address public router;

    /// @notice The Uniswap V3 Quoter address used to compute real-time quotes
    address public quoter;

    /// @notice The Uniswap V3 Factory address used to discover pools
    address public factory;

    /// @notice The authorized paymaster address that can trigger token swaps
    address public paymaster;

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
    constructor(
        address _paymaster,
        address _canonicalToken,
        address _factory,
        address _router,
        address _quoter,
        address _admin
    ) {
        if (_paymaster == address(0)) revert ZeroAddress();
        if (_canonicalToken == address(0)) revert ZeroAddress();
        if (_factory == address(0)) revert ZeroAddress();
        if (_router == address(0)) revert ZeroAddress();
        if (_quoter == address(0)) revert ZeroAddress();
        if (_admin == address(0)) revert ZeroAddress();

        paymaster = _paymaster;
        canonicalToken = _canonicalToken;
        factory = _factory;
        router = _router;
        quoter = _quoter;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    /// @inheritdoc ICollectorSwapper
    /// @dev Only callable by admin. Used to set the slippage in basis points what is allowed for the swap.
    ///      The slippage must be between 0 and 10_000.
    function setSlippageBps(uint256 slippageBps_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (slippageBps_ == 0 || slippageBps_ > MAX_BIPS) revert InvalidSlippage();
        slippageBps = slippageBps_;
        emit SlippageUpdated(slippageBps_);
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
    /// @dev Only callable by admin. Used to update the Uniswap factory used for pool discovery.
    function setFactory(address factory_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (factory_ == address(0)) revert ZeroAddress();
        factory = factory_;
        emit FactoryUpdated(factory);
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
    /// @dev Only callable by admin. Quoter is used to compute on-chain quotes before swaps.
    function setQuoter(address quoter_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (quoter_ == address(0)) revert ZeroAddress();
        quoter = quoter_;
        emit QuoterUpdated(quoter);
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
}
