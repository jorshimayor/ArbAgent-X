import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { getProofStakeWrite, getProvider, env } from "../shared/chain.js";
import { PROOFSTAKE_ABI } from "../shared/abi.js";
import { judge } from "./judge.js";
import type { JobResult } from "../shared/types.js";

dotenv.config();

const VERIFIER_KEY = process.env.VERIFIER_PRIVATE_KEY ?? "";

async function fetchEvidence(uri: string): Promise<JobResult> {
  const r = await fetch(uri);
  if (!r.ok) throw new Error(`evidence fetch failed: ${r.status}`);
  return (await r.json()) as JobResult;
}

/**
 * Resolve a single open challenge: load it, pull the evidence, judge it
 * deterministically, and call resolve() with the verdict.
 */
export async function resolveChallenge(challengeId: number): Promise<void> {
  if (!VERIFIER_KEY) throw new Error("VERIFIER_PRIVATE_KEY not set");
  const ps = getProofStakeWrite(VERIFIER_KEY);

  // Public RPC read replicas can lag a freshly-mined challenge tx, returning an
  // empty struct. Poll until the challenge is readable before acting on it.
  let c = await ps.challenges(challengeId);
  for (let i = 0; i < 12 && (!c.evidenceURI || c.challenger === ethers.ZeroAddress); i++) {
    await new Promise((r) => setTimeout(r, 1500));
    c = await ps.challenges(challengeId);
  }
  if (!c.evidenceURI || c.challenger === ethers.ZeroAddress) {
    throw new Error(`challenge #${challengeId} not readable yet (replica lag) — retry shortly`);
  }
  if (c.resolved) {
    console.log(`[verifier] challenge #${challengeId} already resolved`);
    return;
  }

  const job = await fetchEvidence(c.evidenceURI);
  const verdict = judge(job);
  const upheld = !verdict.correct; // slash the agent when the output is wrong

  console.log(
    `[verifier] challenge #${challengeId} agent #${c.agentId}: ${verdict.reason} -> ${
      upheld ? "UPHELD (slash)" : "REJECTED (agent honest)"
    }`
  );

  const tx = await ps.resolve(challengeId, upheld);
  const rc = await tx.wait();
  console.log(`[verifier] resolved in tx ${rc?.hash}`);
}

/** Watch for new challenges and resolve them automatically. */
export async function watch(): Promise<void> {
  if (!env.proofStakeAddr) throw new Error("PROOFSTAKE_ADDR not set");
  const ps = new ethers.Contract(env.proofStakeAddr, PROOFSTAKE_ABI, getProvider());
  console.log(`[verifier] watching ${env.proofStakeAddr} for challenges...`);
  ps.on("ChallengeOpened", async (challengeId: bigint) => {
    console.log(`[verifier] ChallengeOpened #${challengeId}`);
    try {
      await resolveChallenge(Number(challengeId));
    } catch (e) {
      console.error(`[verifier] failed to resolve #${challengeId}:`, e);
    }
  });
}

// CLI: `tsx verifier/index.ts watch` or `tsx verifier/index.ts resolve <id>`
if (process.argv[1] && process.argv[1].endsWith("index.ts")) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "resolve" && arg) {
    resolveChallenge(Number(arg)).catch((e) => {
      console.error(e);
      process.exit(1);
    });
  } else {
    watch().catch((e) => {
      console.error(e);
      process.exit(1);
    });
  }
}
