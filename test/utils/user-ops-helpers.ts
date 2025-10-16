import { AbiCoder, BytesLike, getBytes, HDNodeWallet, solidityPacked } from "ethers";
import { IPaymaster, SimpleAccount } from "../../typechain-types";
import { PackedUserOperationStruct } from "../../typechain-types/contracts/TokenPaymaster";
import { FeePerGas, GasLimits, PaymasterPaymentDataStructSigned } from "../types";
import { IEntryPoint } from "../../typechain-types";
import { Uint256 } from "../../types";

export async function getUserOp(
  entryPoint: IEntryPoint,
  paymaster: IPaymaster,
  signer: HDNodeWallet,
  sender: SimpleAccount,
  to: string,
  value: bigint,
  data: BytesLike,
  paymentStructSigned?: PaymasterPaymentDataStructSigned,
  gasLimits?: GasLimits,
  feesPerGas?: FeePerGas,
): Promise<PackedUserOperationStruct> {
  if (!gasLimits) gasLimits = new GasLimits();
  if (!feesPerGas) feesPerGas = new FeePerGas();
  const { call, verification, paymasterVerification, paymasterPostOp, preVerification } = gasLimits;
  const { maxPriorityFeePerGas, maxFeePerGas } = feesPerGas;

  const callData = sender.interface.encodeFunctionData("execute", [to, value, data]);
  const accountGasLimits = solidityPacked(["uint128", "uint128"], [call, verification]);
  const gasFees = solidityPacked(["uint128", "uint128"], [maxPriorityFeePerGas, maxFeePerGas]);
  const paymasterAndData = paymentStructSigned
    ? encodePaymasterAndData(paymaster, paymentStructSigned, paymasterVerification, paymasterPostOp)
    : solidityPacked(
        ["address", "uint128", "uint128"],
        [paymaster.target.toString(), paymasterVerification, paymasterPostOp],
      );

  const userOp = {
    sender,
    nonce: await entryPoint.getNonce(sender, 0),
    initCode: "0x",
    callData,
    accountGasLimits,
    preVerificationGas: preVerification,
    gasFees,
    paymasterAndData,
    signature: "0x",
  };

  const userOpHash = await entryPoint.getUserOpHash(userOp);
  const signature = signer.signingKey.sign(getBytes(userOpHash));

  return { ...userOp, signature: signature.serialized };
}

function encodePaymasterAndData(
  paymaster: IPaymaster,
  data: PaymasterPaymentDataStructSigned,
  paymasterVerificationGas: Uint256,
  paymasterPostOpGas: Uint256,
): string {
  const { token, exchangeRate, postOpCost, nonce, deadline, v, r, s } = data;

  // Temporarily use original uint256 encoding to debug signature issue
  const encodedStruct = AbiCoder.defaultAbiCoder().encode(
    [
      "address", // token
      "uint256", // exchangeRate (back to uint256 for debugging)
      "uint256", // postOpCost (back to uint256 for debugging)
      "uint256", // nonce (back to uint256 for debugging)
      "uint256", // deadline (back to uint256 for debugging)
      "uint8", // v
      "bytes32", // r
      "bytes32", // s
    ],
    [token.target.toString(), exchangeRate, postOpCost, nonce, deadline, v, r, s],
  );

  return solidityPacked(
    ["address", "uint128", "uint128", "bytes"],
    [paymaster.target.toString(), paymasterVerificationGas, paymasterPostOpGas, encodedStruct],
  );
}
