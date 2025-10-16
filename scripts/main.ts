import { ethers, ignition } from "hardhat";
import { TokenPaymaster__factory } from "../typechain-types";
import { parseUnits } from "ethers";

async function main() {
  const [signer] = await ethers.getSigners();
  const paymasterAddress = "0x0000000000000000000000000000000000000000";
  const paymaster = TokenPaymaster__factory.connect(paymasterAddress, signer);

  console.log("Start deposit...");
  const tx = await paymaster.deposit({ value: parseUnits("0.005") });
  // const tx = await paymaster.withdrawTo(signer.address, '5000000000000000');
  await tx.wait();
  console.log("Deposit:", tx.hash);
}

main().catch(console.error);
