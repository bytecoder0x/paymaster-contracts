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
} from "viem";
import {
  createBundlerClient,
  createPaymasterClient,
  toSimple7702SmartAccount,
} from "viem/account-abstraction";
import { Implementation, toMetaMaskSmartAccount } from "@metamask/delegation-toolkit";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import { TestCounter__factory } from "../../typechain-types";

const privateKey = `0x${process.env.TEST_PRIVATE_KEY}`;

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

// const rpcUrl = `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
const rpcUrl = `https://rpc-katana.t.conduit.xyz/${process.env.KATANA_API_KEY}`;
// const bundlerUrl = `http://0.0.0.0:3000`;
const bundlerUrl = `https://gateway.example.com/bundler/${chain.id}/rpc?apikey=${process.env.PAYMASTER_API_KEY}`;
const customPaymasterUrl = `https://gateway.example.com/paymaster/${chain.id}/rpc?apikey=${process.env.PAYMASTER_API_KEY}`;
// const customPaymasterUrl = `http://0.0.0.0:3001/paymaster/rpc?apikey=${process.env.PAYMASTER_API_KEY}`;

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

const PAYMASTER_ADDRESS: Record<number, Record<string, Address>> = {
  [mainnet.id]: {
    [ENTRY_POINT_V7]: "0x0000000000000000000000000000000000000000",
    [ENTRY_POINT_V8]: "0x0000000000000000000000000000000000000000",
  },
  [katana.id]: {
    [ENTRY_POINT_V7]: "0x0000000000000000000000000000000000000000",
    [ENTRY_POINT_V8]: "0x0000000000000000000000000000000000000000",
  },
};

const entryPointAddress = ENTRY_POINT_V8 as Address;
const paymasterAddress = PAYMASTER_ADDRESS[chain.id][entryPointAddress] as Address;
const tokenAddress = "0x203A662b0BD271A6ed5a60EdFbd04bFce608FD36" as Address;

const approveCall = {
  to: "0x0000000000000000000000000000000000000000" as Address,
  value: 0n,
  data: encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [paymasterAddress, maxUint256],
  }) as Hex,
};

const approveCallPaymentToken = {
  to: tokenAddress,
  value: 0n,
  data: encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [paymasterAddress, maxUint256],
  }) as Hex,
};

// const incCall = {
//   to: "0x0000000000000000000000000000000000000000" as Address,
//   value: 0n,
//   data: encodeFunctionData({
//     abi: TestCounter__factory.abi,
//     functionName: "count",
//   }) as Hex,
// };

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

  const smartAccountNonce = await account.getNonce();
  // console.log("smartAccountNonce", smartAccountNonce);

  const eoaCode = await client.getCode({
    address: eoa7702.address,
  });
  console.log("eoaCode", eoaCode);

  const authorization =
    eoaCode !== "0xe6Cae83BdE06E4c305530e199D7217f42808555B".toLowerCase()
      ? await eoa7702.signAuthorization({
          address: "0xe6Cae83BdE06E4c305530e199D7217f42808555B",
          chainId: chain.id,
          nonce: await client.getTransactionCount({
            address: eoa7702.address,
          }),
        })
      : undefined;
  console.log("authorization", authorization);

  const callData = await account.encodeCalls([
    // {
    //   to: approveCallPaymentToken.to,
    //   value: approveCallPaymentToken.value,
    //   data: approveCallPaymentToken.data,
    // },
    { to: approveCall.to, value: approveCall.value, data: approveCall.data },
  ]);

  // console.log(callData);

  // network gas - alternative to pimlico
  const maxPriorityFeePerGas = await client.estimateMaxPriorityFeePerGas();
  console.log("maxPriorityFeePerGas", maxPriorityFeePerGas);
  const maxFeePerGas = ((await client.getGasPrice()) * 130n) / 100n;
  console.log("maxFeePerGas", maxFeePerGas);

  const getPaymasterStubDataRes = await paymasterClient.getPaymasterStubData({
    callData,
    maxFeePerGas,
    maxPriorityFeePerGas,
    nonce: smartAccountNonce,
    sender: account.address,
    entryPointAddress,
    chainId: chain.id,
    context: { token: tokenAddress },
  });
  console.log("getPaymasterStubDataRes", getPaymasterStubDataRes);

  const { paymaster, paymasterData } = getPaymasterStubDataRes;

  const estimateGasRes = await bundlerClient.estimateUserOperationGas({
    callData,
    authorization,
    account,
    nonce: smartAccountNonce,
    entryPointAddress,
    paymaster,
    paymasterData,
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
    chainId: chain.id,
    entryPointAddress,
    context: { token: tokenAddress },
  };

  console.log(userOp);

  const { paymasterVerificationGasLimit, paymasterPostOpGasLimit } =
    await paymasterClient.getPaymasterData(userOp);

  console.log("callGasLimit", callGasLimit);
  console.log("preVerificationGas", preVerificationGas);
  console.log("verificationGasLimit", verificationGasLimit);
  console.log("paymasterPostOpGasLimit", paymasterPostOpGasLimit);
  console.log("paymasterVerificationGasLimit", paymasterVerificationGasLimit);

  const txHash = await bundlerClient.sendUserOperation({
    account,
    nonce: smartAccountNonce,
    callData,
    callGasLimit,
    verificationGasLimit,
    preVerificationGas,
    maxFeePerGas,
    maxPriorityFeePerGas,
    paymaster,
    paymasterData,
    entryPointAddress,
    paymasterVerificationGasLimit,
    paymasterPostOpGasLimit,
    authorization,
  });
  console.log("UserOperation hash:", txHash);
}

main();
