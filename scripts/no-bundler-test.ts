import "dotenv/config";
import {
  Address,
  createPublicClient,
  decodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  Hex,
  http,
  maxUint256,
  parseAbiParameters,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createBundlerClient,
  createPaymasterClient,
  toSimple7702SmartAccount,
} from "viem/account-abstraction";
import { mainnet, sepolia } from "viem/chains";
import { createPimlicoClient } from "permissionless/clients/pimlico";

const privateKey = `0x${process.env.DEPLOYER_PRIVATE_KEY}`;

const eoa7702 = privateKeyToAccount(privateKey as Address);
const chain = mainnet;

const rpcUrl = `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
const pimlicoUrl = `https://api.pimlico.io/v2/${chain.id}/rpc?apikey=${process.env.PIMLICO_API_KEY}`;
const customPaymasterUrl = `http://127.0.0.1:3000/paymaster/rpc?apikey=${process.env.PAYMASTER_API_KEY}`;

const client = createPublicClient({
  chain,
  transport: http(rpcUrl),
});

const paymasterClient = createPaymasterClient({
  transport: http(customPaymasterUrl),
});

const bundlerClient = createBundlerClient({
  client,
  transport: http(pimlicoUrl),
});

const pimlicoClient = createPimlicoClient({
  transport: http(pimlicoUrl),
  chain,
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

const abiParams = parseAbiParameters([
  "address token",
  "uint256 tokenPriceWei",
  "uint256 nonce",
  "uint256 deadline",
  "uint8 v",
  "bytes32 r",
  "bytes32 s",
]);

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

  const callData = encodeFunctionData({
    abi: account.abi,
    functionName: "execute",
    args: [approveUsdcCall.to, approveUsdcCall.value, approveUsdcCall.data],
  });

  const {
    standard: { maxFeePerGas, maxPriorityFeePerGas },
  } = await pimlicoClient.getUserOperationGasPrice();

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

  const { paymaster, paymasterData, paymasterPostOpGasLimit, paymasterVerificationGasLimit } =
    getPaymasterStubDataRes;

  const userOp = {
    sender: account.address,
    nonce: smartAccountNonce,
    callData,
    callGasLimit: 80_000n,
    verificationGasLimit: 150_000n,
    preVerificationGas: 50_000n,
    maxFeePerGas,
    maxPriorityFeePerGas,
    paymaster,
    paymasterVerificationGasLimit,
    paymasterPostOpGasLimit,
    paymasterData,
    signature: "0x" as Hex,
    context: { token: usdcAddress },
    chainId: chain.id,
    entryPointAddress,
  };

  const getPaymasterDataRes = await paymasterClient.getPaymasterData(userOp);
  console.log("getPaymasterDataRes", getPaymasterDataRes);

  const signature = await account.signUserOperation(userOp);

  console.log("signature", signature);

  const txHash = await bundlerClient.sendUserOperation({
    ...userOp,
    signature,
  });
  console.log("UserOperation hash:", txHash);
}

main();
