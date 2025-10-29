import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers } from "hardhat";
import {
  CollectorSwapper,
  IEntryPoint,
  IEntryPoint__factory,
  IERC20,
  IERC20__factory,
  IPaymaster,
  SimpleAccount,
  SimpleAccount__factory,
  TokenPaymaster,
  TestCounter,
} from "../typechain-types";
import { getSwapOpaque, getPaymentSignature, getUserOp, setup, approveToPaymaster, getCurrentTimestamp } from "./utils";
import {
  BytesLike,
  HDNodeWallet,
  EventLog,
  TransactionReceipt,
  parseUnits,
  ZeroHash,
} from "ethers";
import { DEFAULT_DEADLINE, DEFAULT_POOL_FEE, FEES, GAS, WETH_TOKEN, ZERO_ADDRESS, ZERO_BYTES } from "./constants";
import { GasLimits, FeePerGas } from "./types";

describe("CollectorSwapper", () => {
  let paymaster: TokenPaymaster;
  let testPaymaster: SignerWithAddress;
  let collectorSwapper: CollectorSwapper;
  let usdc: IERC20;
  let weth: IERC20;
  let entryPointV8: IEntryPoint;
  let entryPointV7: IEntryPoint;
  let sender: SimpleAccount;
  let targetContract: TestCounter;
  let deployer: SignerWithAddress;
  let operator: SignerWithAddress;
  let userSigner: HDNodeWallet;
  let beneficiary: SignerWithAddress;
  let alice: SignerWithAddress;
  let binanceHotWallet: SignerWithAddress;
  let defaulOpaque: BytesLike;

  const handleOpsWithOpaque = async (opaque?: BytesLike): Promise<TransactionReceipt> => {
    const exchangeRate = BigInt(1 * 1e18); // pay fee with WETH
    const callData = targetContract.interface.encodeFunctionData("count");

    const swapOpaque = await getSwapOpaque();
    const paymentStruct = {
      token: weth,
      exchangeRate,
      postOpCost: GAS.PAYMASTER_POST_OP_WITH_SWAP,
      operator,
      opaque: opaque ? opaque : swapOpaque,
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

    const gasLimits = new GasLimits();
    gasLimits.paymasterPostOp = GAS.PAYMASTER_POST_OP_WITH_SWAP;
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

    const tx = await entryPointV8.handleOps([userOp], beneficiary);
    const receipt = await tx.wait();
    return receipt as TransactionReceipt;
  }

  beforeEach(async () => {
    const fixture = await loadFixture(setup);
    paymaster = fixture.paymaster;
    collectorSwapper = fixture.collectorSwapper;
    usdc = fixture.usdc;
    weth = fixture.weth;
    entryPointV8 = fixture.entryPointV8;
    entryPointV7 = fixture.entryPointV7;
    sender = fixture.sender;
    targetContract = fixture.targetContract;
    deployer = fixture.deployer;
    operator = fixture.operator;
    beneficiary = fixture.beneficiary;
    alice = fixture.alice;
    testPaymaster = fixture.testPaymaster;
    userSigner = fixture.userSigner;
    binanceHotWallet = fixture.binanceHotWallet;

    defaulOpaque = await getSwapOpaque();

    await approveToPaymaster(sender, userSigner, paymaster, weth, deployer);
  });
  

  describe("Main swap functionality with integrated paymaster", () => {
    it("swap should be skipped if the token is not enabled for swapping", async () => {
      await collectorSwapper.setTokenConfig(weth.target.toString(), { enabled: false, poolFee: DEFAULT_POOL_FEE });
      const receipt = await handleOpsWithOpaque();
      
      expect(receipt?.status).to.equal(1);

      const swapFailedEvent = receipt?.logs.find(
        log => log.topics[0] === collectorSwapper.interface.getEvent("SwapFailed").topicHash,
      );

      const swapSucceededEvent = receipt?.logs.find(
        log => log.topics[0] === collectorSwapper.interface.getEvent("SwapSucceeded").topicHash,
      );

      expect(swapSucceededEvent).to.be.undefined;
      expect(swapFailedEvent).to.be.undefined;
    });

    it("swap should be skipped if swap is disabled on paymaster", async () => {
      await paymaster.setPostOpSwapEnabled(false);
      const receipt = await handleOpsWithOpaque();
      
      expect(receipt?.status).to.equal(1);

      const swapFailedEvent = receipt?.logs.find(
        log => log.topics[0] === collectorSwapper.interface.getEvent("SwapFailed").topicHash,
      );

      const swapSucceededEvent = receipt?.logs.find(
        log => log.topics[0] === collectorSwapper.interface.getEvent("SwapSucceeded").topicHash,
      );

      expect(swapSucceededEvent).to.be.undefined;
      expect(swapFailedEvent).to.be.undefined;
    });

    it("swap should be performed successfully if swap and token are enabled on paymaster", async () => {
      const receipt = await handleOpsWithOpaque();
      
      expect(receipt?.status).to.equal(1);

      const swapFailedEvent = receipt?.logs.find(
        log => log.topics[0] === collectorSwapper.interface.getEvent("SwapFailed").topicHash,
      );

      const swapSucceededEvent = receipt?.logs.find(
        log => log.topics[0] === collectorSwapper.interface.getEvent("SwapSucceeded").topicHash,
      );

      expect(swapSucceededEvent).to.not.be.undefined;
      expect(swapFailedEvent).to.be.undefined;

      const tokenInFromEvent = ethers.getAddress("0x" + (swapSucceededEvent as any).topics[1].slice(26));
      
      const [amountInFromEvent, amountOutFromEvent] = ethers.AbiCoder.defaultAbiCoder().decode(
        ["uint256", "uint256"],
        (swapSucceededEvent as any).data
      );

      const balanceOfCanonicalToken = await usdc.balanceOf(paymaster.target.toString());
      const balanceOfTokenIn = await weth.balanceOf(paymaster.target.toString());

      expect(tokenInFromEvent).to.equal(weth.target.toString());
      expect(amountInFromEvent).to.greaterThan(0n);
      expect(amountOutFromEvent).to.greaterThan(0n);
      expect(balanceOfCanonicalToken).to.equal(amountOutFromEvent);
      expect(balanceOfTokenIn).to.equal(0n);
    });

    it("swap should be performed successfully with overridden pool fee", async () => {
      const now = await getCurrentTimestamp();
      // override pool fee to 3000
      const opaque = await getSwapOpaque(now + DEFAULT_DEADLINE, 3000);
      const receipt = await handleOpsWithOpaque(opaque);
      
      expect(receipt?.status).to.equal(1);

      const swapFailedEvent = receipt?.logs.find(
        log => log.topics[0] === collectorSwapper.interface.getEvent("SwapFailed").topicHash,
      );

      const swapSucceededEvent = receipt?.logs.find(
        log => log.topics[0] === collectorSwapper.interface.getEvent("SwapSucceeded").topicHash,
      );

      expect(swapSucceededEvent).to.not.be.undefined;
      expect(swapFailedEvent).to.be.undefined;

      const tokenInFromEvent = ethers.getAddress("0x" + (swapSucceededEvent as any).topics[1].slice(26));
      
      const [amountInFromEvent, amountOutFromEvent] = ethers.AbiCoder.defaultAbiCoder().decode(
        ["uint256", "uint256"],
        (swapSucceededEvent as any).data
      );

      const balanceOfCanonicalToken = await usdc.balanceOf(paymaster.target.toString());
      const balanceOfTokenIn = await weth.balanceOf(paymaster.target.toString());

      expect(tokenInFromEvent).to.equal(weth.target.toString());
      expect(amountInFromEvent).to.greaterThan(0n);
      expect(amountOutFromEvent).to.greaterThan(0n);
      expect(balanceOfCanonicalToken).to.equal(amountOutFromEvent);
      expect(balanceOfTokenIn).to.equal(0n);
    });

    it("if swap fails, the token should be returned to the paymaster", async () => {
      const now = await getCurrentTimestamp();
      const opaque = await getSwapOpaque(now - 1); // deadline in the past
      const receipt = await handleOpsWithOpaque(opaque);
      
      expect(receipt?.status).to.equal(1);

      const swapFailedEvent = receipt?.logs.find(
        log => log.topics[0] === collectorSwapper.interface.getEvent("SwapFailed").topicHash,
      );

      const swapSucceededEvent = receipt?.logs.find(
        log => log.topics[0] === collectorSwapper.interface.getEvent("SwapSucceeded").topicHash,
      );

      expect(swapSucceededEvent).to.be.undefined;
      expect(swapFailedEvent).to.not.be.undefined;

      const tokenInFromEvent = ethers.getAddress("0x" + (swapFailedEvent as any).topics[1].slice(26));
      const [amountInFromEvent, errorData] = ethers.AbiCoder.defaultAbiCoder().decode(
        ["uint256", "bytes"],
        (swapFailedEvent as any).data
      );
      const errorParams = ethers.AbiCoder.defaultAbiCoder().decode(
        ["string"],
        ethers.dataSlice(errorData, 4)
      );
      const errorMessage = errorParams[0];

      const balanceOfCanonicalToken = await usdc.balanceOf(paymaster.target.toString());
      const balanceOfTokenIn = await weth.balanceOf(paymaster.target.toString());

      expect(tokenInFromEvent).to.equal(weth.target.toString());
      expect(amountInFromEvent).to.greaterThan(0n);
      expect(balanceOfCanonicalToken).to.equal(0n);
      expect(balanceOfTokenIn).to.equal(amountInFromEvent);
      expect(errorMessage).to.equal("Transaction too old");
    });
  });

  describe("Validation and failure paths of swap functionality", () => {
    beforeEach(async () => {
      // only for easier testing
      await collectorSwapper.setPaymaster(testPaymaster.address);
    });

    it("swap should be called only by paymaster", async () => {
      await expect(
        collectorSwapper.connect(alice).postOpHandle(ZERO_BYTES, usdc.target.toString(), 0n),
      ).to.be.revertedWithCustomError(collectorSwapper, "Unauthorized");
    });

    it("swap should be prevented if the token in is zero address. BUT NOT REVERT", async () => {
      const tx = await collectorSwapper.connect(testPaymaster).postOpHandle(ZERO_BYTES, ZERO_ADDRESS, 0n);
      const receipt = await tx.wait();
      
      expect(receipt?.status).to.equal(1);

      const swapFailedEvent = receipt?.logs.find(
        log => log.topics[0] === collectorSwapper.interface.getEvent("SwapFailed").topicHash,
      );

      expect(swapFailedEvent).to.not.be.undefined;

      const failedTokenIn = (swapFailedEvent as EventLog).args[0];
      const failedAmountIn = (swapFailedEvent as EventLog).args[1];
      const failedErrorData = (swapFailedEvent as EventLog).args[2];

      const actualErrorSelector = ethers.dataSlice(failedErrorData, 0, 4);
      const expectedErrorSelector = ethers.id("ZeroAddress()").slice(0, 10);

      expect(failedTokenIn).to.equal(ZERO_ADDRESS);
      expect(failedAmountIn).to.equal(0n);
      expect(actualErrorSelector).to.equal(expectedErrorSelector);
    });

    it("swap should be prevented if the opaque length is not equal to target length (96 bytes). BUT NOT REVERT", async () => {
      const tx = await collectorSwapper.connect(testPaymaster).postOpHandle(ZERO_BYTES, weth.target.toString(), 0n);
      const receipt = await tx.wait();
      
      expect(receipt?.status).to.equal(1);

      const swapFailedEvent = receipt?.logs.find(
        log => log.topics[0] === collectorSwapper.interface.getEvent("SwapFailed").topicHash,
      );

      expect(swapFailedEvent).to.not.be.undefined;

      const failedTokenIn = (swapFailedEvent as EventLog).args[0];
      const failedAmountIn = (swapFailedEvent as EventLog).args[1];
      const failedErrorData = (swapFailedEvent as EventLog).args[2];

      const actualErrorSelector = ethers.dataSlice(failedErrorData, 0, 4);
      const expectedErrorSelector = ethers.id("InvalidOpaqueLength(uint256)").slice(0, 10);

      const errorParams = ethers.AbiCoder.defaultAbiCoder().decode(
        ["uint256"],
        ethers.dataSlice(failedErrorData, 4)
      );
      const actualOpaqueLength = errorParams[0];

      expect(failedTokenIn).to.equal(weth.target.toString());
      expect(failedAmountIn).to.equal(0n);
      expect(actualErrorSelector).to.equal(expectedErrorSelector);
      expect(actualOpaqueLength).to.equal(0n);
    });

    it("swap should be prevented if the contract is paused. BUT NOT REVERT", async () => {
      await collectorSwapper.pause();
      const tx = await collectorSwapper.connect(testPaymaster).postOpHandle(defaulOpaque, weth.target.toString(), 0n);
      const receipt = await tx.wait();
      
      expect(receipt?.status).to.equal(1);

      const swapFailedEvent = receipt?.logs.find(
        log => log.topics[0] === collectorSwapper.interface.getEvent("SwapFailed").topicHash,
      );

      expect(swapFailedEvent).to.not.be.undefined;

      const failedTokenIn = (swapFailedEvent as EventLog).args[0];
      const failedAmountIn = (swapFailedEvent as EventLog).args[1];
      const failedErrorData = (swapFailedEvent as EventLog).args[2];

      const actualErrorSelector = ethers.dataSlice(failedErrorData, 0, 4);
      const expectedErrorSelector = ethers.id("EnforcedPause()").slice(0, 10);

      expect(failedTokenIn).to.equal(weth.target.toString());
      expect(failedAmountIn).to.equal(0n);
      expect(actualErrorSelector).to.equal(expectedErrorSelector);
    });

    it("swap should be prevented if token in is the same as canonical token. BUT NOT REVERT", async () => {
      const tx = await collectorSwapper.connect(testPaymaster).postOpHandle(defaulOpaque, usdc.target.toString(), 0n);
      const receipt = await tx.wait();
      
      expect(receipt?.status).to.equal(1);

      const swapFailedEvent = receipt?.logs.find(
        log => log.topics[0] === collectorSwapper.interface.getEvent("SwapFailed").topicHash,
      );

      expect(swapFailedEvent).to.not.be.undefined;

      const failedTokenIn = (swapFailedEvent as EventLog).args[0];
      const failedAmountIn = (swapFailedEvent as EventLog).args[1];
      const failedErrorData = (swapFailedEvent as EventLog).args[2];

      const actualErrorSelector = ethers.dataSlice(failedErrorData, 0, 4);
      const expectedErrorSelector = ethers.id("TokenIsCanonical()").slice(0, 10);

      expect(failedTokenIn).to.equal(usdc.target.toString());
      expect(failedAmountIn).to.equal(0n);
      expect(actualErrorSelector).to.equal(expectedErrorSelector);
    });

    it("swap should be prevented if token in is not enabled for swapping. BUT NOT REVERT", async () => {
      await collectorSwapper.setTokenConfig(weth.target.toString(), { enabled: false, poolFee: 500 });
      const tx = await collectorSwapper.connect(testPaymaster).postOpHandle(defaulOpaque, weth.target.toString(), 0n);
      const receipt = await tx.wait();
      
      expect(receipt?.status).to.equal(1);

      const swapFailedEvent = receipt?.logs.find(
        log => log.topics[0] === collectorSwapper.interface.getEvent("SwapFailed").topicHash,
      );

      expect(swapFailedEvent).to.not.be.undefined;

      const failedTokenIn = (swapFailedEvent as EventLog).args[0];
      const failedAmountIn = (swapFailedEvent as EventLog).args[1];
      const failedErrorData = (swapFailedEvent as EventLog).args[2];

      const actualErrorSelector = ethers.dataSlice(failedErrorData, 0, 4);
      const expectedErrorSelector = ethers.id("UnsupportedToken(address)").slice(0, 10);
      const errorParams = ethers.AbiCoder.defaultAbiCoder().decode(
        ["address"],
        ethers.dataSlice(failedErrorData, 4)
      );
      const actualToken = errorParams[0];

      expect(failedTokenIn).to.equal(weth.target.toString());
      expect(actualToken).to.equal(weth.target.toString());
      expect(failedAmountIn).to.equal(0n);
      expect(actualErrorSelector).to.equal(expectedErrorSelector);
    });

    it("swap should be prevented if deadline is in the past. BUT NOT REVERT", async () => {
      const now = await getCurrentTimestamp();
      const opaque = await getSwapOpaque(now - 1);
      const amountIn = parseUnits("1", 18);
      
      await weth.connect(binanceHotWallet).transfer(testPaymaster.address, amountIn);
      await weth.connect(testPaymaster).approve(collectorSwapper.target.toString(), amountIn);

      const tx = await collectorSwapper.connect(testPaymaster).postOpHandle(opaque, weth.target.toString(), amountIn);
      const receipt = await tx.wait();
      
      expect(receipt?.status).to.equal(1);

      const swapFailedEvent = receipt?.logs.find(
        log => log.topics[0] === collectorSwapper.interface.getEvent("SwapFailed").topicHash,
      );

      expect(swapFailedEvent).to.not.be.undefined;

      const failedTokenIn = (swapFailedEvent as EventLog).args[0];
      const failedAmountIn = (swapFailedEvent as EventLog).args[1];
      const failedErrorData = (swapFailedEvent as EventLog).args[2];

      const actualErrorSelector = ethers.dataSlice(failedErrorData, 0, 4);
      // in uni v3 router `require`, that means error is `Error(string)`
      const expectedErrorSelector = ethers.id("Error(string)").slice(0, 10);

      // decode the error message
      const errorParams = ethers.AbiCoder.defaultAbiCoder().decode(
        ["string"],
        ethers.dataSlice(failedErrorData, 4)
      );
      const errorMessage = errorParams[0];

      expect(failedTokenIn).to.equal(weth.target.toString());
      expect(failedAmountIn).to.equal(amountIn);
      expect(actualErrorSelector).to.equal(expectedErrorSelector);
      expect(errorMessage).to.equal("Transaction too old");
    });

    it("swap should be prevented if amount out from quote is 0. BUT NOT REVERT", async () => {
      const opaque = await getSwapOpaque();
      const amountIn = 1n // to little to swap, possible swap is not possible, amount out will be 0
      
      await weth.connect(binanceHotWallet).transfer(testPaymaster.address, amountIn);
      await weth.connect(testPaymaster).approve(collectorSwapper.target.toString(), amountIn);

      const tx = await collectorSwapper.connect(testPaymaster).postOpHandle(opaque, weth.target.toString(), amountIn);
      const receipt = await tx.wait();

      const swapFailedEvent = receipt?.logs.find(
        log => log.topics[0] === collectorSwapper.interface.getEvent("SwapFailed").topicHash,
      );

      expect(swapFailedEvent).to.not.be.undefined;

      const failedTokenIn = (swapFailedEvent as EventLog).args[0];
      const failedAmountIn = (swapFailedEvent as EventLog).args[1];
      const failedErrorData = (swapFailedEvent as EventLog).args[2];

      const actualErrorSelector = ethers.dataSlice(failedErrorData, 0, 4);
      const expectedErrorSelector = ethers.id("InvalidAmountOut()").slice(0, 10);

      expect(failedTokenIn).to.equal(weth.target.toString());
      expect(failedAmountIn).to.equal(amountIn);
      expect(actualErrorSelector).to.equal(expectedErrorSelector);
    });

    it("swap should be prevented if specified pool fee tier is not supported. BUT NOT REVERT", async () => {
      const now = await getCurrentTimestamp();
      // 301315 is not supported pool fee tier
      const opaque = await getSwapOpaque(now + DEFAULT_DEADLINE, 301315);
      const amountIn = parseUnits("1", 18);
      
      await weth.connect(binanceHotWallet).transfer(testPaymaster.address, amountIn);
      await weth.connect(testPaymaster).approve(collectorSwapper.target.toString(), amountIn);

      const tx = await collectorSwapper.connect(testPaymaster).postOpHandle(opaque, weth.target.toString(), amountIn);
      const receipt = await tx.wait();

      const swapFailedEvent = receipt?.logs.find(
        log => log.topics[0] === collectorSwapper.interface.getEvent("SwapFailed").topicHash,
      );

      expect(swapFailedEvent).to.not.be.undefined;

      const failedTokenIn = (swapFailedEvent as EventLog).args[0];
      const failedAmountIn = (swapFailedEvent as EventLog).args[1];
      const failedErrorData = (swapFailedEvent as EventLog).args[2];

      // empty bytes since uni v3 dont have check for pool fee tier
      // and try to perform swap with unsupported pool fee tier
      // so it will revert with empty bytes
      expect(failedErrorData).to.equal(ZERO_BYTES);
      expect(failedTokenIn).to.equal(weth.target.toString());
      expect(failedAmountIn).to.equal(amountIn);
    });
  });

  describe("Admin and storage functionality", () => {
    it("only admin can set token config, pause, unpause, set canonical token, router, slippage and paymaster", async () => {
      const ADMIN_ROLE = await collectorSwapper.DEFAULT_ADMIN_ROLE();

      await expect(
        collectorSwapper
          .connect(alice)
          .setTokenConfig(weth.target.toString(), { enabled: true, poolFee: DEFAULT_POOL_FEE }),
      )
        .to.be.revertedWithCustomError(collectorSwapper, "AccessControlUnauthorizedAccount")
        .withArgs(alice.address, ADMIN_ROLE);

      await expect(collectorSwapper.connect(alice).pause())
        .to.be.revertedWithCustomError(collectorSwapper, "AccessControlUnauthorizedAccount")
        .withArgs(alice.address, ADMIN_ROLE);

      await expect(collectorSwapper.connect(alice).unpause())
        .to.be.revertedWithCustomError(collectorSwapper, "AccessControlUnauthorizedAccount")
        .withArgs(alice.address, ADMIN_ROLE);

      await expect(collectorSwapper.connect(alice).setCanonicalToken(weth.target.toString()))
        .to.be.revertedWithCustomError(collectorSwapper, "AccessControlUnauthorizedAccount")
        .withArgs(alice.address, ADMIN_ROLE);

      await expect(collectorSwapper.connect(alice).setRouter(weth.target.toString()))
        .to.be.revertedWithCustomError(collectorSwapper, "AccessControlUnauthorizedAccount")
        .withArgs(alice.address, ADMIN_ROLE);

      await expect(collectorSwapper.connect(alice).setPaymaster(weth.target.toString()))
        .to.be.revertedWithCustomError(collectorSwapper, "AccessControlUnauthorizedAccount")
        .withArgs(alice.address, ADMIN_ROLE);

      await expect(collectorSwapper.connect(alice).setQuoter(weth.target.toString()))
        .to.be.revertedWithCustomError(collectorSwapper, "AccessControlUnauthorizedAccount")
        .withArgs(alice.address, ADMIN_ROLE);

      await expect(collectorSwapper.connect(alice).setSlippageBps(100))
        .to.be.revertedWithCustomError(collectorSwapper, "AccessControlUnauthorizedAccount")
        .withArgs(alice.address, ADMIN_ROLE);
    });

    it("admin can set token config, pause, unpause, set canonical token, paymaster, router and quoter", async () => {
      const newToken = await ethers.deployContract("MockERC20", []);
      await collectorSwapper.connect(deployer).setTokenConfig(newToken.target.toString(), { enabled: true, poolFee: DEFAULT_POOL_FEE });
      const tokenConfig = await collectorSwapper.getTokenConfig(newToken.target.toString());

      expect(await collectorSwapper.isTokenEnabled(newToken.target.toString())).to.be.true;
      expect(tokenConfig.enabled).to.be.true;
      expect(tokenConfig.poolFee).to.equal(DEFAULT_POOL_FEE);

      await collectorSwapper.connect(deployer).pause();
      expect(await collectorSwapper.paused()).to.be.true;
      await collectorSwapper.connect(deployer).unpause();
      expect(await collectorSwapper.paused()).to.be.false;

      await collectorSwapper.connect(deployer).setCanonicalToken(weth.target.toString());
      const canonicalToken = await collectorSwapper.canonicalToken();
      expect(canonicalToken).to.equal(weth.target.toString());

      await collectorSwapper.connect(deployer).setRouter(targetContract.target.toString());
      const router = await collectorSwapper.router();
      expect(router).to.equal(targetContract.target.toString());

      await collectorSwapper.connect(deployer).setPaymaster(testPaymaster.address);
      const paymaster = await collectorSwapper.paymaster();
      expect(paymaster).to.equal(testPaymaster.address);

      await collectorSwapper.connect(deployer).setQuoter(targetContract.target.toString());
      const quoter = await collectorSwapper.quoter();
      expect(quoter).to.equal(targetContract.target.toString());

      await collectorSwapper.connect(deployer).setSlippageBps(100);
      const slippage = await collectorSwapper.slippageBps();
      expect(slippage).to.equal(100);
    });

    it("should prevent setting invalid arguments for canonical token, router, paymaster, quoter, slippage or token config", async () => {
      await expect(collectorSwapper.connect(deployer).setCanonicalToken(ZERO_ADDRESS))
        .to.be.revertedWithCustomError(collectorSwapper, "ZeroAddress");

      await expect(collectorSwapper.connect(deployer).setRouter(ZERO_ADDRESS))
        .to.be.revertedWithCustomError(collectorSwapper, "ZeroAddress");

      await expect(collectorSwapper.connect(deployer).setPaymaster(ZERO_ADDRESS))
        .to.be.revertedWithCustomError(collectorSwapper, "ZeroAddress");

      await expect(collectorSwapper.connect(deployer).setQuoter(ZERO_ADDRESS))
        .to.be.revertedWithCustomError(collectorSwapper, "ZeroAddress");

      await expect(collectorSwapper.connect(deployer).setSlippageBps(0))
        .to.be.revertedWithCustomError(collectorSwapper, "InvalidSlippage");

      await expect(collectorSwapper.connect(deployer).setSlippageBps(10001))
        .to.be.revertedWithCustomError(collectorSwapper, "InvalidSlippage");

      await expect(collectorSwapper.connect(deployer).setTokenConfig(ZERO_ADDRESS, { enabled: true, poolFee: DEFAULT_POOL_FEE }))
        .to.be.revertedWithCustomError(collectorSwapper, "InvalidTokenConfig");

      await expect(collectorSwapper.connect(deployer).setTokenConfig(weth.target.toString(), { enabled: true, poolFee: 0 }))
        .to.be.revertedWithCustomError(collectorSwapper, "InvalidTokenConfig");

      await expect(ethers.deployContract("CollectorSwapper", [ZERO_ADDRESS, weth.target.toString(), targetContract.target.toString(), targetContract.target.toString(), deployer.address]))
        .to.be.revertedWithCustomError(collectorSwapper, "ZeroAddress");

      await expect(ethers.deployContract("CollectorSwapper", [weth.target.toString(), ZERO_ADDRESS, targetContract.target.toString(), targetContract.target.toString(), deployer.address]))
        .to.be.revertedWithCustomError(collectorSwapper, "ZeroAddress");

      await expect(ethers.deployContract("CollectorSwapper", [weth.target.toString(), targetContract.target.toString(), ZERO_ADDRESS, targetContract.target.toString(), deployer.address]))
        .to.be.revertedWithCustomError(collectorSwapper, "ZeroAddress");

      await expect(ethers.deployContract("CollectorSwapper", [weth.target.toString(), targetContract.target.toString(), targetContract.target.toString(), ZERO_ADDRESS, deployer.address]))
        .to.be.revertedWithCustomError(collectorSwapper, "ZeroAddress");

      await expect(ethers.deployContract("CollectorSwapper", [weth.target.toString(), targetContract.target.toString(), targetContract.target.toString(), targetContract.target.toString(), ZERO_ADDRESS]))
        .to.be.revertedWithCustomError(collectorSwapper, "ZeroAddress");
    });
  });
});
