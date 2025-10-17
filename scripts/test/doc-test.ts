import {
  Address,
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  http,
  maxUint256,
  parseUnits,
} from "viem";
import {
  createBundlerClient,
  createPaymasterClient,
  entryPoint07Address,
} from "viem/account-abstraction";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { Implementation, toMetaMaskSmartAccount } from "@metamask/delegation-toolkit";
import "dotenv/config";

async function main() {
  // 1. CONFIGURATION
  const privateKey = `0x${process.env.ACCOUNT_PK}`;
  if (!process.env.ACCOUNT_PK) throw new Error("ACCOUNT_PK not found in .env");

  const chain = mainnet;
  const rpcUrl = `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
  const bundlerUrl = `https://gateway.example.com/bundler/${chain.id}/rpc?apikey=${process.env.GATEWAY_API_KEY}`;
  const paymasterUrl = `https://gateway.example.com/paymaster/${chain.id}/rpc?apikey=${process.env.GATEWAY_API_KEY}`;

  const paymasterAddress = "0x0000000000000000000000000000000000000000" as Address; // Paymaster (EntryPoint v0.7)
  const usdcAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address; // USDC

  // 2. INITIALIZE CLIENTS
  const client = createPublicClient({
    chain: mainnet,
    transport: http(rpcUrl),
  });

  const bundlerClient = createBundlerClient({
    client,
    transport: http(bundlerUrl),
  });

  const paymasterClient = createPaymasterClient({
    transport: http(paymasterUrl),
  });

  // 3. SETUP SMART ACCOUNT
  const eoaOwner = privateKeyToAccount(privateKey as Address);
  const account = await toMetaMaskSmartAccount({
    client,
    implementation: Implementation.Stateless7702,
    address: eoaOwner.address,
    signatory: { account: eoaOwner },
  });
  console.log("Smart Account address:", await account.getAddress());

  // 4. SIGN AUTHORIZATION FOR ACCOUNT DEPLOYMENT (if needed)
  const eoaCode = await client.getCode({ address: eoaOwner.address });
  const authorization = !eoaCode
    ? await eoaOwner.signAuthorization({
        address: "0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B",
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

  const callData = await account.encodeCalls([
    { to: approveUsdcCall.target, value: approveUsdcCall.value, data: approveUsdcCall.data },
    { to: mainCall.target, value: mainCall.value, data: mainCall.data },
  ]);

  // 6. FETCH STUB DATA FROM PAYMASTER
  const smartAccountNonce = await account.getNonce();
  let maxFeePerGas = await client.getGasPrice();
  maxFeePerGas = (maxFeePerGas * 105n) / 100n; // Add 30% for reliability
  let maxPriorityFeePerGas = await client.estimateMaxPriorityFeePerGas();
  //   maxPriorityFeePerGas = maxPriorityFeePerGas * 2n; // Double for reliability

  const getPaymasterStubDataRes = await paymasterClient.getPaymasterStubData({
    callData,
    maxFeePerGas,
    maxPriorityFeePerGas,
    nonce: smartAccountNonce,
    sender: account.address,
    entryPointAddress: entryPoint07Address,
    chainId: mainnet.id,
    context: { token: usdcAddress },
  });

  const { paymaster, paymasterData } = getPaymasterStubDataRes;
  console.log("Received stub data from Paymaster:");
  console.log("paymasterData", paymasterData);

  // 7. ESTIMATE GAS
  const { callGasLimit, preVerificationGas, verificationGasLimit } =
    await bundlerClient.estimateUserOperationGas({
      callData,
      authorization,
      account,
      nonce: smartAccountNonce,
      entryPointAddress: entryPoint07Address,
      paymaster,
      paymasterData,
    });

  console.log("Gas estimation from bundler:");
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
    entryPointAddress: entryPoint07Address,
    context: { token: usdcAddress },
  };

  const { paymasterVerificationGasLimit, paymasterPostOpGasLimit } =
    await paymasterClient.getPaymasterData(userOp);

  console.log("Received data from Paymaster:");
  console.log("paymasterPostOpGasLimit", paymasterPostOpGasLimit);
  console.log("paymasterVerificationGasLimit", paymasterVerificationGasLimit);

  // 9. SEND USER OPERATION
  const txHash = await bundlerClient.sendUserOperation({
    callData,
    authorization,
    account,
    nonce: smartAccountNonce,
    entryPointAddress: entryPoint07Address,
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
