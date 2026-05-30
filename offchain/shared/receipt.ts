import { ethers } from "ethers";
import type { AgentReceipt, TaskRequest } from "./types.js";

/** bytes32 request id derived from the request + a nonce/timestamp. */
export function makeRequestId(req: TaskRequest, nonce: string): string {
  return ethers.id(`${req.kind}:${req.input}:${nonce}`);
}

/** bytes32 hash of the agent's claimed output. */
export function outputHash(output: string): string {
  return ethers.id(output);
}

/** The digest the agent signs: ties (agentId, requestId, outputHash) together. */
export function receiptDigest(agentId: number, requestId: string, outHash: string): string {
  return ethers.solidityPackedKeccak256(
    ["uint256", "bytes32", "bytes32"],
    [agentId, requestId, outHash]
  );
}

export async function signReceipt(
  wallet: ethers.Wallet,
  agentId: number,
  requestId: string,
  output: string
): Promise<AgentReceipt> {
  const outHash = outputHash(output);
  const digest = receiptDigest(agentId, requestId, outHash);
  const signature = await wallet.signMessage(ethers.getBytes(digest));
  return { agentId, requestId, outputHash: outHash, signer: wallet.address, signature };
}

/** Verify a receipt's signature and that it matches the claimed output. */
export function verifyReceipt(receipt: AgentReceipt, output: string): boolean {
  if (outputHash(output) !== receipt.outputHash) return false;
  const digest = receiptDigest(receipt.agentId, receipt.requestId, receipt.outputHash);
  const recovered = ethers.verifyMessage(ethers.getBytes(digest), receipt.signature);
  return recovered.toLowerCase() === receipt.signer.toLowerCase();
}
