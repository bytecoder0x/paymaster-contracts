import { Signature, keccak256 } from "ethers";
import { TokenPaymaster } from "../../typechain-types";
import { getCurrentTimestamp } from ".";
import { SIGNATURE_VALIDITY } from "../constants";
import { network } from "hardhat";
import { PaymasterPaymentDataStruct } from "../types";

export async function getPaymentSignature(
  paymasterContract: TokenPaymaster,
  paymentStruct: PaymasterPaymentDataStruct,
  userOpCallData: string, // Full userOp.callData to be signed
  user: string, // user address (from userOp.sender)
) {
  const { token, exchangeRate, postOpCost, operator } = paymentStruct;

  // Get current nonce for operator-user pair
  const operatorAddress = typeof operator === "string" ? operator : operator.address;
  const [nonce, currentTimestamp, verifyingContract] = await Promise.all([
    paymasterContract.operatorUserNonces(operatorAddress, user),
    getCurrentTimestamp(),
    paymasterContract.getAddress(),
  ]);

  // Use provided deadline if available, otherwise use default
  const deadline = paymentStruct.deadline || currentTimestamp + SIGNATURE_VALIDITY;

  // Hash the userOp.callData that will be allowed
  const callDataHash = keccak256(userOpCallData);

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
      { name: "callDataHash", type: "bytes32" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  const value = {
    token: token.target.toString(),
    exchangeRate,
    postOpCost,
    user,
    callDataHash,
    nonce,
    deadline,
  };

  const signatureString = await operator.signTypedData(domain, types, value);
  const { v, r, s } = Signature.from(signatureString);

  return { nonce, deadline, v, r, s };
}
