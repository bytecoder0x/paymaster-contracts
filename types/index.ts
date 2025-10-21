export type Uint256 = number | bigint;

export interface DeployConfig {
  owner: string;
  operator: string;
  entryPoints: string[];
}
