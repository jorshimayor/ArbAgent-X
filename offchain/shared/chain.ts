import { ethers } from "ethers";
import * as dotenv from "dotenv";
import { SKINBOOK_ABI } from "./abi.js";

dotenv.config();

export const env = {
  rpcUrl: process.env.RPC_URL ?? "http://127.0.0.1:8545",
  skinBookAddr: process.env.SKINBOOK_ADDR ?? "",
  chainId: Number(process.env.CHAIN_ID ?? 84532),
};

export function getProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(env.rpcUrl);
}

/** Read-only SkinBook contract. Returns null if no address is configured. */
export function getSkinBookRead(): ethers.Contract | null {
  if (!env.skinBookAddr) return null;
  return new ethers.Contract(env.skinBookAddr, SKINBOOK_ABI, getProvider());
}

/** SkinBook contract bound to a signer for writes (keeper / arbiter only). */
export function getSkinBookWrite(privateKey: string): ethers.Contract {
  if (!env.skinBookAddr) throw new Error("SKINBOOK_ADDR not set");
  const wallet = new ethers.Wallet(privateKey, getProvider());
  return new ethers.Contract(env.skinBookAddr, SKINBOOK_ABI, wallet);
}

export const USDC_DECIMALS = 6;
export const toUsdc = (n: number) => BigInt(Math.round(n * 10 ** USDC_DECIMALS));
export const fromUsdc = (v: bigint) => Number(v) / 10 ** USDC_DECIMALS;

// Booking status enum mirror (keep in sync with SkinBook.sol Status).
export const BOOKING_STATUS = [
  "None",
  "Booked",
  "Refunded",
  "NoShowClaimed",
  "Disputed",
  "Slashed",
] as const;
export type BookingStatus = (typeof BOOKING_STATUS)[number];
