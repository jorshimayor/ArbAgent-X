import express from "express";
import cors from "cors";
import { ethers } from "ethers";
import * as dotenv from "dotenv";
import { getProfileSpec, type Profile } from "./profiles.js";
import { makeX402Gate } from "../shared/x402gate.js";
import { makeRequestId, signReceipt } from "../shared/receipt.js";
import type { AgentInfo, JobResult, TaskRequest } from "../shared/types.js";

dotenv.config();

const PROFILE = (process.env.AGENT_PROFILE ?? "good") as Profile;
const PORT = Number(process.env.PORT ?? 4001);
const spec = getProfileSpec(PROFILE);

// Wallet: explicit key, else a deterministic dev key so the demo runs key-free.
const PRIV =
  process.env.AGENT_PRIVATE_KEY && process.env.AGENT_PRIVATE_KEY.startsWith("0x")
    ? process.env.AGENT_PRIVATE_KEY
    : ethers.id(`proofstake-agent:${PROFILE}`);
const wallet = new ethers.Wallet(PRIV);

const AGENT_ID = Number(process.env.AGENT_ID ?? 0);
const EVIDENCE_BASE_URL = process.env.EVIDENCE_BASE_URL ?? "http://127.0.0.1:4100";

async function main() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const info: AgentInfo = {
    agentId: AGENT_ID || null,
    name: spec.name,
    profile: spec.profile,
    address: wallet.address,
    priceUsd: spec.priceUsd,
    kinds: ["math"],
  };

  app.get("/health", (_req, res) => res.json({ ok: true, profile: PROFILE }));
  app.get("/info", (_req, res) => res.json(info));

  // x402-gated task endpoint.
  const gate = await makeX402Gate({
    payTo: wallet.address,
    priceUsd: spec.priceUsd,
    route: "POST /task",
    network: process.env.X402_NETWORK ?? "base-sepolia",
    facilitatorUrl: process.env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator",
  });

  app.post("/task", gate, async (req, res) => {
    const reqBody = req.body as TaskRequest;
    if (!reqBody?.kind || typeof reqBody.input !== "string") {
      return res.status(400).json({ error: "expected { kind, input }" });
    }

    let output: string;
    try {
      output = spec.solve(reqBody);
    } catch (e: any) {
      return res.status(422).json({ error: `cannot solve task: ${e.message}` });
    }

    const nonce = ethers.hexlify(ethers.randomBytes(8));
    const requestId = makeRequestId(reqBody, nonce);
    const receipt = await signReceipt(wallet, AGENT_ID, requestId, output);

    const job: JobResult = {
      agentId: AGENT_ID,
      endpoint: `http://127.0.0.1:${PORT}`,
      request: reqBody,
      output,
      receipt,
      servedAt: Date.now(),
    };

    // Persist evidence (best-effort) so a client can later challenge.
    let evidenceURI: string | null = null;
    try {
      const r = await fetch(`${EVIDENCE_BASE_URL}/evidence`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(job),
      });
      if (r.ok) evidenceURI = (await r.json()).evidenceURI;
    } catch {
      /* evidence store offline — receipt is still self-verifying */
    }

    res.json({ output, receipt, evidenceURI });
  });

  app.listen(PORT, () =>
    console.log(
      `[agent:${PROFILE}] ${spec.name} on http://127.0.0.1:${PORT}  pay-to=${wallet.address}  $${spec.priceUsd}/call`
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
