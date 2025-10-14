import { ethers } from "hardhat";
import { TokenPaymaster__factory } from "../typechain-types";
import { parseUnits } from "ethers";

async function main() {
  const [signer] = await ethers.getSigners();
  const paymasterAddress = "0x0000000000000000000000000000000000000000";
  const paymaster = TokenPaymaster__factory.connect(paymasterAddress, signer);

  console.log("Start withdraw...");
  const tx = await paymaster.withdrawTo(signer, parseUnits("0.001"));
  await tx.wait();
  console.log("Withdrawn:", tx.hash);
}

main().catch(console.error);
