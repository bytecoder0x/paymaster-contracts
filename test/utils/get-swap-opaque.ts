import { AbiCoder, BytesLike } from "ethers";
import { Uint256 } from "../../types";
import { getCurrentTimestamp } from "./get-current-timestamp";
import { DEFAULT_AMOUNT_OUT_MIN, DEFAULT_DEADLINE, DEFAULT_POOL_FEE } from "../constants";

export async function getSwapOpaque(
  amountOutMin?: Uint256,
  deadline?: Uint256,
  poolFee?: Uint256,
): Promise<BytesLike> {
  if (!amountOutMin) amountOutMin = DEFAULT_AMOUNT_OUT_MIN;
  if (!deadline) deadline = (await getCurrentTimestamp()) + DEFAULT_DEADLINE;
  if (!poolFee) poolFee = DEFAULT_POOL_FEE;
  
  const swapOpaque = AbiCoder.defaultAbiCoder().encode(
    ["uint256", "uint256", "uint24"],
    [amountOutMin, deadline, poolFee],
  );

  return swapOpaque;
}
