import { BytesLike } from "ethers";
import { IERC20 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { FEES, GAS } from "./constants";

export type Uint256 = number | bigint;

export interface PaymasterPaymentDataStruct {
  token: IERC20;
  tokenPriceWei: Uint256; // Still uint256 in tests, will be cast to uint64 in encoding
  operator: SignerWithAddress;
}

export interface PaymasterPaymentDataStructSigned extends PaymasterPaymentDataStruct {
  nonce: Uint256; // Still uint256 in tests, will be cast to uint32 in encoding
  deadline: Uint256; // Still uint256 in tests, will be cast to uint32 in encoding
  v: Uint256;
  r: BytesLike;
  s: BytesLike;
}

export interface PackedUserOperationUnsigned {
  sender: string;
  initCode: BytesLike;
  callData: BytesLike;
  accountGasLimits: BytesLike;
  preVerificationGas: Uint256;
  gasFees: BytesLike;
  paymasterAndData: BytesLike;
}

export class GasLimits {
  call: Uint256;
  verification: Uint256;
  preVerification: Uint256;
  paymasterVerification: Uint256;
  paymasterPostOp: Uint256;

  constructor(options: Partial<GasLimits> = {}) {
    this.call = options.call ?? GAS.CALL;
    this.verification = options.verification ?? GAS.VERIFICATION;
    this.preVerification = options.preVerification ?? GAS.PRE_VERIFICATION;
    this.paymasterVerification = options.paymasterVerification ?? GAS.PAYMASTER_VERIFICATION;
    this.paymasterPostOp = options.paymasterPostOp ?? GAS.PAYMASTER_POST_OP;
  }
}

export class FeePerGas {
  maxFeePerGas: Uint256;
  maxPriorityFeePerGas: Uint256;

  constructor(options: Partial<FeePerGas> = {}) {
    this.maxFeePerGas = options.maxFeePerGas ?? FEES.MAX_FEE_PER_GAS;
    this.maxPriorityFeePerGas = options.maxPriorityFeePerGas ?? FEES.MAX_PRIORITY_FEE_PER_GAS;
  }
}
