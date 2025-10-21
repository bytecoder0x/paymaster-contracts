import { DeployConfig } from "../types";
import { entryPoint07Address, entryPoint08Address } from "viem/_types/account-abstraction";

export const DEPLOY_CONSTANTS: Record<string, DeployConfig> = {
  mainnet: {
    owner: "0x0000000000000000000000000000000000000000",
    operator: "0x0000000000000000000000000000000000000000", // prod operator
    entryPoints: [entryPoint07Address, entryPoint08Address],
  },
  polygon: {
    owner: "0x0000000000000000000000000000000000000000",
    operator: "0x0000000000000000000000000000000000000000", // prod operator
    entryPoints: [entryPoint07Address, entryPoint08Address],
  },
  sepolia: {
    owner: "0x0000000000000000000000000000000000000000",
    operator: "0x0000000000000000000000000000000000000000",
    entryPoints: [entryPoint07Address, entryPoint08Address],
  },
  katana: {
    owner: "0x0000000000000000000000000000000000000000",
    operator: "0x0000000000000000000000000000000000000000", // prod operator
    entryPoints: [entryPoint07Address, entryPoint08Address],
  },
};
