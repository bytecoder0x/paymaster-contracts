import { parseUnits, Wallet, EventLog } from "ethers";
import { ethers } from "hardhat";
import {
  BINANCE_HOT_WALLET_ADDRESS,
  ENTRY_POINT_V08,
  ENTRY_POINT_V07,
  USDC_TOKEN,
  WETH_TOKEN,
  UNISWAP_V3_ROUTER,
  DEFAULT_POOL_FEE,
  UNISWAP_V3_QUOTER,
} from "../constants";
import {
  IEntryPoint__factory,
  IERC20__factory,
  SimpleAccount__factory,
} from "../../typechain-types";

export const setup = async () => {
  const [deployer, operator, beneficiary, alice, testPaymaster] = await ethers.getSigners();
  const userSigner = Wallet.createRandom(deployer.provider);
  const binanceHotWallet = await ethers.getImpersonatedSigner(BINANCE_HOT_WALLET_ADDRESS);

  const entryPointV8 = IEntryPoint__factory.connect(ENTRY_POINT_V08, deployer);
  const entryPointV7 = IEntryPoint__factory.connect(ENTRY_POINT_V07, deployer);
  const usdc = IERC20__factory.connect(USDC_TOKEN, deployer);
  const weth = IERC20__factory.connect(WETH_TOKEN, deployer);

  const accountFactory = await ethers.deployContract("SimpleAccountFactory", [entryPointV8]);
  const tx = await accountFactory.createAccount(userSigner, 123n);
  const res = await tx.wait();
  const sender = SimpleAccount__factory.connect((res?.logs[3] as EventLog).args[0], userSigner);

  const paymaster = await ethers.deployContract("TokenPaymaster", [
    deployer,
    operator,
    [ENTRY_POINT_V07, ENTRY_POINT_V08],
  ]);

  await Promise.all([
    await entryPointV7.depositTo(paymaster, { value: parseUnits("100") }),
    await entryPointV8.depositTo(paymaster, { value: parseUnits("100") }),
    await paymaster.addStake(entryPointV7, 1, { value: parseUnits("100") }),
    await paymaster.addStake(entryPointV8, 1, { value: parseUnits("100") }),
  ]);

  const targetContract = await ethers.deployContract("TestCounter");

  const collectorSwapper = await ethers.deployContract("CollectorSwapper", [
    paymaster.target.toString(),
    USDC_TOKEN,
    UNISWAP_V3_ROUTER,
    UNISWAP_V3_QUOTER,
    deployer.address,
  ]);

  await paymaster.setCollectorSwapper(collectorSwapper.target.toString());
  await collectorSwapper.setPaymaster(paymaster.target.toString());
  await paymaster.setPostOpSwapEnabled(true);
  await collectorSwapper.setTokenConfig(WETH_TOKEN, {
    enabled: true,
    poolFee: DEFAULT_POOL_FEE,
  });

  await usdc.connect(binanceHotWallet).transfer(sender, parseUnits("1000", 6));
  await weth.connect(binanceHotWallet).transfer(sender, parseUnits("10", 18));

  return {
    paymaster,
    collectorSwapper,
    usdc,
    weth,
    entryPointV7,
    entryPointV8,
    sender,
    targetContract,
    deployer,
    operator,
    beneficiary,
    alice,
    testPaymaster,
    userSigner,
    binanceHotWallet,
  };
};
