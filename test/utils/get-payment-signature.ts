import { AddressLike, BytesLike, Signature, Signer } from "ethers";
import { IERC20, TokenPaymaster } from "../../typechain-types";
import { getCurrentTimestamp } from ".";
import { SIGNATURE_VALIDITY } from "../constants";
import { network } from "hardhat";

export async function getPaymentSignature(
  paymasterContract: TokenPaymaster,
  token: IERC20,
  tokenPriceWei: bigint,
  user: AddressLike,
  userOpHash: BytesLike,
  operator: Signer,
) {
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
      { name: "userOpHash", type: "bytes32" },
      { name: "operator", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  const value = {
    token,
    tokenPriceWei,
    user,
    userOpHash,
    operator,
    nonce,
    deadline,
  };

  const signature = await operator.signTypedData(domain, types, value);
  const { v, r, s } = Signature.from(signature);

  return { nonce, deadline, v, r, s };
}
