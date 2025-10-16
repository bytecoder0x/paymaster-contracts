import { Address, createPublicClient, encodeFunctionData, erc20Abi, http, maxUint256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createBundlerClient,
  createPaymasterClient,
  toSimple7702SmartAccount,
} from "viem/account-abstraction";
import { mainnet } from "viem/chains";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import "dotenv/config";

const privateKey = `0x${process.env.TEST_PRIVATE_KEY}`;

const eoa7702 = privateKeyToAccount(privateKey as Address);
const chain = mainnet;

const rpcUrl = `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
const bundlerUrl = `https://api.pimlico.io/v2/${chain.id}/rpc?apikey=${process.env.PIMLICO_API_KEY}`;
const customPaymasterUrl = `https://paymaster.example.com/paymaster/rpc?apikey=${process.env.PAYMASTER_API_KEY}`;

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

const pimlicoClient = createPimlicoClient({
  transport: http(bundlerUrl),
});

const entryPointAddress = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108" as Address;
const paymasterAddress = "0x0000000000000000000000000000000000000000" as Address;
const usdcAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;

const approveUsdcCall = {
  to: usdcAddress,
  value: 0n,
  data: encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [paymasterAddress, maxUint256],
  }) as Address,
};

async function main() {
  const account = await toSimple7702SmartAccount({
    client,
    owner: eoa7702,
  });
  console.log("account", await account.getAddress());

  const smartAccountNonce = await account.getNonce();
  console.log("smartAccountNonce", smartAccountNonce);

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

  const callData = encodeFunctionData({
    abi: account.abi,
    functionName: "execute",
    args: [approveUsdcCall.to, approveUsdcCall.value, approveUsdcCall.data],
  });

  const {
    standard: { maxFeePerGas, maxPriorityFeePerGas },
  } = await pimlicoClient.getUserOperationGasPrice();

  // network gas - alternative to pimlico
  // const maxPriorityFeePerGas = await client.estimateMaxPriorityFeePerGas();
  // const maxPriorityFeePerGas = 50000000n; // pimlico bundler requirements
  // console.log("maxPriorityFeePerGas", maxPriorityFeePerGas);
  // let maxFeePerGas = await client.getGasPrice();
  // maxFeePerGas = (maxFeePerGas * 130n) / 100n;
  // console.log("maxFeePerGas", maxFeePerGas);

  const getPaymasterStubDataRes = await paymasterClient.getPaymasterStubData({
    callData,
    maxFeePerGas,
    maxPriorityFeePerGas,
    nonce: smartAccountNonce,
    sender: account.address,
    entryPointAddress,
    chainId: chain.id,
    context: { token: usdcAddress },
  });
  console.log("getPaymasterStubDataRes", getPaymasterStubDataRes);

  const { paymaster, paymasterData } = getPaymasterStubDataRes;

  const estimateGasRes = await bundlerClient.estimateUserOperationGas({
    callData,
    authorization,
    account,
    nonce: smartAccountNonce,
    entryPointAddress: "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108",
    paymaster,
    paymasterData,
  });
  const {
    callGasLimit,
    preVerificationGas,
    verificationGasLimit,
    paymasterPostOpGasLimit,
    paymasterVerificationGasLimit,
  } = estimateGasRes;
  console.log("callGasLimit", callGasLimit);
  console.log("preVerificationGas", preVerificationGas);
  console.log("verificationGasLimit", verificationGasLimit);
  console.log("paymasterPostOpGasLimit", paymasterPostOpGasLimit);
  console.log("paymasterVerificationGasLimit", paymasterVerificationGasLimit);

  const txHash = await bundlerClient.sendUserOperation({
    callData,
    authorization,
    account,
    nonce: smartAccountNonce,
    entryPointAddress: "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108",
    maxFeePerGas,
    maxPriorityFeePerGas,
    paymaster,
    paymasterData,
    ...estimateGasRes,
  });
  console.log("UserOperation hash:", txHash);
}

main();
