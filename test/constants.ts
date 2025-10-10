import { parseUnits } from "ethers";

export const SIGNATURE_VALIDITY = 3600; // 1h

export const GAS = {
  CALL: 80_000n,
  VERIFICATION: 50_000n,
  PRE_VERIFICATION: 50_000n,
  PAYMASTER_VERIFICATION: 150_000n, // Increased for optimized structure
  PAYMASTER_POST_OP: 100_000n,
};

export const FEES = {
  MAX_FEE_PER_GAS: parseUnits("10", "gwei"),
  MAX_PRIORITY_FEE_PER_GAS: parseUnits("100", "gwei"),
};
