import { createPimlicoClient } from "permissionless/clients/pimlico";
import {
  createPublicClient,
  http,
  encodeFunctionData,
  erc20Abi,
  maxUint256,
  Hex,
  Address,
  encodeAbiParameters,
  defineChain,
  parseUnits,
} from "viem";
import {
  createBundlerClient,
  createPaymasterClient,
  toSimple7702SmartAccount,
} from "viem/account-abstraction";
import { Implementation, toMetaMaskSmartAccount } from "@metamask/delegation-toolkit";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, polygon } from "viem/chains";

const privateKey = `0x${process.env.ACCOUNT_PK}`;
const eoa7702 = privateKeyToAccount(privateKey as Address);

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
const chain = katana;

// const rpcUrl = `https://polygon-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
const rpcUrl = `https://rpc-katana.t.conduit.xyz/${process.env.KATANA_API_KEY}`;
const bundlerUrl = `http://0.0.0.0:3000`;
// const bundlerUrl = `https://gateway.example.com/bundler/${chain.id}/rpc?apikey=${process.env.PAYMASTER_API_KEY}`;
// const customPaymasterUrl = `https://gateway.example.com/paymaster/${chain.id}/rpc?apikey=${process.env.PAYMASTER_API_KEY}`;
const customPaymasterUrl = `http://0.0.0.0:3001/paymaster/rpc`;

const client = createPublicClient({
  chain,
  transport: http(rpcUrl),
});

const bundlerClient = createBundlerClient({
  client,
  transport: http(bundlerUrl),
});

const paymasterClient = createPaymasterClient({
  transport: http(customPaymasterUrl),
});

const ENTRY_POINT_V7 = "0x0000000071727de22e5e9d8baf0edac6f37da032";
const ENTRY_POINT_V8 = "0x4337084d9e255ff0702461cf8895ce9e3b5ff108";

const PAYMASTER_ADDRESS: Record<number, Address> = {
  [mainnet.id]: "0x0000000000000000000000000000000000000000",
  [katana.id]: "0x0000000000000000000000000000000000000000",
  [polygon.id]: "0x0000000000000000000000000000000000000000",
};

const METAMASK_SMART_ACCOUNT = "0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B";
const SIMPLE_SMART_ACCOUNT = "0xe6Cae83BdE06E4c305530e199D7217f42808555B";

const entryPointAddress = ENTRY_POINT_V8 as Address;
const paymasterAddress = PAYMASTER_ADDRESS[chain.id] as Address;

// Katana
const tokenAddress = "0x203A662b0BD271A6ed5a60EdFbd04bFce608FD36" as Address; // usdc

// Polygon
// const tokenAddress = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F" as Address; // usdt
// const tokenAddress = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" as Address; // usdc

const transferCall = {
  to: tokenAddress as Address,
  value: 0n,
  data: encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [eoa7702.address, parseUnits("0.1", 6)],
  }) as Hex,
};

const approveCall = {
  to: tokenAddress,
  value: 0n,
  data: encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [paymasterAddress, maxUint256],
  }) as Hex,
};

async function main() {
  const account = await toSimple7702SmartAccount({
    client,
    owner: eoa7702,
  });
  console.log("account", await account.getAddress());

  // const account = await toMetaMaskSmartAccount({
  //   client,
  //   implementation: Implementation.Stateless7702,
  //   address: eoa7702.address,
  //   signatory: { account: eoa7702 },
  // });
  // console.log("account", await account.getAddress());

  const smartAccountNonce = await account.getNonce();
  const eoaCode = await client.getCode({
    address: eoa7702.address,
  });
  console.log("eoaCode", eoaCode);

  const authorization =
    eoaCode !== SIMPLE_SMART_ACCOUNT.toLowerCase()
      ? await eoa7702.signAuthorization({
          address: SIMPLE_SMART_ACCOUNT,
          chainId: chain.id,
          nonce: await client.getTransactionCount({
            address: eoa7702.address,
          }),
        })
      : undefined;
  console.log("authorization", authorization);

  const callData = await account.encodeCalls([approveCall, transferCall]);
  const maxPriorityFeePerGas = await client.estimateMaxPriorityFeePerGas();
  const maxFeePerGas = ((await client.getGasPrice()) * 130n) / 100n;

  const getPaymasterDataRes = await paymasterClient.getPaymasterData({
    callData,
    maxFeePerGas,
    maxPriorityFeePerGas,
    nonce: smartAccountNonce,
    sender: account.address,
    entryPointAddress,
    chainId: chain.id,
    context: { token: tokenAddress },
  });

  const { paymaster, paymasterData, paymasterVerificationGasLimit, paymasterPostOpGasLimit } =
    getPaymasterDataRes;

  const estimateGasRes = await bundlerClient.estimateUserOperationGas({
    callData,
    authorization,
    account,
    nonce: smartAccountNonce,
    entryPointAddress,
    paymaster,
    paymasterData,
    paymasterVerificationGasLimit,
    paymasterPostOpGasLimit,
  });

  const { callGasLimit, preVerificationGas, verificationGasLimit } = estimateGasRes;

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
    paymasterVerificationGasLimit,
    paymasterPostOpGasLimit,
    chainId: chain.id,
    entryPointAddress,
    context: { token: tokenAddress },
  };

  console.log("Gas Parameters:", {
    callGasLimit,
    preVerificationGas,
    verificationGasLimit,
    paymasterVerificationGasLimit,
    paymasterPostOpGasLimit,
  });

  const txHash = await bundlerClient.sendUserOperation({
    account,
    ...userOp,
    authorization,
  });
  console.log("UserOperation hash:", txHash);
}

main();
