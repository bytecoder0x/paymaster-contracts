import { HDNodeWallet, MaxUint256, parseUnits } from "ethers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { IERC20, SimpleAccount, TokenPaymaster } from "../../typechain-types";

export const approveToPaymaster = async (
  owner: SimpleAccount,
  userSigner: HDNodeWallet,
  paymaster: TokenPaymaster,
  token: IERC20,
  nativePayer: SignerWithAddress,
) => {
  const approveData = token.interface.encodeFunctionData("approve", [
    paymaster.target.toString(),
    MaxUint256,
  ]);
  await nativePayer.sendTransaction({
    to: userSigner,
    value: parseUnits("0.1"),
  });
  await owner.execute(token, 0n, approveData);
};
