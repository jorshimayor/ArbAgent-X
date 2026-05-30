// Offline smoke test for the off-chain stack. Verifies the deterministic task
// engine, the judge, and receipt signing/verification without needing a chain.
// If an agent is running on AGENT_URL, it also exercises the live x402 handshake.
import { ethers } from "ethers";
import { evaluate, canonical } from "../shared/task.js";
import { judge } from "../verifier/judge.js";
import { signReceipt, makeRequestId, verifyReceipt } from "../shared/receipt.js";
import { getProfileSpec } from "../agents/profiles.js";
import type { JobResult, TaskRequest } from "../shared/types.js";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "  ok  " : " FAIL "} ${name}`);
  if (!cond) failures++;
}

async function buildJob(profile: "good" | "mediocre" | "malicious", input: string): Promise<JobResult> {
  const spec = getProfileSpec(profile);
  const req: TaskRequest = { kind: "math", input };
  const output = spec.solve(req);
  const wallet = new ethers.Wallet(ethers.id(`smoke:${profile}`));
  const requestId = makeRequestId(req, "nonce");
  const receipt = await signReceipt(wallet, 1, requestId, output);
  return { agentId: 1, endpoint: "local", request: req, output, receipt, servedAt: Date.now() };
}

async function main() {
  console.log("task engine:");
  check("2 + 2 * 5 = 12", evaluate("2 + 2 * 5") === 12);
  check("(2 + 2) * 5 = 20", evaluate("(2 + 2) * 5") === 20);
  check("10 / 4 = 2.5", canonical(evaluate("10 / 4")) === "2.5");

  console.log("\njudge + receipts:");
  const good = await buildJob("good", "10 / 4");
  check("good agent passes", judge(good).correct);
  check("good receipt verifies", verifyReceipt(good.receipt, good.output));

  const mediocre = await buildJob("mediocre", "10 / 4"); // floors 2.5 -> 2
  check("mediocre agent flagged on decimals", !judge(mediocre).correct);

  const bad = await buildJob("malicious", "2 + 2 * 5"); // returns 42
  check("malicious agent flagged", !judge(bad).correct);

  // Tampered output should fail receipt verification.
  check("tampered output fails receipt", !verifyReceipt(good.receipt, "999"));

  // Optional live agent check.
  const url = process.env.AGENT_URL;
  if (url) {
    console.log(`\nlive agent @ ${url}:`);
    const unpaid = await fetch(`${url}/task`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "math", input: "2+2" }),
    });
    check("unpaid request returns 402", unpaid.status === 402);

    const paid = await fetch(`${url}/task`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-PAYMENT": "demo" },
      body: JSON.stringify({ kind: "math", input: "2+2" }),
    });
    check("paid request returns 200", paid.status === 200);
    if (paid.ok) {
      const body = await paid.json();
      check("agent output is 4", body.output === "4");
      check("agent receipt verifies", verifyReceipt(body.receipt, body.output));
    }
  }

  console.log(`\n${failures === 0 ? "ALL GREEN" : failures + " FAILURES"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
