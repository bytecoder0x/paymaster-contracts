export type Uint256 = number | bigint;

export interface DeployConfig {
  owner: string;
  operator: string;
  entryPoint: { v7: string; v8: string };
}
