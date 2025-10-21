import { ethers, network } from "hardhat";
import { TokenPaymaster__factory, TestCounter__factory } from "../typechain-types";
import { Contract, parseUnits, ZeroHash } from "ethers";
import { DEPLOY_CONSTANTS } from "../constants";
import { entryPoint08Address } from "viem/_types/account-abstraction";

const abi = [
  {
    inputs: [
      {
        internalType: "address payable",
        name: "withdrawAddress",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
    ],
    name: "withdrawTo",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];

async function main() {
  const [signer, testSigner] = await ethers.getSigners();
  const paymasterAddress = "0x0000000000000000000000000000000000000000";
  const paymaster = TokenPaymaster__factory.connect(paymasterAddress, testSigner);
  // const paymaster = new Contract("0x0000000000000000000000000000000000000000", abi, signer);

  console.log("Start deposit...");
  const tx = await paymaster.deposit(entryPoint08Address, { value: parseUnits("0.035") });
  // const tx = await paymaster.withdrawTo(testSigner.address, "70294223967141469");
  await tx.wait();
  console.log("Deposit:", tx.hash);

  // console.log("Start grant operator role...");
  // const OPERATOR_ROLE = await paymaster.OPERATOR_ROLE();
  // const tx = await paymaster.grantRole(OPERATOR_ROLE, "0x0000000000000000000000000000000000000000");
  // await tx.wait();
  // console.log("Done:", tx.hash);
}

main().catch(console.error);
