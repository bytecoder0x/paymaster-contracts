import { Signature, keccak256 } from "ethers";
import { TokenPaymaster } from "../../typechain-types";
import { getCurrentTimestamp } from ".";
import { SIGNATURE_VALIDITY } from "../constants";
import { network } from "hardhat";
import { PaymasterPaymentDataStruct } from "../types";

export async function getPaymentSignature(
  paymasterContract: TokenPaymaster,
  paymentStruct: PaymasterPaymentDataStruct,
  callData: string,  // callData to be signed
  user: string       // user address (from userOp.sender)
) {
  const { token, tokenPriceWei, operator } = paymentStruct;
  
  // Get current nonce for operator-user pair
  const operatorAddress = typeof operator === 'string' ? operator : operator.address;
  const [currentNonce, currentTimestamp, verifyingContract] = await Promise.all([
    paymasterContract.operatorUserNonces(operatorAddress, user),
    getCurrentTimestamp(),
    paymasterContract.getAddress(),
  ]);
  const deadline = currentTimestamp + SIGNATURE_VALIDITY;

  // Hash the callData that will be allowed
  const callDataHash = keccak256(callData);

  const domain = {
    name: "TokenPaymaster",
    version: "1",
    chainId: network.config.chainId || 31337,
    verifyingContract,
  };

  console.log("EIP712 Domain:", domain);

  const types = {
    PaymasterPaymentData: [
      { name: "token", type: "address" },
      { name: "tokenPriceWei", type: "uint256" },
      { name: "user", type: "address" },
      { name: "callDataHash", type: "bytes32" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  const value = {
    token: token.target.toString(),
    tokenPriceWei,
    user,
    callDataHash,
    nonce: currentNonce,
    deadline,
  };

  console.log("EIP712 Value:", value);
  
  const signatureString = await operator.signTypedData(domain, types, value);
  const { v, r, s } = Signature.from(signatureString);

  console.log("Generated signature components - v:", v, "r:", r, "s:", s);
  console.log("Using nonce:", currentNonce);
  
  return { nonce: currentNonce, deadline, v, r, s };
}
