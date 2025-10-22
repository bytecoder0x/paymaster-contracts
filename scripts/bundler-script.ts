import "dotenv/config";
import {
  Address,
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  http,
  maxUint256,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createBundlerClient,
  createPaymasterClient,
  entryPoint08Address,
  toSimple7702SmartAccount,
} from "viem/account-abstraction";
import { mainnet } from "viem/chains";

async function main() {
  // 1. CONFIGURATION
  const privateKey = `0x${process.env.ACCOUNT_PK}`;
  if (!privateKey) throw new Error("ACCOUNT_PK not found in .env");

  const chain = mainnet;
  const rpcUrl = `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
  // const bundlerUrl = `https://api.pimlico.io/v2/${chain.id}/rpc?apikey=${process.env.PIMLICO_API_KEY}`;
  const bundlerUrl = `https://bundler.example.com/`;
  const customPaymasterUrl = `https://paymaster.example.com/paymaster/rpc?apikey=${process.env.PAYMASTER_API_KEY}`;

  const paymasterAddress = "0x0000000000000000000000000000000000000000" as Address;
  const usdcAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;

  // 2. INITIALIZE CLIENTS
  const client = createPublicClient({ chain, transport: http(rpcUrl) });
  const bundlerClient = createBundlerClient({ client, transport: http(bundlerUrl) });
  const paymasterClient = createPaymasterClient({ transport: http(customPaymasterUrl) });

  // 3. SETUP SMART ACCOUNT
  const eoaOwner = privateKeyToAccount(privateKey as Address);
  const account = await toSimple7702SmartAccount({ client, owner: eoaOwner });
  console.log("Smart Account address:", await account.getAddress());

  // 4. SIGN AUTHORIZATION FOR ACCOUNT DEPLOYMENT (if needed)
  const eoaCode = await client.getCode({ address: eoaOwner.address });
  const authorization = !eoaCode
    ? await eoaOwner.signAuthorization({
        address: "0xe6Cae83BdE06E4c305530e199D7217f42808555B", // Default ERC-7702 smart-account
        chainId: chain.id,
        nonce: await client.getTransactionCount({ address: eoaOwner.address }),
      })
    : undefined;
  if (authorization) {
    console.log("Authorization signature created for account deployment.");
  }

  // 5. PREPARE CALLDATA (approve + transfer)
  const approveUsdcCall = {
    target: usdcAddress,
    value: 0n,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [paymasterAddress, maxUint256],
    }),
  };
  const mainCall = {
    target: usdcAddress,
    value: 0n,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [eoaOwner.address, parseUnits("1", 6)],
    }),
  };
  const callData = encodeFunctionData({
    abi: account.abi,
    functionName: "executeBatch",
    args: [[approveUsdcCall, mainCall]],
  });

  // 6. FETCH STUB DATA FROM PAYMASTER
  const smartAccountNonce = await account.getNonce();
  let maxFeePerGas = await client.getGasPrice();
  maxFeePerGas = (maxFeePerGas * 130n) / 100n; // Add 30% for reliability
  let maxPriorityFeePerGas = await client.estimateMaxPriorityFeePerGas();
  maxPriorityFeePerGas = 50000000n; // Double for reliability

  const { paymaster, paymasterData } = await paymasterClient.getPaymasterStubData({
    callData,
    maxFeePerGas,
    maxPriorityFeePerGas,
    nonce: smartAccountNonce,
    sender: account.address,
    entryPointAddress: entryPoint08Address,
    chainId: chain.id,
    context: { token: usdcAddress },
  });
  console.log("Received stub data from Paymaster:");
  console.log("paymaster", paymaster);
  console.log("paymasterData", paymasterData);

  // 7. ESTIMATE GAS
  const { callGasLimit, preVerificationGas, verificationGasLimit } =
    await bundlerClient.estimateUserOperationGas({
      callData,
      authorization,
      account,
      nonce: smartAccountNonce,
      entryPointAddress: entryPoint08Address,
      paymaster,
      paymasterData,
    });
  console.log("Gas estimated successfully:");
  console.log("callGasLimit", callGasLimit);
  console.log("preVerificationGas", preVerificationGas);
  console.log("verificationGasLimit", verificationGasLimit);

  // 8. FETCH DATA FROM PAYMASTER

  const userOp = {
    sender: account.address,
    nonce: smartAccountNonce,
    callData,
    callGasLimit,
    verificationGasLimit,
    preVerificationGas,
    maxFeePerGas,
    maxPriorityFeePerGas,
    paymaster,
    paymasterData,
    chainId: mainnet.id,
    entryPointAddress: entryPoint08Address,
    context: { token: usdcAddress },
  };

  const { paymasterVerificationGasLimit, paymasterPostOpGasLimit } =
    await paymasterClient.getPaymasterData(userOp);

  console.log("Received data from Paymaster:");
  console.log("paymasterPostOpGasLimit", paymasterPostOpGasLimit);
  console.log("paymasterVerificationGasLimit", paymasterVerificationGasLimit);
  // return;

  // 9. SEND USER OPERATION
  const txHash = await bundlerClient.sendUserOperation({
    callData,
    authorization,
    account,
    nonce: smartAccountNonce,
    entryPointAddress: entryPoint08Address,
    maxFeePerGas,
    maxPriorityFeePerGas,
    paymaster,
    paymasterData,
    paymasterVerificationGasLimit,
    paymasterPostOpGasLimit,
    callGasLimit,
    preVerificationGas,
    verificationGasLimit,
  });
  console.log("UserOperation hash sent:", txHash);
}

main().catch(console.error);
