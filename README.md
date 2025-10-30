# paymaster-contracts

## Overview

This repository contains Solidity smart contracts of an ERC-4337 paymaster. User pays for gas of the user operation with ERC20 token instead of native coin, the token price is signed off-chain by the operator. Collected tokens can be swapped to one canonical token (for example USDC) through Uniswap V3.

## Smart Contracts

1. **TokenPaymaster**: Paymaster which works with a whitelist of EntryPoint addresses (v0.7 and v0.8 in tests and deploy config). `validatePaymasterUserOp` checks the EIP-712 signature of the operator (token, exchange rate, postOp cost, nonce, deadline, hash of call data and opaque part) and does not take tokens. `postOp` calculates the token amount from the actual gas cost with rounding up and transfers it from the user, so the user needs allowance for the paymaster or approve inside the same user operation. If the amount is zero, the operation is sponsored. Admin can pause the contract and withdraw collected tokens (one token or batch up to 20).
2. **CollectorSwapper**: Called by the paymaster from `postOp` when the swap is enabled and the Uniswap V3 pool of the token with the canonical token exists. It swaps the collected token with `exactInputSingle` and sends the result to the paymaster. Minimum amount out is the quote from `QuoterV2` minus slippage (2% by default), deadline and pool fee come from the opaque part of paymaster data. It works in best-effort mode: if a check or the swap fails, the tokens stay in the paymaster and `SwapFailed` event is emitted.
3. **StakeManager**: Deposit, stake and withdraw of the paymaster in EntryPoint and the whitelist of supported EntryPoint addresses.
4. **EIP712Service**: Validation of the operator signature and deadline, nonce for each operator-user pair, `OPERATOR_ROLE`.
5. **StorageCollectorSwapper**: Storage, admin setters (canonical token, router, quoter, factory, paymaster, slippage) and pause of the swapper.
6. **ApproveManager**: Internal helper which approves a token to a spender when the allowance is not enough.
7. **ValidationModifiers**: Modifiers for zero address and zero value checks.

Contracts in `contracts/test/` (`SimpleAccountFactory`, `TestCounter`, `MockERC20`) are only for tests.

## Technologies Used

- **Solidity**: 0.8.28 with optimizer and `viaIR`.
- **Hardhat**: compile, tests on mainnet fork and deploy with Hardhat Ignition, TypeScript and ethers v6.
- **Account Abstraction Contracts**: `IPaymaster`, `IEntryPoint` and `UserOperationLib` from `@account-abstraction/contracts`.
- **OpenZeppelin Contracts**: `AccessControl`, `Pausable`, `EIP712`, `ECDSA`, `SafeERC20`.
- **Uniswap V3**: `ISwapRouter`, `IQuoterV2` and `IUniswapV3Factory` for the swap of collected tokens.
- **viem, permissionless**: scripts in `scripts/` which send user operations through a bundler.

## Running the Project

1. Install dependencies using `yarn install` (Yarn 4.6.0).
2. Create `.env` from `.env.example`:
   - `ALCHEMY_API_KEY`: RPC for the mainnet fork in tests and for `mainnet`, `polygon`, `sepolia` networks.
   - `DEPLOYER_PRIVATE_KEY`, `TEST_PRIVATE_KEY`: accounts for the networks in `hardhat.config.ts`. They must be set even for compile and tests (any 32 bytes hex is enough), in other case Hardhat fails on the config.
   - `KATANA_API_KEY`: RPC for `katana` network.
   - `ACCOUNT_PK`, `PIMLICO_API_KEY`, `PAYMASTER_API_KEY`, `GATEWAY_API_KEY`: only for scripts in `scripts/`.
3. Compile the contracts using `yarn compile`.
4. Run tests using `yarn test`. Tests run on the fork of Ethereum mainnet at block 22774486, so the RPC must have archive data.
5. Scripts in `scripts/` work with live networks and are not needed for tests. To run them you need your own bundler and paymaster API, URLs and paymaster addresses in the scripts have to be replaced with yours.
