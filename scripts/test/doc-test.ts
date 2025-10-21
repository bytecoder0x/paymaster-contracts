import {
  Address,
  createPublicClient,
  defineChain,
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
import { mainnet, polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { Implementation, toMetaMaskSmartAccount } from "@metamask/delegation-toolkit";
import "dotenv/config";

const katana = defineChain({
  id: 747474,
  name: "Katana",
  nativeCurrency: {
    decimals: 18,
    name: "Ether",
    symbol: "ETH",
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.katana.network"],
      webSocket: ["wss://rpc.katana.network"],
    },
  },
  blockExplorers: {
    default: { name: "Katana Explorer", url: "https://katanascan.com/" },
  },
});

async function main() {
  // 1. CONFIGURATION
  const privateKey = `0x${process.env.ACCOUNT_PK}`;
  if (!process.env.ACCOUNT_PK) throw new Error("ACCOUNT_PK not found in .env");

  const chain = polygon;
  const rpcUrl = `https://polygon-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
  // const bundlerUrl = `https://gateway.example.com/bundler/${chain.id}/rpc?apikey=${process.env.GATEWAY_API_KEY}`;
  // const paymasterUrl = `https://gateway.example.com/paymaster/${chain.id}/rpc?apikey=${process.env.GATEWAY_API_KEY}`;
  const bundlerUrl = `http://localhost:3000`;
  const paymasterUrl = `http://localhost:3001/paymaster/rpc`;

  const paymasterAddress = "0x0000000000000000000000000000000000000000" as Address; // Paymaster (EntryPoint v0.7)
  const usdcAddress = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" as Address; // USDC

  // 2. INITIALIZE CLIENTS
  const client = createPublicClient({ chain, transport: http(rpcUrl) });
  const bundlerClient = createBundlerClient({ client, transport: http(bundlerUrl) });
  const paymasterClient = createPaymasterClient({ transport: http(paymasterUrl) });

  // 3. SETUP SMART ACCOUNT
  const eoaOwner = privateKeyToAccount(privateKey as Address);
  const account = await toMetaMaskSmartAccount({
    client,
    implementation: Implementation.Stateless7702,
    address: eoaOwner.address,
    signatory: { account: eoaOwner },
  });
  console.log("Smart Account address:", await account.getAddress());

  // 4. SIGN AUTHORIZATION (if needed)
  const [eoaCode, nonce] = await Promise.all([
    client.getCode({ address: eoaOwner.address }),
    client.getTransactionCount({ address: eoaOwner.address }),
  ]);

  const authorization =
    eoaCode === "0x"
      ? await eoaOwner.signAuthorization({
          address: "0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B",
          chainId: chain.id,
          nonce,
        })
      : undefined;

  if (authorization) {
    console.log("Authorization signature created for account deployment.");
  }

  // 5. PREPARE CALLDATA (approve + transfer)
  const approveCall = {
    to: usdcAddress,
    value: 0n,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [paymasterAddress, maxUint256],
    }),
  };

  const transferCall = {
    to: usdcAddress,
    value: 0n,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [eoaOwner.address, parseUnits("0.1", 6)],
    }),
  };

  const callData = await account.encodeCalls([approveCall, transferCall]);

  // 6. FETCH PAYMASTER DATA
  const [smartAccountNonce, gasPrice, priorityFee] = await Promise.all([
    account.getNonce(),
    client.getGasPrice(),
    client.estimateMaxPriorityFeePerGas(),
  ]);

  const maxFeePerGas = (gasPrice * 130n) / 100n;
  const maxPriorityFeePerGas = priorityFee * 2n;

  const { paymaster, paymasterData, paymasterVerificationGasLimit, paymasterPostOpGasLimit } =
    await paymasterClient.getPaymasterData({
      callData,
      maxFeePerGas,
      maxPriorityFeePerGas,
      nonce: smartAccountNonce,
      sender: account.address,
      entryPointAddress: entryPoint07Address,
      chainId: chain.id,
      context: { token: usdcAddress },
    });

  console.log("Received data from Paymaster:", {
    paymasterData,
    paymasterVerificationGasLimit,
    paymasterPostOpGasLimit,
  });

  // 7. ESTIMATE GAS FROM BUNDLER
  const { callGasLimit, preVerificationGas, verificationGasLimit } =
    await bundlerClient.estimateUserOperationGas({
      account,
      nonce: smartAccountNonce,
      callData,
      entryPointAddress: entryPoint07Address,
      authorization,
      paymaster,
      paymasterData,
      paymasterVerificationGasLimit,
      paymasterPostOpGasLimit,
    });

  console.log("Gas estimation from bundler:", {
    callGasLimit,
    preVerificationGas,
    verificationGasLimit,
  });

  // 8. SEND USER OPERATION
  const txHash = await bundlerClient.sendUserOperation({
    account,
    nonce: smartAccountNonce,
    callData,
    maxFeePerGas,
    maxPriorityFeePerGas,
    entryPointAddress: entryPoint07Address,
    paymaster,
    paymasterData,
    paymasterVerificationGasLimit,
    paymasterPostOpGasLimit,
    callGasLimit,
    preVerificationGas,
    verificationGasLimit,
    authorization,
  });

  console.log("UserOperation hash sent:", txHash);
}

main().catch(console.error);
