// This setup uses Hardhat Ignition to manage smart contract deployments.
// Learn more about it at https://hardhat.org/ignition

import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { DEPLOY_CONSTANTS } from "../../constants";
import { network } from "hardhat";

const TokenPaymasterModule = buildModule("TokenPaymasterModule", m => {
  const { owner, operator, entryPoint } = DEPLOY_CONSTANTS[network.name];
  const paymaster = m.contract("TokenPaymaster", [owner, operator, entryPoint.v8]);

  return { paymaster };
});

export default TokenPaymasterModule;
