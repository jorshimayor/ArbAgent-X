import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { getProofStakeWrite, getProvider, env, fromUsdc } from "../shared/chain.js";
import { ERC20_ABI } from "../shared/abi.js";

dotenv.config();

const CLIENT_KEY = process.env.CLIENT_PRIVATE_KEY ?? "";

/**
 * Open a challenge against an agent: stake the challenger bond and submit the
 * evidence URI. The bond must be approved to ProofStake first. Returns the new
 * challengeId so the verifier can resolve it.
 */
export async function openChallenge(
  agentId: number,
  requestId: string,
  evidenceURI: string
): Promise<{ challengeId: number; txHash: string }> {
  if (!CLIENT_KEY) throw new Error("CLIENT_PRIVATE_KEY not set");
  const ps = getProofStakeWrite(CLIENT_KEY);
  const wallet = new ethers.Wallet(CLIENT_KEY, getProvider());

  const bond: bigint = await ps.minChallengerBond();
  const usdcAddr: string = await ps.usdc();
  const usdc = new ethers.Contract(usdcAddr, ERC20_ABI, wallet);

  const bal: bigint = await usdc.balanceOf(wallet.address);
  if (bal < bond) {
    throw new Error(
      `challenger needs >= ${fromUsdc(bond)} USDC (has ${fromUsdc(bal)}). Top up ${wallet.address}.`
    );
  }

  console.log(`[challenge] approving ${fromUsdc(bond)} USDC challenger bond...`);
  await (await usdc.approve(env.proofStakeAddr, bond)).wait();

  console.log(`[challenge] opening challenge against agent #${agentId} (req ${requestId})...`);
  const tx = await ps.challenge(agentId, requestId, evidenceURI, bond);
  const rc = await tx.wait();

  // Read the id from the ChallengeOpened event — a post-tx challengeCount() read
  // can lag on public RPC replicas and return a stale value.
  let challengeId = -1;
  for (const log of rc?.logs ?? []) {
    try {
      const parsed = ps.interface.parseLog(log);
      if (parsed?.name === "ChallengeOpened") {
        challengeId = Number(parsed.args.challengeId);
        break;
      }
    } catch {
      /* not one of our events */
    }
  }
  if (challengeId < 0) challengeId = Number(await ps.challengeCount());

  console.log(`[challenge] opened challenge #${challengeId} in tx ${rc?.hash}`);
  return { challengeId, txHash: rc?.hash ?? tx.hash };
}

// CLI: `tsx scripts/challenge.ts <agentId> <requestId> <evidenceURI>`
if (process.argv[1] && process.argv[1].endsWith("challenge.ts")) {
  const [agentId, requestId, evidenceURI] = process.argv.slice(2);
  if (!agentId || !requestId || !evidenceURI) {
    console.error("usage: tsx scripts/challenge.ts <agentId> <requestId> <evidenceURI>");
    process.exit(1);
  }
  openChallenge(Number(agentId), requestId, evidenceURI)
    .then((r) => console.log(`challengeId=${r.challengeId} tx=${r.txHash}`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
