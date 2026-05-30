import express from "express";
import cors from "cors";
import type { JobResult } from "../shared/types.js";

// A minimal content-addressed evidence store: a stand-in for IPFS/Arweave.
// Agents POST a JobResult and get back an evidenceURI; the verifier GETs it.
// In production this is replaced by a real IPFS pin — the URI shape is the same.

const PORT = Number(process.env.EVIDENCE_PORT ?? 4100);
const records = new Map<string, JobResult>();

export function createEvidenceApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "256kb" }));

  app.get("/health", (_req, res) => res.json({ ok: true, count: records.size }));

  app.post("/evidence", (req, res) => {
    const job = req.body as JobResult;
    const id = job?.receipt?.requestId;
    if (!id) return res.status(400).json({ error: "missing receipt.requestId" });
    records.set(id, job);
    res.json({ evidenceURI: `${baseUrl(req)}/evidence/${id}` });
  });

  app.get("/evidence/:id", (req, res) => {
    const job = records.get(req.params.id);
    if (!job) return res.status(404).json({ error: "not found" });
    res.json(job);
  });

  return app;
}

function baseUrl(req: express.Request): string {
  return process.env.EVIDENCE_BASE_URL ?? `${req.protocol}://${req.get("host")}`;
}

// Run standalone when invoked directly.
if (process.argv[1] && process.argv[1].endsWith("store.ts")) {
  createEvidenceApp().listen(PORT, () =>
    console.log(`[evidence] store listening on http://127.0.0.1:${PORT}`)
  );
}
