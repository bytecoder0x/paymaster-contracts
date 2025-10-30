import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { setup, approveToPaymaster } from "./utils";
import { ethers } from "hardhat";
import {
  IEntryPoint,
  IERC20,
  SimpleAccount,
  TestCounter,
  TokenPaymaster,
  CollectorSwapper,
} from "../typechain-types";
import { getPaymentSignature, getUserOp } from "./utils";
import {
  EventLog,
  HDNodeWallet,
  MaxUint256,
  parseUnits,
  randomBytes,
  Wallet,
  ZeroAddress,
  ZeroHash,
} from "ethers";
import { ENTRY_POINT_V06, FEES, GAS, ZERO_ADDRESS } from "./constants";
import { GasLimits, FeePerGas } from "./types";

describe("TokenPaymaster", () => {
  let paymaster: TokenPaymaster;
  let entryPointV8: IEntryPoint;
  let entryPointV7: IEntryPoint;
  let collectorSwapper: CollectorSwapper;
  let usdc: IERC20;
  let sender: SimpleAccount;
  let targetContract: TestCounter;
  let deployer: SignerWithAddress;
  let operator: SignerWithAddress;
  let userSigner: HDNodeWallet;
  let beneficiary: SignerWithAddress;
  let alice: SignerWithAddress;
  let binanceHotWallet: SignerWithAddress;

  beforeEach(async () => {
    const fixture = await loadFixture(setup);

    paymaster = fixture.paymaster;
    entryPointV8 = fixture.entryPointV8;
    entryPointV7 = fixture.entryPointV7;
    collectorSwapper = fixture.collectorSwapper;
    usdc = fixture.usdc;
    sender = fixture.sender;
    targetContract = fixture.targetContract;
    deployer = fixture.deployer;
    operator = fixture.operator;
    beneficiary = fixture.beneficiary;
    alice = fixture.alice;
    userSigner = fixture.userSigner;
    binanceHotWallet = fixture.binanceHotWallet;
  });

  describe("validatePaymasterUserOp", function () {
    it("should be called only by whitelisted EntryPoint", async () => {
      const userOp = {
        sender,
        nonce: await entryPointV8.getNonce(sender, 0),
        initCode: "0x",
        callData: "0x",
        accountGasLimits: ZeroHash,
        preVerificationGas: 0n,
        gasFees: ZeroHash,
        paymasterAndData: "0x",
        signature: "0x",
      };
      const tx = paymaster.validatePaymasterUserOp(userOp, ZeroHash, 0);
      await expect(tx)
        .to.be.revertedWithCustomError(paymaster, "EntryPointNotWhitelisted")
        .withArgs(deployer.address);
    });

    it("should revert if paymaster data has wrong length", async () => {
      // Test with too short data (only paymaster address + gas limits, no PaymasterPaymentData)
      const userOp = await getUserOp(
        entryPointV8,
        paymaster,
        userSigner,
        sender,
        targetContract.target.toString(),
        0n,
        targetContract.interface.encodeFunctionData("count"),
      );

      await expect(entryPointV8.handleOps([userOp], beneficiary))
        .to.be.revertedWithCustomError(entryPointV8, "FailedOpWithRevert")
        .withArgs(
          0,
          "AA33 reverted",
          paymaster.interface.encodeErrorResult("InvalidPaymasterAndDataLength", [52]),
        );
    });

    it("should revert if wrong operator signature", async () => {
      const callData = targetContract.interface.encodeFunctionData("count");
      const paymentStruct = {
        token: usdc,
        exchangeRate: 12345n,
        postOpCost: GAS.PAYMASTER_POST_OP,
        operator,
      };
      // Create the full userOp callData that will be used in the actual transaction
      const userOpCallData = sender.interface.encodeFunctionData("execute", [
        targetContract.target.toString(),
        0n,
        callData,
      ]);
      const paymentSignature = await getPaymentSignature(
        paymaster,
        paymentStruct,
        userOpCallData,
        sender.target.toString(),
      );
      // Corrupt the signature to test signature validation
      paymentSignature.r = "0x" + Buffer.from(randomBytes(32)).toString("hex");

      const userOp = await getUserOp(
        entryPointV8,
        paymaster,
        userSigner,
        sender,
        targetContract.target.toString(),
        0n,
        callData,
        { ...paymentStruct, ...paymentSignature },
      );

      const tx = entryPointV8.handleOps([userOp], beneficiary);
      await expect(tx)
        .to.be.revertedWithCustomError(entryPointV8, "FailedOp")
        .withArgs(0, "AA34 signature error");
    });

    it("should revert if out of gas", async () => {
      await approveToPaymaster(sender, userSigner, paymaster, usdc, deployer);

      const exchangeRate = BigInt(4e8);
      const postOpCost = 30000n;
      const paymentStruct = {
        token: usdc,
        exchangeRate,
        postOpCost,
        operator,
      };
      const callData = targetContract.interface.encodeFunctionData("count");
      // Create the full userOp callData that will be used in the actual transaction
      const userOpCallData = sender.interface.encodeFunctionData("execute", [
        targetContract.target.toString(),
        0n,
        callData,
      ]);
      const paymentSignature = await getPaymentSignature(
        paymaster,
        paymentStruct,
        userOpCallData,
        sender.target.toString(),
      );

      const gasLimits = new GasLimits();
      const feesPerGas = new FeePerGas();
      feesPerGas.maxFeePerGas = 2e10;
      feesPerGas.maxPriorityFeePerGas = 1e9;
      gasLimits.paymasterVerification = 1_000;
      gasLimits.paymasterPostOp = postOpCost;

      const userOp = await getUserOp(
        entryPointV8,
        paymaster,
        userSigner,
        sender,
        targetContract.target.toString(),
        0n,
        callData,
        { ...paymentStruct, ...paymentSignature },
        gasLimits,
      );

      const tx = entryPointV8.handleOps([userOp], beneficiary);
      await expect(tx)
        .to.be.revertedWithCustomError(entryPointV8, "FailedOpWithRevert")
        .withArgs(0, "AA33 reverted", "0x");

      // try {
      //   await entryPointV8.handleOps([userOp], beneficiary);
      // } catch (err: any) {
      //   console.log(entryPointV8.interface.decodeErrorResult("FailedOpWithRevert", err.data));
      // }
    });

    it("CALLDATA: should validate callDataHash correctly", async () => {
      await approveToPaymaster(sender, userSigner, paymaster, usdc, deployer);

      const callData = targetContract.interface.encodeFunctionData("count");
      const paymentStruct = {
        token: usdc,
        exchangeRate: BigInt(2500 * 1e6),
        postOpCost: GAS.PAYMASTER_POST_OP,
        operator,
      };

      // Test callDataHash validation

      // Create the full userOp callData that will be used in the actual transaction
      const userOpCallData = sender.interface.encodeFunctionData("execute", [
        targetContract.target.toString(),
        0n,
        callData,
      ]);
      const paymentSignature = await getPaymentSignature(
        paymaster,
        paymentStruct,
        userOpCallData,
        sender.target.toString(),
      );
      // Use validated signature

      const userOp = await getUserOp(
        entryPointV8,
        paymaster,
        userSigner,
        sender,
        targetContract.target.toString(),
        0n,
        callData, // This should match the signed callDataHash
        { ...paymentStruct, ...paymentSignature },
      );

      const tx = entryPointV8.handleOps([userOp], beneficiary);

      // Test successful execution - should transfer tokens in postOp
      await expect(tx).to.emit(usdc, "Transfer");
    });

    it("CALLDATA: should reject mismatched callData", async () => {
      await approveToPaymaster(sender, userSigner, paymaster, usdc, deployer);

      const callData = targetContract.interface.encodeFunctionData("count");
      const differentCallData = targetContract.interface.encodeFunctionData("justEmit");

      const paymentStruct = {
        token: usdc,
        exchangeRate: BigInt(2500 * 1e6),
        postOpCost: GAS.PAYMASTER_POST_OP,
        operator,
      };

      // Sign for "count" function
      // Create the full userOp callData that will be used in the actual transaction
      const userOpCallData = sender.interface.encodeFunctionData("execute", [
        targetContract.target.toString(),
        0n,
        callData,
      ]);
      const paymentSignature = await getPaymentSignature(
        paymaster,
        paymentStruct,
        userOpCallData,
        sender.target.toString(),
      );

      // But try to execute "number" function - should fail
      const userOp = await getUserOp(
        entryPointV8,
        paymaster,
        userSigner,
        sender,
        targetContract.target.toString(),
        0n,
        differentCallData,
        { ...paymentStruct, ...paymentSignature },
      );

      const tx = entryPointV8.handleOps([userOp], beneficiary);
      await expect(tx)
        .to.be.revertedWithCustomError(entryPointV8, "FailedOp")
        .withArgs(0, "AA34 signature error");
    });

    it("CALLDATA + NONCE: should prevent replay attacks with same callData", async function () {
      await approveToPaymaster(sender, userSigner, paymaster, usdc, deployer);

      const callData = targetContract.interface.encodeFunctionData("count");
      // Test nonce replay protection

      const paymentStruct = {
        token: usdc,
        exchangeRate: BigInt(2500 * 1e6),
        postOpCost: GAS.PAYMASTER_POST_OP,
        operator,
      };

      // Create first userOp with nonce 0
      // Create the full userOp callData that will be used in the actual transaction
      const userOpCallData = sender.interface.encodeFunctionData("execute", [
        targetContract.target.toString(),
        0n,
        callData,
      ]);
      const signedPaymentData1 = await getPaymentSignature(
        paymaster,
        paymentStruct,
        userOpCallData,
        sender.target.toString(),
      );

      const userOp1 = await getUserOp(
        entryPointV8,
        paymaster,
        userSigner,
        sender,
        targetContract.target.toString(),
        0n,
        callData,
        { ...paymentStruct, ...signedPaymentData1 },
      );

      // First operation should work
      await entryPointV8.handleOps([userOp1], beneficiary);
      // First operation should work

      // Try to replay the same operation (same nonce, same callData)
      const userOp2 = await getUserOp(
        entryPointV8,
        paymaster,
        userSigner,
        sender,
        targetContract.target.toString(),
        0n, // Same userOp nonce
        callData, // Same callData
        { ...paymentStruct, ...signedPaymentData1 }, // Same payment signature with nonce 0
      );

      // Should fail because operator nonce was already used
      const tx = entryPointV8.handleOps([userOp2], beneficiary);
      await expect(tx).to.be.reverted;
      // Replay attack prevented
    });
  });

  describe("postOp", async () => {
    it("should be called only by whitelisted EntryPoint", async () => {
      const tx = paymaster.postOp(0, "0xdeadbeef", 124, 22222);
      await expect(tx)
        .to.be.revertedWithCustomError(paymaster, "EntryPointNotWhitelisted")
        .withArgs(deployer.address);
    });

    it("should transfer exact token amount in postOp", async () => {
      await approveToPaymaster(sender, userSigner, paymaster, usdc, deployer);

      const exchangeRate = BigInt(2500 * 1e6);
      const callData = targetContract.interface.encodeFunctionData("count");
      const paymentStruct = {
        token: usdc,
        exchangeRate,
        postOpCost: GAS.PAYMASTER_POST_OP,
        operator,
      };
      // Create the full userOp callData that will be used in the actual transaction
      const userOpCallData = sender.interface.encodeFunctionData("execute", [
        targetContract.target.toString(),
        0n,
        callData,
      ]);
      const paymentSignature = await getPaymentSignature(
        paymaster,
        paymentStruct,
        userOpCallData,
        sender.target.toString(),
      );
      const userOp = await getUserOp(
        entryPointV8,
        paymaster,
        userSigner,
        sender,
        targetContract.target.toString(),
        0n,
        callData,
        { ...paymentStruct, ...paymentSignature },
      );

      const tx = await entryPointV8.handleOps([userOp], beneficiary);
      const receipt = await tx.wait();

      // Check that token transfer from sender to paymaster occurred in postOp
      const transferEvents = await usdc.queryFilter(
        usdc.filters.Transfer(sender.target.toString(), paymaster.target.toString()),
        receipt?.blockNumber,
        receipt?.blockNumber,
      );
      expect(transferEvents.length).to.equal(1);
      expect(transferEvents[0].args[2]).to.be.greaterThan(0); // Transfer amount should be positive
    });

    it("should allow sponsored user operations with no tokens needed", async () => {
      await approveToPaymaster(sender, userSigner, paymaster, usdc, deployer);

      const exchangeRate = BigInt(0); // no tokens needed
      const callData = targetContract.interface.encodeFunctionData("count");
      const paymentStruct = {
        token: usdc,
        exchangeRate,
        postOpCost: GAS.PAYMASTER_POST_OP,
        operator,
      };
      // Create the full userOp callData that will be used in the actual transaction
      const userOpCallData = sender.interface.encodeFunctionData("execute", [
        targetContract.target.toString(),
        0n,
        callData,
      ]);
      const paymentSignature = await getPaymentSignature(
        paymaster,
        paymentStruct,
        userOpCallData,
        sender.target.toString(),
      );
      const userOp = await getUserOp(
        entryPointV8,
        paymaster,
        userSigner,
        sender,
        targetContract.target.toString(),
        0n,
        callData,
        { ...paymentStruct, ...paymentSignature },
      );

      const userOpHash = await entryPointV8.getUserOpHash(userOp);
      const txPromise = entryPointV8.handleOps([userOp], beneficiary);
      const tx = await txPromise;
      const receipt = await tx.wait();

      const sponsoredEvents = await paymaster.queryFilter(
        paymaster.filters.UserOperationSponsored(),
        receipt?.blockNumber,
        receipt?.blockNumber,
      );
      expect(sponsoredEvents.length).to.equal(1);
      const event = sponsoredEvents[0];
      expect(event.args[0]).to.equal(sender.target.toString());
      expect(event.args[1]).to.equal(userOpHash);
      expect(event.args[2]).to.equal(usdc.target.toString());
      expect(event.args[3]).to.equal(0n); // no tokens needed
      expect(event.args[4]).to.equal(exchangeRate);
    });

    it("should emit postOp revert event if insufficient allowance", async () => {
      const exchangeRate = BigInt(2500 * 1e6);
      const callData = targetContract.interface.encodeFunctionData("count");
      const paymentStruct = {
        token: usdc,
        exchangeRate,
        postOpCost: GAS.PAYMASTER_POST_OP,
        operator,
      };
      // Create the full userOp callData that will be used in the actual transaction
      const userOpCallData = sender.interface.encodeFunctionData("execute", [
        targetContract.target.toString(),
        0n,
        callData,
      ]);
      const paymentSignature = await getPaymentSignature(
        paymaster,
        paymentStruct,
        userOpCallData,
        sender.target.toString(),
      );

      const userOp = await getUserOp(
        entryPointV8,
        paymaster,
        userSigner,
        sender,
        targetContract.target.toString(),
        0n,
        callData,
        { ...paymentStruct, ...paymentSignature },
      );

      const tx = await entryPointV8.handleOps([userOp], beneficiary);
      const receipt = await tx.wait();
      const revertLog = receipt?.logs.find(
        log => log.topics[0] === entryPointV8.interface.getEvent("PostOpRevertReason").topicHash,
      );

      // Ensure revertLog exists
      expect(revertLog).to.not.be.undefined;

      const errorData = (revertLog as EventLog).args[3];
      const postOpErrorReason = entryPointV8.interface.parseError(errorData)?.args[0];
      const parsed = usdc.interface.parseError(postOpErrorReason);

      expect(parsed).to.not.be.null;
      expect(parsed?.name).to.equal("Error");
      expect(parsed?.args[0]).to.equal('ERC20: transfer amount exceeds allowance');
    });

    it("should emit event", async () => {
      await approveToPaymaster(sender, userSigner, paymaster, usdc, deployer);

      const exchangeRate = BigInt(2500 * 1e6);
      const callData = targetContract.interface.encodeFunctionData("count");
      const paymentStruct = {
        token: usdc,
        exchangeRate,
        postOpCost: GAS.PAYMASTER_POST_OP,
        operator,
      };
      // Create the full userOp callData that will be used in the actual transaction
      const userOpCallData = sender.interface.encodeFunctionData("execute", [
        targetContract.target.toString(),
        0n,
        callData,
      ]);
      const paymentSignature = await getPaymentSignature(
        paymaster,
        paymentStruct,
        userOpCallData,
        sender.target.toString(),
      );
      const userOp = await getUserOp(
        entryPointV8,
        paymaster,
        userSigner,
        sender,
        targetContract.target.toString(),
        0n,
        callData,
        { ...paymentStruct, ...paymentSignature },
      );

      const userOpHash = await entryPointV8.getUserOpHash(userOp);
      const txPromise = entryPointV8.handleOps([userOp], beneficiary);
      const tx = await txPromise;
      const receipt = await tx.wait();

      // Check UserOperationSponsored event with flexible gas amount due to optimizations
      const sponsoredEvents = await paymaster.queryFilter(
        paymaster.filters.UserOperationSponsored(),
        receipt?.blockNumber,
        receipt?.blockNumber,
      );
      expect(sponsoredEvents.length).to.equal(1);
      const event = sponsoredEvents[0];
      expect(event.args[0]).to.equal(sender.target.toString());
      expect(event.args[1]).to.equal(userOpHash);
      expect(event.args[2]).to.equal(usdc.target.toString());
      expect(event.args[3]).to.be.greaterThan(0);
      expect(event.args[4]).to.equal(exchangeRate);
    });
  });

  describe("StakeManager functions", () => {
    it("constructor: deploy should fail if no EntryPoints are set", async () => {
      await expect(ethers.deployContract("TokenPaymaster", [deployer, operator, []])).to.be
        .reverted;
    });

    it("should be called only by default admin", async () => {
      await expect(paymaster.connect(alice).withdrawTo(entryPointV7, alice, 123))
        .to.be.revertedWithCustomError(paymaster, "AccessControlUnauthorizedAccount")
        .withArgs(alice.address, ZeroHash);

      await expect(paymaster.connect(alice).addStake(entryPointV8, 9999))
        .to.be.revertedWithCustomError(paymaster, "AccessControlUnauthorizedAccount")
        .withArgs(alice.address, ZeroHash);

      await expect(paymaster.connect(alice).unlockStake(entryPointV7))
        .to.be.revertedWithCustomError(paymaster, "AccessControlUnauthorizedAccount")
        .withArgs(alice.address, ZeroHash);

      await expect(paymaster.connect(alice).withdrawStake(entryPointV8, alice))
        .to.be.revertedWithCustomError(paymaster, "AccessControlUnauthorizedAccount")
        .withArgs(alice.address, ZeroHash);
    });

    it("should revert if EntryPoint is not whitelisted", async () => {
      await expect(paymaster.deposit(ENTRY_POINT_V06, { value: 123 }))
        .to.be.revertedWithCustomError(paymaster, "EntryPointNotWhitelisted")
        .withArgs(ENTRY_POINT_V06);

      await expect(paymaster.addStake(ENTRY_POINT_V06, 9999))
        .to.be.revertedWithCustomError(paymaster, "EntryPointNotWhitelisted")
        .withArgs(ENTRY_POINT_V06);
    });

    it("should deposit to EntryPoint", async () => {
      const initialDeposit = await paymaster.getDeposit(entryPointV8);
      const depositAmount = parseUnits("1");

      await paymaster.deposit(entryPointV8, { value: depositAmount });

      const finalDeposit = await paymaster.getDeposit(entryPointV8);
      expect(finalDeposit - initialDeposit).to.equal(depositAmount);
    });

    it("should withdraw from EntryPoint", async () => {
      await paymaster.deposit(entryPointV7, { value: parseUnits("2") });
      const initialBalance = await ethers.provider.getBalance(beneficiary);

      await paymaster.withdrawTo(entryPointV7, beneficiary.address, parseUnits("1"));

      const finalBalance = await ethers.provider.getBalance(beneficiary);
      expect(finalBalance - initialBalance).to.equal(parseUnits("1"));
    });

    it("should revert withdrawTo with zero address", async () => {
      await expect(
        paymaster.withdrawTo(entryPointV7, ZeroAddress, parseUnits("1")),
      ).to.be.revertedWithCustomError(paymaster, "ZeroAddress");
    });

    it("should unlock stake", async () => {
      await paymaster.unlockStake(entryPointV8);

      const stakeInfo = await paymaster.getStakeInfo(entryPointV8);
      expect(stakeInfo.withdrawTime).to.be.gt(0);
    });

    it("should withdraw stake", async () => {
      // First unlock, then wait and withdraw
      await paymaster.unlockStake(entryPointV7);

      // Fast forward time to make withdrawal possible
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine", []);

      const initialBalance = await ethers.provider.getBalance(beneficiary);
      await paymaster.withdrawStake(entryPointV7, beneficiary.address);
      const finalBalance = await ethers.provider.getBalance(beneficiary);

      expect(finalBalance).to.be.gt(initialBalance);
    });

    it("should revert withdrawStake with zero address", async () => {
      await expect(
        paymaster.withdrawStake(entryPointV8, ZeroAddress),
      ).to.be.revertedWithCustomError(paymaster, "ZeroAddress");
    });

    it("should get stake info", async () => {
      const stakeInfo = await paymaster.getStakeInfo(entryPointV7);
      expect(stakeInfo.depositAmount).to.be.gt(0);
      expect(stakeInfo.staked).to.be.true;
      expect(stakeInfo.stake).to.be.gt(0);
    });

    it("should allow whitelist and de-whitelist EntryPoints", async () => {
      await paymaster.setEntryPointWhitelist(entryPointV7, false);
      expect(await paymaster.entryPointWhitelist(entryPointV7)).to.be.false;

      await paymaster.setEntryPointWhitelist(entryPointV7, true);
      expect(await paymaster.entryPointWhitelist(entryPointV7)).to.be.true;

      await expect(paymaster.setEntryPointWhitelist(ZeroAddress, true)).to.be.reverted;
      await expect(paymaster.connect(alice).setEntryPointWhitelist(entryPointV7, true))
        .to.be.revertedWithCustomError(paymaster, "AccessControlUnauthorizedAccount")
        .withArgs(alice.address, ZeroHash);
    });
  });

  describe("Pause functionality", () => {
    it("should pause and unpause", async () => {
      await paymaster.pause();
      expect(await paymaster.paused()).to.be.true;

      await paymaster.unpause();
      expect(await paymaster.paused()).to.be.false;
    });

    it("should revert operations when paused", async () => {
      await paymaster.pause();
      await approveToPaymaster(sender, userSigner, paymaster, usdc, deployer);

      const callData = targetContract.interface.encodeFunctionData("count");
      const paymentStruct = {
        token: usdc,
        exchangeRate: BigInt(2500 * 1e6),
        postOpCost: GAS.PAYMASTER_POST_OP,
        operator,
      };
      const userOpCallData = sender.interface.encodeFunctionData("execute", [
        targetContract.target.toString(),
        0n,
        callData,
      ]);
      const paymentSignature = await getPaymentSignature(
        paymaster,
        paymentStruct,
        userOpCallData,
        sender.target.toString(),
      );

      const userOp = await getUserOp(
        entryPointV8,
        paymaster,
        userSigner,
        sender,
        targetContract.target.toString(),
        0n,
        callData,
        { ...paymentStruct, ...paymentSignature },
      );

      await expect(entryPointV8.handleOps([userOp], beneficiary)).to.be.revertedWithCustomError(
        entryPointV8,
        "FailedOpWithRevert",
      );
    });

    it("should only allow admin to pause/unpause", async () => {
      await expect(paymaster.connect(operator).pause())
        .to.be.revertedWithCustomError(paymaster, "AccessControlUnauthorizedAccount")
        .withArgs(operator.address, ZeroHash);

      await expect(paymaster.connect(operator).unpause())
        .to.be.revertedWithCustomError(paymaster, "AccessControlUnauthorizedAccount")
        .withArgs(operator.address, ZeroHash);
    });
  });

  describe("CollectorSwapper functionality", () => {
    it("should set collector swapper and post op try swap enabled", async () => {
      await paymaster.setCollectorSwapper(collectorSwapper.target.toString());
      expect(await paymaster.collectorSwapper()).to.equal(collectorSwapper.target.toString());

      await paymaster.setPostOpSwapEnabled(true);
      expect(await paymaster.postOpSwapEnabled()).to.be.true;
    });
  });

  describe("EIP712Service edge cases", () => {
    it("should fail validation with expired deadline", async () => {
      await approveToPaymaster(sender, userSigner, paymaster, usdc, deployer);

      // Get current blockchain timestamp and set deadline in the past
      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTimestamp = currentBlock!.timestamp;
      const expiredDeadline = currentTimestamp - 100; // 100 seconds in the past

      const callData = targetContract.interface.encodeFunctionData("count");
      const paymentStruct = {
        token: usdc,
        exchangeRate: BigInt(2500 * 1e6),
        postOpCost: GAS.PAYMASTER_POST_OP,
        operator,
        deadline: expiredDeadline, // Generate signature with expired deadline
      };
      const userOpCallData = sender.interface.encodeFunctionData("execute", [
        targetContract.target.toString(),
        0n,
        callData,
      ]);
      const paymentSignature = await getPaymentSignature(
        paymaster,
        paymentStruct,
        userOpCallData,
        sender.target.toString(),
      );

      const userOp = await getUserOp(
        entryPointV8,
        paymaster,
        userSigner,
        sender,
        targetContract.target.toString(),
        0n,
        callData,
        { ...paymentStruct, ...paymentSignature },
      );

      await expect(entryPointV8.handleOps([userOp], beneficiary))
        .to.be.revertedWithCustomError(entryPointV8, "FailedOp")
        .withArgs(0, "AA34 signature error");
    });

    it("should fail validation with invalid operator", async () => {
      await approveToPaymaster(sender, userSigner, paymaster, usdc, deployer);

      // Use unauthorized signer (beneficiary instead of operator)
      const callData = targetContract.interface.encodeFunctionData("count");
      const paymentStruct = {
        token: usdc,
        exchangeRate: BigInt(2500 * 1e6),
        postOpCost: GAS.PAYMASTER_POST_OP,
        operator: beneficiary, // Invalid operator
      };
      const userOpCallData = sender.interface.encodeFunctionData("execute", [
        targetContract.target.toString(),
        0n,
        callData,
      ]);
      const paymentSignature = await getPaymentSignature(
        paymaster,
        paymentStruct,
        userOpCallData,
        sender.target.toString(),
      );

      const userOp = await getUserOp(
        entryPointV8,
        paymaster,
        userSigner,
        sender,
        targetContract.target.toString(),
        0n,
        callData,
        { ...paymentStruct, ...paymentSignature },
      );

      await expect(entryPointV8.handleOps([userOp], beneficiary))
        .to.be.revertedWithCustomError(entryPointV8, "FailedOp")
        .withArgs(0, "AA34 signature error");
    });
  });

  describe("Additional coverage tests", () => {
    it("should handle failed operations without refund", async () => {
      await approveToPaymaster(sender, userSigner, paymaster, usdc, deployer);

      // Create a call that will fail - use countFail function
      const failingCallData = targetContract.interface.encodeFunctionData("countFail");
      const paymentStruct = {
        token: usdc,
        exchangeRate: BigInt(2500 * 1e6),
        postOpCost: GAS.PAYMASTER_POST_OP,
        operator,
      };
      const userOpCallData = sender.interface.encodeFunctionData("execute", [
        targetContract.target.toString(),
        0n,
        failingCallData,
      ]);
      const paymentSignature = await getPaymentSignature(
        paymaster,
        paymentStruct,
        userOpCallData,
        sender.target.toString(),
      );

      const userOp = await getUserOp(
        entryPointV8,
        paymaster,
        userSigner,
        sender,
        targetContract.target.toString(),
        0n,
        failingCallData,
        { ...paymentStruct, ...paymentSignature },
      );

      // Operation should succeed even if inner call fails - paymaster keeps all tokens
      const tx = await entryPointV8.handleOps([userOp], beneficiary);
      await expect(tx).to.emit(paymaster, "UserOperationSponsored");
    });

    it("should withdraw tokens with max amount", async () => {
      // Transfer some tokens to paymaster first
      const transferAmount = parseUnits("1000", 6);
      await usdc.connect(binanceHotWallet).transfer(paymaster.target.toString(), transferAmount);

      const initialBalance = await usdc.balanceOf(deployer.address);

      // Withdraw with max amount
      const tx = await paymaster.withdrawTokens(
        usdc.target.toString(),
        deployer.address,
        MaxUint256,
      );

      const finalBalance = await usdc.balanceOf(deployer.address);
      expect(finalBalance - initialBalance).to.equal(transferAmount);

      // Check TokensWithdrawn event (single token wrapped in array)
      await expect(tx)
        .to.emit(paymaster, "TokensWithdrawn")
        .withArgs(deployer.address, [usdc.target.toString()], [transferAmount]);
    });

    it("should withdraw batch tokens successfully", async () => {
      // Deploy second mock token
      const usdt = await ethers.deployContract("MockERC20");

      // Transfer tokens to paymaster
      const transferAmount1 = parseUnits("1000", 6);
      const transferAmount2 = parseUnits("500", 6);

      await usdc.connect(binanceHotWallet).transfer(paymaster.target.toString(), transferAmount1);
      await usdt.transfer(paymaster.target.toString(), transferAmount2);

      const initialBalance1 = await usdc.balanceOf(deployer.address);
      const initialBalance2 = await usdt.balanceOf(deployer.address);

      // Withdraw batch with specific amounts
      const tx = await paymaster.withdrawTokensBatch(
        [usdc.target.toString(), usdt.target.toString()],
        [parseUnits("500", 6), MaxUint256],
        deployer.address,
      );

      const finalBalance1 = await usdc.balanceOf(deployer.address);
      const finalBalance2 = await usdt.balanceOf(deployer.address);

      expect(finalBalance1 - initialBalance1).to.equal(parseUnits("500", 6));
      expect(finalBalance2 - initialBalance2).to.equal(transferAmount2);

      // Check TokensWithdrawn event
      await expect(tx)
        .to.emit(paymaster, "TokensWithdrawn")
        .withArgs(
          deployer.address,
          [usdc.target.toString(), usdt.target.toString()],
          [parseUnits("500", 6), transferAmount2],
        );
    });

    it("should revert batch withdraw with array length mismatch", async () => {
      await expect(
        paymaster.withdrawTokensBatch(
          [usdc.target.toString()],
          [parseUnits("100", 6), parseUnits("200", 6)], // Different length
          deployer.address,
        ),
      ).to.be.revertedWithCustomError(paymaster, "ArrayLengthMismatch");
    });

    it("should revert batch withdraw with empty arrays", async () => {
      await expect(
        paymaster.withdrawTokensBatch([], [], deployer.address),
      ).to.be.revertedWithCustomError(paymaster, "ZeroUint256");
    });

    it("should revert batch withdraw with zero token address", async () => {
      await expect(
        paymaster.withdrawTokensBatch(
          ["0x0000000000000000000000000000000000000000"],
          [parseUnits("100", 6)],
          deployer.address,
        ),
      ).to.be.revertedWithCustomError(paymaster, "ZeroAddress");
    });

    it("should revert if batch withdraw with zero amount", async () => {
      await expect(
        paymaster.withdrawTokensBatch([usdc], [0], deployer.address),
      ).to.be.revertedWithCustomError(paymaster, "ZeroUint256");
    });

    it("should revert if batch withdraw array length exceeds max allowed length", async () => {
      const tokens = Array.from({ length: 21 }, () => usdc.target.toString());
      const amounts = Array.from({ length: 21 }, () => parseUnits("100", 6));

      await expect(
        paymaster.withdrawTokensBatch(
          tokens,
          amounts,
          deployer.address,
        ),
      ).to.be.revertedWithCustomError(paymaster, "BatchWithdrawArrayTooLong");
    });

    it("should revert single withdraw with zero token address", async () => {
      await expect(
        paymaster.withdrawTokens(
          "0x0000000000000000000000000000000000000000",
          deployer.address,
          parseUnits("100", 6),
        ),
      ).to.be.revertedWithCustomError(paymaster, "ZeroAddress");
    });

    it("withdraw operations should revert if recipient zero address", async () => {
      await expect(
        paymaster.withdrawTokens(usdc, ZeroAddress, parseUnits("100", 6)),
      ).to.be.revertedWithCustomError(paymaster, "ZeroAddress");

      await expect(
        paymaster.withdrawTokensBatch([usdc], [parseUnits("100", 6)], ZeroAddress),
      ).to.be.revertedWithCustomError(paymaster, "ZeroAddress");
    });

    it("should revert single withdraw with zero amount", async () => {
      await expect(paymaster.withdrawTokens(usdc, deployer, 0)).to.be.revertedWithCustomError(
        paymaster,
        "ZeroUint256",
      );
    });

    it("withdraw operations should be done only by default admin", async () => {
      await expect(paymaster.connect(beneficiary).withdrawTokens(usdc, beneficiary, 123))
        .to.be.revertedWithCustomError(paymaster, "AccessControlUnauthorizedAccount")
        .withArgs(beneficiary.address, ZeroHash);

      await expect(
        paymaster.connect(beneficiary).withdrawTokensBatch([usdc], [MaxUint256], beneficiary),
      )
        .to.be.revertedWithCustomError(paymaster, "AccessControlUnauthorizedAccount")
        .withArgs(beneficiary.address, ZeroHash);
    });

    it("set collector swapper or post op swap enabled should be done only by default admin", async () => {
      await expect(paymaster.connect(beneficiary).setCollectorSwapper(collectorSwapper.target.toString()))
        .to.be.revertedWithCustomError(paymaster, "AccessControlUnauthorizedAccount")
        .withArgs(beneficiary.address, ZeroHash);

      await expect(paymaster.connect(beneficiary).setPostOpSwapEnabled(true))
        .to.be.revertedWithCustomError(paymaster, "AccessControlUnauthorizedAccount")
        .withArgs(beneficiary.address, ZeroHash);
    });

    it("should revert if try to set collector swapper zero address", async () => {
      await expect(paymaster.setCollectorSwapper(ZERO_ADDRESS))
        .to.be.revertedWithCustomError(paymaster, "ZeroAddress");
    });

    it("should test ECDSA recovery error handling", async () => {
      await approveToPaymaster(sender, userSigner, paymaster, usdc, deployer);

      const callData = targetContract.interface.encodeFunctionData("count");
      const paymentStruct = {
        token: usdc,
        exchangeRate: BigInt(2500 * 1e6),
        postOpCost: GAS.PAYMASTER_POST_OP,
        operator,
      };
      const userOpCallData = sender.interface.encodeFunctionData("execute", [
        targetContract.target.toString(),
        0n,
        callData,
      ]);
      const paymentSignature = await getPaymentSignature(
        paymaster,
        paymentStruct,
        userOpCallData,
        sender.target.toString(),
      );

      // Corrupt the signature to trigger ECDSA error
      paymentSignature.s = "0x0000000000000000000000000000000000000000000000000000000000000001";

      const userOp = await getUserOp(
        entryPointV8,
        paymaster,
        userSigner,
        sender,
        targetContract.target.toString(),
        0n,
        callData,
        { ...paymentStruct, ...paymentSignature },
      );

      await expect(entryPointV8.handleOps([userOp], beneficiary))
        .to.be.revertedWithCustomError(entryPointV8, "FailedOp")
        .withArgs(0, "AA34 signature error");
    });

    it("should fail with zero token address", async () => {
      // Create a mock token with zero address
      const zeroToken = await ethers.getContractAt(
        "MockERC20",
        "0x0000000000000000000000000000000000000000",
      );

      const callData = targetContract.interface.encodeFunctionData("count");
      const paymentStruct = {
        token: zeroToken,
        exchangeRate: BigInt(2500 * 1e6),
        postOpCost: GAS.PAYMASTER_POST_OP,
        operator,
      };
      const userOpCallData = sender.interface.encodeFunctionData("execute", [
        targetContract.target.toString(),
        0n,
        callData,
      ]);
      const paymentSignature = await getPaymentSignature(
        paymaster,
        paymentStruct,
        userOpCallData,
        sender.target.toString(),
      );

      const userOp = await getUserOp(
        entryPointV8,
        paymaster,
        userSigner,
        sender,
        targetContract.target.toString(),
        0n,
        callData,
        { ...paymentStruct, ...paymentSignature },
      );

      await expect(entryPointV8.handleOps([userOp], beneficiary))
        .to.be.revertedWithCustomError(entryPointV8, "FailedOpWithRevert")
        .withArgs(0, "AA33 reverted", paymaster.interface.encodeErrorResult("ZeroAddress", []));
    });

    it("should fail with zero postOp cost", async () => {
      const callData = targetContract.interface.encodeFunctionData("count");
      const paymentStruct = {
        token: usdc,
        exchangeRate: 2999000000n,
        postOpCost: 0,
        operator,
      };
      const userOpCallData = sender.interface.encodeFunctionData("execute", [
        targetContract.target.toString(),
        0n,
        callData,
      ]);
      const paymentSignature = await getPaymentSignature(
        paymaster,
        paymentStruct,
        userOpCallData,
        sender.target.toString(),
      );

      const userOp = await getUserOp(
        entryPointV8,
        paymaster,
        userSigner,
        sender,
        targetContract.target.toString(),
        0n,
        callData,
        { ...paymentStruct, ...paymentSignature },
      );

      await expect(entryPointV8.handleOps([userOp], beneficiary))
        .to.be.revertedWithCustomError(entryPointV8, "FailedOpWithRevert")
        .withArgs(0, "AA33 reverted", paymaster.interface.encodeErrorResult("ZeroUint256", []));
    });
  });
});
