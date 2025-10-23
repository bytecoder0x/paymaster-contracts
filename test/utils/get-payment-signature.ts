import { Signature, keccak256 } from "ethers";
import { TokenPaymaster } from "../../typechain-types";
import { getCurrentTimestamp } from ".";
import { SIGNATURE_VALIDITY, ZERO_BYTES } from "../constants";
import { network } from "hardhat";
import { PaymasterPaymentDataStruct } from "../types";

export async function getPaymentSignature(
  paymasterContract: TokenPaymaster,
  paymentStruct: PaymasterPaymentDataStruct,
  userOpCallData: string, // Full userOp.callData to be signed
  user: string, // user address (from userOp.sender)
) {
  const { token, exchangeRate, postOpCost, operator, opaque = ZERO_BYTES } = paymentStruct;

  // Get current nonce for operator-user pair
  const operatorAddress = typeof operator === "string" ? operator : operator.address;
  const [nonce, currentTimestamp, verifyingContract] = await Promise.all([
    paymasterContract.operatorUserNonces(operatorAddress, user),
    getCurrentTimestamp(),
    paymasterContract.getAddress(),
  ]);

  // Use provided deadline if available, otherwise use default
  const deadline = paymentStruct.deadline || currentTimestamp + SIGNATURE_VALIDITY;

  const domain = {
    name: "TokenPaymaster",
    version: "1",
    chainId: network.config.chainId,
    verifyingContract,
  };

  const types = {
    PaymasterPaymentData: [
      { name: "token", type: "address" },
      { name: "exchangeRate", type: "uint256" },
      { name: "postOpCost", type: "uint256" },
      { name: "user", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "callData", type: "bytes" },
      { name: "opaque", type: "bytes" },
    ],
  };

  const value = {
    token: token.target.toString(),
    exchangeRate,
    postOpCost,
    user,
    nonce,
    deadline,
    callData: userOpCallData,
    opaque,
  };

  const signatureString = await operator.signTypedData(domain, types, value);
  const { v, r, s } = Signature.from(signatureString);

  return { nonce, deadline, v, r, s };
}
