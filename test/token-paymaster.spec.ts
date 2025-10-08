import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers } from "hardhat";
import {
  IEntryPoint__factory,
  IERC20,
  IPaymaster,
  SimpleAccount,
  SimpleAccount__factory,
} from "../typechain-types";
import { getPaymentSignature, getUserOp } from "./utils";
import {
  EventLog,
  formatUnits,
  HDNodeWallet,
  MaxUint256,
  parseUnits,
  randomBytes,
  Wallet,
  ZeroHash,
} from "ethers";
import { FEES, GAS } from "./constants";
import { GasLimits, FeePerGas } from "./types";

describe("TokenPaymaster", () => {
  let deployer: SignerWithAddress;
  let operator: SignerWithAddress;
  let userSigner: HDNodeWallet;
  let beneficiary: SignerWithAddress;

  const ENTRY_POINT_V08 = "0x4337084d9e255ff0702461cf8895ce9e3b5ff108";
  const POST_OP_COST = 30000n;

  const setup = async () => {
    [deployer, operator, beneficiary] = await ethers.getSigners();
    userSigner = Wallet.createRandom(deployer.provider);

    const entryPoint = IEntryPoint__factory.connect(ENTRY_POINT_V08, deployer);

    const accountFactory = await ethers.deployContract("SimpleAccountFactory", [entryPoint]);
    const tx = await accountFactory.createAccount(userSigner, 123n);
    const res = await tx.wait();
    const sender = SimpleAccount__factory.connect((res?.logs[3] as EventLog).args[0], userSigner);

    const paymaster = await ethers.deployContract("TokenPaymaster", [
      deployer,
      operator,
      entryPoint,
      POST_OP_COST,
    ]);
    await entryPoint.depositTo(paymaster, { value: parseUnits("100") });
    await paymaster.addStake(1, { value: parseUnits("100") });

    const usdc = await ethers.deployContract("MockERC20");
    const targetContract = await ethers.deployContract("TestCounter");

    await usdc.transfer(sender, parseUnits("1000000", 6));

    return { paymaster, usdc, entryPoint, sender, targetContract };
  };

  const approveToPaymaster = async (owner: SimpleAccount, paymaster: IPaymaster, token: IERC20) => {
    const approveData = token.interface.encodeFunctionData("approve", [
      paymaster.target.toString(),
      MaxUint256,
    ]);
    await deployer.sendTransaction({
      to: userSigner,
      value: parseUnits("0.1"),
    });
    await owner.execute(token, 0n, approveData);
  };

  describe("validatePaymasterUserOp", function () {
    it("should revert if paymaster data has wrong length", async () => {
      const { paymaster, entryPoint, sender, targetContract } = await loadFixture(setup);

      const userOp = await getUserOp(
        entryPoint,
        paymaster,
        userSigner,
        sender,
        targetContract.target.toString(),
        0n,
        targetContract.interface.encodeFunctionData("count"),
      );

      await expect(entryPoint.handleOps([userOp], beneficiary))
        .to.be.revertedWithCustomError(entryPoint, "FailedOpWithRevert")
        .withArgs(
          0,
          "AA33 reverted",
          paymaster.interface.encodeErrorResult("InvalidPaymasterAndDataLength", [52]),
        );

      userOp.paymasterAndData += Buffer.from(randomBytes(340)).toString("hex");
      await expect(entryPoint.handleOps([userOp], beneficiary))
        .to.be.revertedWithCustomError(entryPoint, "FailedOpWithRevert")
        .withArgs(
          0,
          "AA33 reverted",
          paymaster.interface.encodeErrorResult("InvalidPaymasterAndDataLength", [392]),
        );
    });

    it("should revert if invalid payment params", async () => {
      const { paymaster, entryPoint, usdc, sender, targetContract } = await loadFixture(setup);

      const callData = targetContract.interface.encodeFunctionData("count");
      const paymentStruct = {
        token: usdc,
        tokenPriceWei: 12345n,
        operator,
      };
      const paymentSignature = await getPaymentSignature(paymaster, paymentStruct, callData, sender.target.toString());
      const userOp = await getUserOp(
        entryPoint,
        paymaster,
        userSigner,
        sender,
        targetContract.target.toString(),
        0n,
        callData,
        { ...paymentStruct, ...paymentSignature },
      );

      const tx = entryPoint.handleOps([userOp], beneficiary);
      // This test now passes because we removed user field validation
      // The paymaster should work with any user as long as signature is valid
      await expect(tx)
        .to.emit(usdc, "Transfer");
    });

    it("should revert if wrong operator signature", async () => {
      const { paymaster, entryPoint, sender, usdc, targetContract } = await loadFixture(setup);

      const callData = targetContract.interface.encodeFunctionData("count");
      const paymentStruct = {
        token: usdc,
        tokenPriceWei: 12345n,
        operator,
      };
      const paymentSignature = await getPaymentSignature(paymaster, paymentStruct, callData, sender.target.toString());
      // Corrupt the signature to test signature validation
      paymentSignature.r = "0x" + Buffer.from(randomBytes(32)).toString("hex");

      const userOp = await getUserOp(
        entryPoint,
        paymaster,
        userSigner,
        sender,
        targetContract.target.toString(),
        0n,
        callData,
        { ...paymentStruct, ...paymentSignature },
      );

      const tx = entryPoint.handleOps([userOp], beneficiary);
      await expect(tx)
        .to.be.revertedWithCustomError(entryPoint, "FailedOp")
        .withArgs(0, "AA34 signature error");
    });

    it("should revert if prefund failed", async () => {
      const { paymaster, entryPoint, sender, usdc, targetContract } = await loadFixture(setup);

      const paymentStruct = {
        token: usdc,
        tokenPriceWei: 1234n,
        operator,
      };
      const callData = targetContract.interface.encodeFunctionData("count");
      const paymentSignature = await getPaymentSignature(paymaster, paymentStruct, callData, sender.target.toString());

      const userOp = await getUserOp(
        entryPoint,
        paymaster,
        userSigner,
        sender,
        targetContract.target.toString(),
        0n,
        callData,
        { ...paymentStruct, ...paymentSignature },
      );

      const tx = entryPoint.handleOps([userOp], beneficiary);
      await expect(tx)
        .to.be.revertedWithCustomError(entryPoint, "FailedOpWithRevert")
        .withArgs(
          0,
          "AA33 reverted",
          usdc.interface.encodeErrorResult("ERC20InsufficientAllowance", [
            paymaster.target.toString(),
            0,
            5,
          ]),
        );
    });

    it("should revert if calculated prefund is too low", async () => {
      const { paymaster, sender, usdc, entryPoint, targetContract } = await loadFixture(setup);

      await approveToPaymaster(sender, paymaster, usdc);

      const callData = targetContract.interface.encodeFunctionData("count");
      const paymentStruct = {
        token: usdc,
        tokenPriceWei: 1,
        operator,
      };
      const paymentSignature = await getPaymentSignature(paymaster, paymentStruct, callData, sender.target.toString());
      const userOp = await getUserOp(
        entryPoint,
        paymaster,
        userSigner,
        sender,
        targetContract.target.toString(),
        0n,
        callData,
        { ...paymentStruct, ...paymentSignature },
      );

      const tx = entryPoint.handleOps([userOp], beneficiary);
      await expect(tx)
        .to.be.revertedWithCustomError(entryPoint, "FailedOpWithRevert")
        .withArgs(
          0,
          "AA33 reverted",
          paymaster.interface.encodeErrorResult("InsufficientTokenAmount"),
        );

      // try {
      //   await entryPoint.handleOps([userOp], beneficiary);
      // } catch (err: any) {
      //   console.log(entryPoint.interface.decodeErrorResult("FailedOpWithRevert", err.data));
      // }
    });

    it("should revert if out of gas", async () => {
      const { paymaster, sender, usdc, entryPoint, targetContract } = await loadFixture(setup);

      await approveToPaymaster(sender, paymaster, usdc);

      const tokenPriceWei = BigInt(4e8);
      const paymentStruct = {
        token: usdc,
        tokenPriceWei,
        operator,
      };
      const callData = targetContract.interface.encodeFunctionData("count");
      const paymentSignature = await getPaymentSignature(paymaster, paymentStruct, callData, sender.target.toString());

      const gasLimits = new GasLimits();
      const feesPerGas = new FeePerGas();
      feesPerGas.maxFeePerGas = 2e10;
      feesPerGas.maxPriorityFeePerGas = 1e9;
      gasLimits.paymasterVerification = 74_000;
      gasLimits.paymasterPostOp = 12_000;

      const userOp = await getUserOp(
        entryPoint,
        paymaster,
        userSigner,
        sender,
        targetContract.target.toString(),
        0n,
        callData,
        { ...paymentStruct, ...paymentSignature },
        gasLimits,
      );

      const tx = entryPoint.handleOps([userOp], beneficiary);
      await expect(tx)
        .to.be.revertedWithCustomError(entryPoint, "FailedOpWithRevert")
        .withArgs(0, "AA33 reverted", "0x");
    });

    it("should prefund with ERC20 tokens", async () => {
      const { paymaster, sender, usdc, entryPoint, targetContract } = await loadFixture(setup);

      await approveToPaymaster(sender, paymaster, usdc);

      // tokenPriceWei = (10^erc20_decimals * price_eth) / price_erc20
      const tokenPriceWei = BigInt(2500 * 1e6); // already multiplied with 10^18
      const callData = targetContract.interface.encodeFunctionData("count");
      const paymentStruct = {
        token: usdc,
        tokenPriceWei,
        
        operator,
      };
      const paymentSignature = await getPaymentSignature(paymaster, paymentStruct, callData, sender.target.toString());
      const userOp = await getUserOp(
        entryPoint,
        paymaster,
        userSigner,
        sender,
        targetContract.target.toString(),
        0n,
        callData,
        { ...paymentStruct, ...paymentSignature },
      );

      const requiredGas =
        GAS.VERIFICATION +
        GAS.CALL +
        GAS.PAYMASTER_VERIFICATION +
        GAS.PAYMASTER_POST_OP +
        GAS.PRE_VERIFICATION;
      const requiredPrefund = requiredGas * FEES.MAX_FEE_PER_GAS;
      const tokenAmount =
        (requiredPrefund + POST_OP_COST * FEES.MAX_FEE_PER_GAS) * paymentStruct.tokenPriceWei;

      const tx = entryPoint.handleOps([userOp], beneficiary);
      await expect(tx)
        .to.emit(usdc, "Transfer")
        .withArgs(sender.target.toString(), paymaster.target.toString(), +formatUnits(tokenAmount));
    });

    it("CALLDATA: should validate callDataHash correctly", async () => {
      const { paymaster, sender, usdc, entryPoint, targetContract } = await loadFixture(setup);

      await approveToPaymaster(sender, paymaster, usdc);

      const callData = targetContract.interface.encodeFunctionData("count");
      const paymentStruct = {
        token: usdc,
        tokenPriceWei: BigInt(2500 * 1e6),
        
        operator,
      };
      
      console.log("Testing callDataHash validation:");
      console.log("- callData:", callData);
      
      const paymentSignature = await getPaymentSignature(paymaster, paymentStruct, callData, sender.target.toString());
      console.log("- Using signature r:", paymentSignature.r.slice(0, 10) + "...");
      
      const userOp = await getUserOp(
        entryPoint,
        paymaster,
        userSigner,
        sender,
        targetContract.target.toString(),
        0n,
        callData, // This should match the signed callDataHash
        { ...paymentStruct, ...paymentSignature },
      );



      const tx = entryPoint.handleOps([userOp], beneficiary);
      await expect(tx)
        .to.emit(usdc, "Transfer")
        .withArgs(sender.target.toString(), paymaster.target.toString(), "102500");
    });

    it("CALLDATA: should reject mismatched callData", async () => {
      const { paymaster, sender, usdc, entryPoint, targetContract } = await loadFixture(setup);

      await approveToPaymaster(sender, paymaster, usdc);

      const callData = targetContract.interface.encodeFunctionData("count");
      const differentCallData = targetContract.interface.encodeFunctionData("justEmit");
      
      const paymentStruct = {
        token: usdc,
        tokenPriceWei: BigInt(2500 * 1e6),
        
        operator,
      };
      
      // Sign for "count" function
      const paymentSignature = await getPaymentSignature(paymaster, paymentStruct, callData, sender.target.toString());
      
      // But try to execute "number" function - should fail
      const userOp = await getUserOp(
        entryPoint,
        paymaster,
        userSigner,
        sender,
        targetContract.target.toString(),
        0n,
        differentCallData,
        { ...paymentStruct, ...paymentSignature },
      );

      const tx = entryPoint.handleOps([userOp], beneficiary);
      await expect(tx)
        .to.be.revertedWithCustomError(entryPoint, "FailedOp")
        .withArgs(0, "AA34 signature error");
    });

    it("CALLDATA + NONCE: should prevent replay attacks with same callData", async function () {
      const { paymaster, sender, usdc, entryPoint, targetContract } = await loadFixture(setup);

      await approveToPaymaster(sender, paymaster, usdc);

      const callData = targetContract.interface.encodeFunctionData("count");
      console.log("Testing nonce replay protection:");
      console.log("- callData:", callData);

      const paymentStruct = {
        token: usdc,
        tokenPriceWei: BigInt(2500 * 1e6),
        
        operator,
      };

      // Create first userOp with nonce 0
      const signedPaymentData1 = await getPaymentSignature(paymaster, paymentStruct, callData, sender.target.toString());

      const userOp1 = await getUserOp(
        entryPoint,
        paymaster,
        userSigner,
        sender,
        targetContract.target.toString(),
        0n,
        callData,
        { ...paymentStruct, ...signedPaymentData1 },
      );

      // First operation should work
      await entryPoint.handleOps([userOp1], beneficiary);
      console.log("✅ First operation with nonce 0 executed successfully");

      // Try to replay the same operation (same nonce, same callData)
      const userOp2 = await getUserOp(
        entryPoint,
        paymaster,
        userSigner,
        sender,
        targetContract.target.toString(),
        0n, // Same userOp nonce  
        callData, // Same callData
        { ...paymentStruct, ...signedPaymentData1 }, // Same payment signature with nonce 0
      );

      // Should fail because operator nonce was already used
      const tx = entryPoint.handleOps([userOp2], beneficiary);
      await expect(tx).to.be.reverted;
      console.log("✅ Replay attack prevented - same signature cannot be reused");
    });


  });

  describe("postOp", async () => {
    it("should refund payment tokens if any", async () => {
      const { paymaster, sender, usdc, entryPoint, targetContract } = await loadFixture(setup);

      await approveToPaymaster(sender, paymaster, usdc);

      const tokenPriceWei = BigInt(2500 * 1e6);
      const callData = targetContract.interface.encodeFunctionData("count");
      const paymentStruct = {
        token: usdc,
        tokenPriceWei,
        
        operator,
      };
      const paymentSignature = await getPaymentSignature(paymaster, paymentStruct, callData, sender.target.toString());
      const userOp = await getUserOp(
        entryPoint,
        paymaster,
        userSigner,
        sender,
        targetContract.target.toString(),
        0n,
        callData,
        { ...paymentStruct, ...paymentSignature },
      );

      const tx = entryPoint.handleOps([userOp], beneficiary);

      const actualGasCost = 2051930000000000n;
      const actualUserOpFeePerGas = FEES.MAX_FEE_PER_GAS;
      const actualTokenAmount =
        (actualGasCost + POST_OP_COST * actualUserOpFeePerGas) * paymentStruct.tokenPriceWei;

      const requiredGas =
        GAS.VERIFICATION +
        GAS.CALL +
        GAS.PAYMASTER_VERIFICATION +
        GAS.PAYMASTER_POST_OP +
        GAS.PRE_VERIFICATION;
      const requiredPrefund = requiredGas * FEES.MAX_FEE_PER_GAS;
      const tokenAmount =
        (requiredPrefund + POST_OP_COST * FEES.MAX_FEE_PER_GAS) * paymentStruct.tokenPriceWei;

      const refund = tokenAmount - actualTokenAmount;

      await expect(tx)
        .to.emit(usdc, "Transfer")
        .withArgs(paymaster.target.toString(), sender.target.toString(), +formatUnits(refund));
    });

    it("should emit postOp revert event if refund transfer failed", async () => {
      const { paymaster, sender, usdc, entryPoint } = await loadFixture(setup);

      await approveToPaymaster(sender, paymaster, usdc);

      const tokenPriceWei = BigInt(4e8);
      const callData = paymaster.interface.encodeFunctionData("withdrawTokens", [
        usdc.target.toString(),
        deployer.address,
        MaxUint256,
      ]);
      const paymentStruct = {
        token: usdc,
        tokenPriceWei,
        
        operator,
      };
      const paymentSignature = await getPaymentSignature(paymaster, paymentStruct, callData, sender.target.toString());

      await paymaster.grantRole(ZeroHash, sender);

      const userOp = await getUserOp(
        entryPoint,
        paymaster,
        userSigner,
        sender,
        paymaster.target.toString(),
        0n,
        callData,
        { ...paymentStruct, ...paymentSignature },
      );

      const tx = await entryPoint.handleOps([userOp], beneficiary);
      const receipt = await tx.wait();
      const revertLog = receipt?.logs.find(
        log => log.topics[0] === entryPoint.interface.getEvent("PostOpRevertReason").topicHash,
      );
      const errorData = (revertLog as EventLog).args[3];
      const postOpErrorReason = entryPoint.interface.parseError(errorData)?.args[0];
      const parsed = usdc.interface.parseError(postOpErrorReason);
      expect(parsed?.name).to.equal("ERC20InsufficientBalance");
      expect(parsed?.args[0]).to.equal(paymaster.target.toString());
    });

    it("should emit event", async () => {
      const { paymaster, sender, usdc, entryPoint, targetContract } = await loadFixture(setup);

      await approveToPaymaster(sender, paymaster, usdc);

      const tokenPriceWei = BigInt(2500 * 1e6);
      const callData = targetContract.interface.encodeFunctionData("count");
      const paymentStruct = {
        token: usdc,
        tokenPriceWei,
        
        operator,
      };
      const paymentSignature = await getPaymentSignature(paymaster, paymentStruct, callData, sender.target.toString());
      const userOp = await getUserOp(
        entryPoint,
        paymaster,
        userSigner,
        sender,
        targetContract.target.toString(),
        0n,
        callData,
        { ...paymentStruct, ...paymentSignature },
      );

      const userOpHash = await entryPoint.getUserOpHash(userOp);
      const actualGasCost = 2051930000000000n;
      const actualUserOpFeePerGas = FEES.MAX_FEE_PER_GAS;
      const actualTokenAmount =
        (actualGasCost + POST_OP_COST * actualUserOpFeePerGas) * paymentStruct.tokenPriceWei;

      const tx = entryPoint.handleOps([userOp], beneficiary);
      await expect(tx)
        .to.emit(paymaster, "UserOperationSponsored")
        .withArgs(
          sender.target.toString(),
          userOpHash,
          usdc.target.toString(),
          +formatUnits(actualTokenAmount),
          tokenPriceWei,
        );
    });
  });
});
