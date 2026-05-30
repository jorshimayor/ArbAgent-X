import * as dotenv from "dotenv";
import { getProofStakeWrite, getProofStakeRead, getProvider, env, fromUsdc } from "../shared/chain.js";
import { ERC20_ABI } from "../shared/abi.js";
import { ethers } from "ethers";
import { enrichActiveAgents, type EnrichedAgent } from "../shared/registry.js";
import { payAndCall } from "./client.js";
import { openChallenge } from "./challenge.js";
import { resolveChallenge } from "../verifier/index.js";

dotenv.config();

const VERIFIER_KEY = process.env.VERIFIER_PRIVATE_KEY ?? "";
const CLIENT_KEY = process.env.CLIENT_PRIVATE_KEY ?? "";

// Base Sepolia explorer; chainId 84532.
function txLink(hash: string): string {
  const base = env.chainId === 8453 ? "https://basescan.org" : "https://sepolia.basescan.org";
  return `${base}/tx/${hash}`;
}

function hr() {
  console.log("─".repeat(64));
}

async function main() {
  if (!env.proofStakeAddr) throw new Error("PROOFSTAKE_ADDR not set");
  if (!VERIFIER_KEY) throw new Error("VERIFIER_PRIVATE_KEY not set");
  if (!CLIENT_KEY) throw new Error("CLIENT_PRIVATE_KEY not set");

  const ps = getProofStakeRead()!;
  const links: { label: string; hash: string }[] = [];

  hr();
  console.log("ProofStake testnet demo — route, pay, challenge, slash");
  console.log(`contract: ${env.proofStakeAddr}  rpc: ${env.rpcUrl}`);
  hr();

  // 1. Route: rank every active agent by reputation-per-price.
  const agents = await enrichActiveAgents();
  if (agents.length === 0) throw new Error("no active agents — run seed-agents and start the agent servers");
  console.log("\n[1] proofstake_route ranking (reputation ÷ price):");
  for (const a of agents) {
    console.log(
      `    #${a.agentId} ${a.name ?? "?"} (${a.profile ?? "?"})  ` +
        `bond $${a.bondUsd.toFixed(4)}  price $${a.priceUsd ?? "?"}  ` +
        `slashed ${a.timesSlashed}  online ${a.online}  score ${a.score.toFixed(1)}`
    );
  }
  console.log(
    "    note: with no track record yet, the naive score tops the cheapest agent —\n" +
      "    exactly the trap ProofStake exists to close. Watch the ranking after a slash."
  );

  const good = agents.find((a) => a.profile === "good");
  const malicious = agents.find((a) => a.profile === "malicious");
  if (!good) throw new Error("no good agent active");
  if (!good.online) throw new Error(`good agent #${good.agentId} is offline — start its server`);

  // 2. Happy path: pay the honest agent, get a correct answer, verifier records the job.
  console.log(`\n[2] paying the honest agent #${good.agentId} ${good.name} for a real job...`);
  const goodTask = { kind: "math" as const, input: "12 * 12 - 4" };
  const goodRes = await payAndCall(good.endpoint, goodTask);
  console.log(`    paid via ${goodRes.paid}${goodRes.paymentTx ? ` (tx ${goodRes.paymentTx})` : ""}`);
  console.log(`    "${goodTask.input}" = ${goodRes.output}  (request ${goodRes.receipt.requestId.slice(0, 18)}…)`);
  if (goodRes.paymentTx) links.push({ label: `pay agent #${good.agentId} (x402)`, hash: goodRes.paymentTx });

  const vw = getProofStakeWrite(VERIFIER_KEY);
  const recTx = await vw.recordJob(good.agentId, goodRes.receipt.requestId, true);
  const recRc = await recTx.wait();
  console.log(`    verifier recorded a clean job in tx ${recRc?.hash}`);
  links.push({ label: `recordJob agent #${good.agentId}`, hash: recRc?.hash ?? recTx.hash });

  // 3. Bad actor: pay the malicious agent, which returns junk regardless of input.
  if (!malicious) {
    console.log("\n[!] no malicious agent active — skipping the slash narrative.");
  } else if (!malicious.online) {
    console.log(`\n[!] malicious agent #${malicious.agentId} offline — skipping the slash narrative.`);
  } else {
    console.log(`\n[3] paying the malicious agent #${malicious.agentId} (it lies for a cheaper price)...`);
    const badTask = { kind: "math" as const, input: "100 / 8" };
    const badRes = await payAndCall(malicious.endpoint, badTask);
    console.log(`    paid via ${badRes.paid}${badRes.paymentTx ? ` (tx ${badRes.paymentTx})` : ""}`);
    console.log(`    "${badTask.input}" should be 12.5 — agent claims ${badRes.output}`);
    if (badRes.paymentTx) links.push({ label: `pay agent #${malicious.agentId} (x402)`, hash: badRes.paymentTx });
    if (!badRes.evidenceURI) throw new Error("no evidenceURI — start the evidence store so the output can be challenged");

    const bondBefore = fromUsdc(await ps.bondValue(malicious.agentId));
    const client = new ethers.Wallet(CLIENT_KEY, getProvider());
    const usdc = new ethers.Contract(await ps.usdc(), ERC20_ABI, getProvider());
    const balBefore = fromUsdc(await usdc.balanceOf(client.address));

    // 4. Challenge: client stakes a bond + the signed evidence.
    console.log(`\n[4] challenging the bad output (bond at risk: $${bondBefore.toFixed(4)})...`);
    const { challengeId, txHash } = await openChallenge(
      malicious.agentId,
      badRes.receipt.requestId,
      badRes.evidenceURI
    );
    links.push({ label: `open challenge #${challengeId}`, hash: txHash });

    // 5. Resolve: verifier re-computes ground truth and slashes objectively.
    console.log(`\n[5] verifier re-computes the answer and resolves challenge #${challengeId}...`);
    const before = Number(await ps.challengeCount());
    await resolveChallenge(challengeId);
    // resolveChallenge logs its own tx; fetch it from the resolved event for the link list.
    const psEvents = getProofStakeRead()!;
    const resolved = await psEvents.queryFilter(psEvents.filters.ChallengeResolved(challengeId), -2000);
    if (resolved.length) links.push({ label: `resolve challenge #${challengeId} (slash)`, hash: resolved[resolved.length - 1].transactionHash });
    void before;

    const bondAfter = fromUsdc(await ps.bondValue(malicious.agentId));
    const balAfter = fromUsdc(await usdc.balanceOf(client.address));
    const rep = await ps.getReputation(malicious.agentId);

    console.log("\n[6] result:");
    console.log(`    agent #${malicious.agentId} bond: $${bondBefore.toFixed(4)} -> $${bondAfter.toFixed(4)}  (slashed, now ${rep.active ? "active" : "deactivated"}, timesSlashed=${rep.timesSlashed})`);
    console.log(`    challenger USDC: $${balBefore.toFixed(4)} -> $${balAfter.toFixed(4)}  (net ${(balAfter - balBefore >= 0 ? "+" : "")}${(balAfter - balBefore).toFixed(4)} after bond + payout − fee)`);

    // 7. Re-rank: the slash deactivates the liar and the honest job lifts the good
    //    agent — the reputation system corrects the naive price-only ranking.
    const after = await enrichActiveAgents();
    console.log("\n[7] proofstake_route re-ranks after the slash:");
    for (const a of after) {
      console.log(
        `    #${a.agentId} ${a.name ?? "?"} (${a.profile ?? "?"})  ` +
          `price $${a.priceUsd ?? "?"}  slashed ${a.timesSlashed}  score ${a.score.toFixed(1)}`
      );
    }
    if (after[0]) console.log(`\n    -> router now picks #${after[0].agentId} ${after[0].name} — skin in the game wins.`);
  }

  hr();
  console.log("BaseScan transactions:");
  for (const l of links) console.log(`  ${l.label}\n    ${txLink(l.hash)}`);
  hr();
  console.log("Point the dashboard at this contract (PROOFSTAKE_ADDR + RPC_URL) to see it live.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
