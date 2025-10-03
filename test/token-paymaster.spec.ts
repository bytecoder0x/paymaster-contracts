import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers } from "hardhat";
import { IEntryPoint__factory } from "../typechain-types";

describe("TokenPaymaster", () => {
  let deployer: SignerWithAddress;
  let operator: SignerWithAddress;
  let user: SignerWithAddress;

  const ENTRY_POINT_V08 = "0x4337084d9e255ff0702461cf8895ce9e3b5ff108";
  const POST_OP_CONST = 30000n;

  async function setup() {
    [deployer, operator, user] = await ethers.getSigners();

    const paymaster = await ethers.deployContract("TokenPaymaster", [
      deployer,
      operator,
      ENTRY_POINT_V08,
      POST_OP_CONST,
    ]);
    const usdc = await ethers.deployContract("MockERC20");
    const entryPoint = IEntryPoint__factory.connect(ENTRY_POINT_V08, deployer.provider);

    return { paymaster, usdc, entryPoint };
  }

  describe("validatePaymasterUserOp", function () {
    it("Should validate user op", async () => {
      const { paymaster, usdc, entryPoint } = await loadFixture(setup);
    });
  });
});
