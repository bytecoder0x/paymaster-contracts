import { Signature } from "ethers";
import { TokenPaymaster } from "../../typechain-types";
import { getCurrentTimestamp } from ".";
import { SIGNATURE_VALIDITY } from "../constants";
import { network } from "hardhat";
import { PaymasterPaymentDataStruct } from "../types";

export async function getPaymentSignature(
  paymasterContract: TokenPaymaster,
  paymentStruct: PaymasterPaymentDataStruct,
) {
  const { token, tokenPriceWei, user, operator } = paymentStruct;
  const [nonce, currentTimestamp, verifyingContract] = await Promise.all([
    paymasterContract.operatorUserNonces(operator, user),
    getCurrentTimestamp(),
    paymasterContract.getAddress(),
  ]);
  const deadline = currentTimestamp + SIGNATURE_VALIDITY;

  const domain = {
    name: "TokenPaymaster",
    version: "1",
    chainId: network.config.chainId,
    verifyingContract,
  };

  const types = {
    PaymasterPaymentData: [
      { name: "token", type: "address" },
      { name: "tokenPriceWei", type: "uint256" },
      { name: "user", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  const value = {
    token: token.target.toString(),
    tokenPriceWei,
    user,
    nonce,
    deadline,
  };

  const signature = await operator.signTypedData(domain, types, value);
  const { v, r, s } = Signature.from(signature);

  return { nonce, deadline, v, r, s };
}
