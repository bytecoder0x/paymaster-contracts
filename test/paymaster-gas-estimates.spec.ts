import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  IEntryPoint,
  IERC20,
  IPaymaster,
  MockERC20,
  SimpleAccount,
  SimpleAccount__factory,
  TokenPaymaster,
  TestCounter,
  IEntryPoint__factory,
} from "../typechain-types";
import { getPaymentSignature, getUserOp } from "./utils";
import { EventLog, HDNodeWallet, MaxUint256, parseUnits, Wallet } from "ethers";
import { FEES, GAS } from "./constants";
import { expect } from "chai";

describe("Gas estimates", () => {
  let owner: HardhatEthersSigner;
  let operator: HardhatEthersSigner;
  let entryPoint: HardhatEthersSigner;
  let userSigner: HDNodeWallet;
  let paymaster: TokenPaymaster;
  let targetContract: TestCounter;
  let sender: SimpleAccount;
  let realEntryPoint: IEntryPoint;
  let usdc: MockERC20;

  const POST_OP_COST = 30000n;
  const ENTRY_POINT_V08 = "0x4337084d9e255ff0702461cf8895ce9e3b5ff108";

  const approveToPaymaster = async (owner: SimpleAccount, paymaster: IPaymaster, token: IERC20) => {
    const approveData = token.interface.encodeFunctionData("approve", [
      paymaster.target.toString(),
      MaxUint256,
    ]);
    await operator.sendTransaction({
      to: userSigner,
      value: parseUnits("0.1"),
    });
    await owner.execute(token, 0n, approveData);
  };

  it("Setup", async () => {
    [owner, operator, entryPoint] = await ethers.getSigners();
    userSigner = Wallet.createRandom(owner.provider);

    paymaster = await ethers.deployContract(
      "TokenPaymaster",
      [owner, operator, entryPoint, POST_OP_COST],
      { signer: entryPoint },
    );

    const accountFactory = await ethers.deployContract("SimpleAccountFactory", [entryPoint]);
    const tx = await accountFactory.createAccount(userSigner, 123n);
    const res = await tx.wait();
    sender = SimpleAccount__factory.connect((res?.logs[3] as EventLog).args[0], userSigner);

    targetContract = await ethers.deployContract("TestCounter");

    realEntryPoint = IEntryPoint__factory.connect(ENTRY_POINT_V08, entryPoint);

    usdc = await ethers.deployContract("MockERC20", { signer: entryPoint });
    await usdc.transfer(sender, parseUnits("1000000", 6));
  });

  it("Estimate ValidatePaymasterUserOp", async () => {
    await approveToPaymaster(sender, paymaster, usdc);

    const requiredGas =
      GAS.VERIFICATION +
      GAS.CALL +
      GAS.PAYMASTER_VERIFICATION +
      GAS.PAYMASTER_POST_OP +
      GAS.PRE_VERIFICATION;
    const maxCost = requiredGas * FEES.MAX_FEE_PER_GAS;
    const tokenPriceWei = BigInt(2500 * 1e6);
    const callData = targetContract.interface.encodeFunctionData("count");
    const userOpCallData = sender.interface.encodeFunctionData("execute", [
      targetContract.target.toString(),
      0n,
      callData,
    ]);
    const paymentStruct = {
      token: usdc,
      tokenPriceWei,
      operator,
    };
    const paymentSignature = await getPaymentSignature(
      paymaster,
      paymentStruct,
      userOpCallData,
      sender.target.toString(),
    );
    const userOp = await getUserOp(
      realEntryPoint,
      paymaster,
      userSigner,
      sender,
      targetContract.target.toString(),
      0n,
      targetContract.interface.encodeFunctionData("count"),
      { ...paymentStruct, ...paymentSignature },
    );
    const userOpHash = await realEntryPoint.getUserOpHash(userOp);
    const estimatedGasValidatePaymasterUserOp = await paymaster.validatePaymasterUserOp.estimateGas(
      userOp,
      userOpHash,
      maxCost,
    );
    await paymaster.validatePaymasterUserOp(userOp, userOpHash, maxCost);
    expect(estimatedGasValidatePaymasterUserOp).to.be.lt(110000n);
  });

  it("Estimate postOp", async () => {
    const mode = 0;
    const context =
      "0xb875ad85858b47861338a878d8a6b656149e793b0000000000000000000000000000000000000000000000000000000000af79e0000000000000000000000000000000000000000000000000000000009502f9001b48de00688b63515ef7734411688895e6e1537a763f8f1b4f7e39a72355de7fb1a386235606f09c30b990f1369cb10f18a84730";
    const actualGasCost = 2064180000000000;
    const actualUserOpFeePerGas = 10000000000;
    const estimatedGasPostOp = await paymaster.postOp.estimateGas(
      mode,
      context,
      actualGasCost,
      actualUserOpFeePerGas,
    );
    expect(estimatedGasPostOp).to.be.lt(67000n);
  });
});
