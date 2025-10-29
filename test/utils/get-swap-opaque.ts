import { AbiCoder, BytesLike } from "ethers";
import { Uint256 } from "../../types";
import { getCurrentTimestamp } from "./get-current-timestamp";
import { DEFAULT_DEADLINE, DEFAULT_POOL_FEE } from "../constants";

export async function getSwapOpaque(
  deadline?: Uint256,
  poolFee?: Uint256,
): Promise<BytesLike> {
  if (!deadline) deadline = (await getCurrentTimestamp()) + DEFAULT_DEADLINE;
  if (!poolFee) poolFee = DEFAULT_POOL_FEE;

  const swapOpaque = AbiCoder.defaultAbiCoder().encode(
    ["uint256", "uint24"],
    [deadline, poolFee],
  );

  return swapOpaque;
}
