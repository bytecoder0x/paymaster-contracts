import { ethers, network } from "hardhat";
import { TokenPaymaster__factory, TestCounter__factory } from "../typechain-types";
import { parseUnits, ZeroHash } from "ethers";
import { DEPLOY_CONSTANTS } from "../constants";

async function main() {
  const [signer, testSigner] = await ethers.getSigners();
  const paymasterAddress = "0x0000000000000000000000000000000000000000";
  const paymaster = TokenPaymaster__factory.connect(paymasterAddress, testSigner);

  console.log("Start deposit...");
  const tx = await paymaster.deposit({ value: parseUnits("0.002") });
  // const tx = await paymaster.withdrawTo(signer.address, '5000000000000000');
  await tx.wait();
  console.log("Deposit:", tx.hash);

  // console.log("Start grant operator role...");
  // const OPERATOR_ROLE = await paymaster.OPERATOR_ROLE();
  // const tx = await paymaster.grantRole(OPERATOR_ROLE, "0x0000000000000000000000000000000000000000");
  // await tx.wait();
  // console.log("Done:", tx.hash);
}

main().catch(console.error);
