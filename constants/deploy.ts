import { DeployConfig } from "../types";

export const DEPLOY_CONSTANTS: Record<string, DeployConfig> = {
  mainnet: {
    owner: "0x0000000000000000000000000000000000000000",
    operator: "0x0000000000000000000000000000000000000000",
    entryPoint: "0x4337084d9e255ff0702461cf8895ce9e3b5ff108",
    postOpCost: 20000,
  },
  sepolia: {
    owner: "0x0000000000000000000000000000000000000000",
    operator: "0x0000000000000000000000000000000000000000",
    entryPoint: "0x4337084d9e255ff0702461cf8895ce9e3b5ff108",
    postOpCost: 20000,
  },
};
