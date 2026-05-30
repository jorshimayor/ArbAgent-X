import { ethers } from "ethers";
import * as dotenv from "dotenv";
import { PROOFSTAKE_ABI } from "./abi.js";

dotenv.config();

export const env = {
  rpcUrl: process.env.RPC_URL ?? "http://127.0.0.1:8545",
  proofStakeAddr: process.env.PROOFSTAKE_ADDR ?? "",
  chainId: Number(process.env.CHAIN_ID ?? 84532),
  evidenceBaseUrl: process.env.EVIDENCE_BASE_URL ?? "http://127.0.0.1:4100",
};

export function getProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(env.rpcUrl);
}

/** Read-only ProofStake contract. Returns null if no address is configured. */
export function getProofStakeRead(): ethers.Contract | null {
  if (!env.proofStakeAddr) return null;
  return new ethers.Contract(env.proofStakeAddr, PROOFSTAKE_ABI, getProvider());
}

/** ProofStake contract bound to a signer for writes. */
export function getProofStakeWrite(privateKey: string): ethers.Contract {
  if (!env.proofStakeAddr) throw new Error("PROOFSTAKE_ADDR not set");
  const wallet = new ethers.Wallet(privateKey, getProvider());
  return new ethers.Contract(env.proofStakeAddr, PROOFSTAKE_ABI, wallet);
}

export const USDC_DECIMALS = 6;
export const toUsdc = (n: number) => BigInt(Math.round(n * 10 ** USDC_DECIMALS));
export const fromUsdc = (v: bigint) => Number(v) / 10 ** USDC_DECIMALS;
