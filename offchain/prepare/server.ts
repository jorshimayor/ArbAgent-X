import express from "express";
import cors from "cors";
import { ethers } from "ethers";
import * as dotenv from "dotenv";
import { env, getProvider, getProofStakeRead, toUsdc, fromUsdc } from "../shared/chain.js";
import { PROOFSTAKE_ABI, ERC20_ABI } from "../shared/abi.js";
import { enrichActiveAgents } from "../shared/registry.js";

dotenv.config();

/**
 * ProofStake "prepare" service — the Base MCP skill-plugin backend.
 *
 * This server NEVER holds or accesses a private key. It only *builds* unsigned
 * transaction calldata ({ to, value, data, chainId }) and hands it back to the
 * agent, which passes it to Base MCP `send_calls` so the user approves and signs
 * in their Base Account. This is the no-custody model the Base MCP article
 * requires — nothing moves without the user.
 *
 * Read endpoints (GET)  -> on-chain state (agents, reputation, markets).
 * Prepare endpoints (POST) -> batched unsigned calls for register / top-up /
 *                             challenge / deactivate / withdraw.
 */

const PORT = Number(process.env.PREPARE_PORT ?? 4200);

// Chain id -> Base MCP chain name, so the plugin can map calls for send_calls.
function chainName(id: number): string {
  switch (id) {
    case 8453:
      return "base";
    case 84532:
      return "base-sepolia";
    case 1:
      return "ethereum";
    case 10:
      return "optimism";
    default:
      return `eip155:${id}`;
  }
}

const psIface = new ethers.Interface(PROOFSTAKE_ABI);
const erc20Iface = new ethers.Interface(ERC20_ABI);

interface Call {
  to: string;
  value: string;
  data: string;
  chainId: number;
  // human-readable hint; ignored by send_calls, useful for the user/agent.
  summary: string;
}

function call(to: string, data: string, summary: string): Call {
  return { to, value: "0x0", data, chainId: env.chainId, summary };
}

// Cache the on-chain USDC + bond minimums so prepare calls are one round-trip.
let cfg: { usdc: string; minBond: bigint; minChallengerBond: bigint } | null = null;
async function getConfig() {
  if (cfg) return cfg;
  const ps = getProofStakeRead();
  if (!ps) throw new Error("PROOFSTAKE_ADDR not set");
  const [usdc, minBond, minChallengerBond] = await Promise.all([
    ps.usdc() as Promise<string>,
    ps.minBond() as Promise<bigint>,
    ps.minChallengerBond() as Promise<bigint>,
  ]);
  cfg = { usdc, minBond, minChallengerBond };
  return cfg;
}

// Resolve a USDC amount: explicit `amountUsdc` (a number) or fall back to a floor.
function resolveAmount(amountUsdc: unknown, floor: bigint): bigint {
  if (amountUsdc === undefined || amountUsdc === null || amountUsdc === "") return floor;
  const n = Number(amountUsdc);
  if (!Number.isFinite(n) || n <= 0) throw new Error("amountUsdc must be a positive number");
  const wanted = toUsdc(n);
  return wanted < floor ? floor : wanted;
}

function prepared(description: string, calls: Call[]) {
  return {
    description,
    chainId: env.chainId,
    chainName: chainName(env.chainId),
    calls,
    // The plugin maps each {to, value, data} into the send_calls `calls` array;
    // Base MCP returns one approval link covering the whole atomic batch.
    sendCallsHint: "Pass `calls` (to/value/data) to Base MCP send_calls on chain `chainName`; the user approves the batch in their Base Account.",
  };
}

async function main() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ ok: true, service: "proofstake-prepare" }));

  // Plugin self-description / onboarding context.
  app.get("/info", async (_req, res) => {
    try {
      const c = await getConfig();
      res.json({
        name: "ProofStake",
        proofStakeAddr: env.proofStakeAddr,
        usdc: c.usdc,
        chainId: env.chainId,
        chainName: chainName(env.chainId),
        minBondUsd: fromUsdc(c.minBond),
        minChallengerBondUsd: fromUsdc(c.minChallengerBond),
        custody: "none — this service only builds unsigned calldata; the user signs via Base Account / send_calls",
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Read endpoints ---

  app.get("/agents", async (_req, res) => {
    try {
      res.json({ agents: await enrichActiveAgents() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/reputation/:id", async (req, res) => {
    try {
      const ps = getProofStakeRead();
      if (!ps) throw new Error("PROOFSTAKE_ADDR not set");
      const id = Number(req.params.id);
      const rep = await ps.getReputation(id);
      const bondUsd = fromUsdc(await ps.bondValue(id));
      res.json({
        agentId: id,
        jobsServed: Number(rep.jobsServed),
        jobsSuccessful: Number(rep.jobsSuccessful),
        timesSlashed: Number(rep.timesSlashed),
        active: rep.active,
        bondUsd,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Prepare endpoints (return unsigned calldata only) ---

  // Register a new agent: approve USDC bond -> register(endpoint, bond).
  app.post("/prepare/register", async (req, res) => {
    try {
      const { endpoint, bondUsdc } = req.body ?? {};
      if (!endpoint || typeof endpoint !== "string") throw new Error("endpoint (string) required");
      const c = await getConfig();
      const bond = resolveAmount(bondUsdc, c.minBond);
      const calls: Call[] = [
        call(c.usdc, erc20Iface.encodeFunctionData("approve", [env.proofStakeAddr, bond]),
          `approve ${fromUsdc(bond)} USDC to ProofStake`),
        call(env.proofStakeAddr, psIface.encodeFunctionData("register", [endpoint, bond]),
          `register agent at ${endpoint} with a ${fromUsdc(bond)} USDC bond`),
      ];
      res.json(prepared(`Register an agent and bond ${fromUsdc(bond)} USDC into the Moonwell vault.`, calls));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Top up an existing agent's bond: approve -> topUp(agentId, amount).
  app.post("/prepare/topup", async (req, res) => {
    try {
      const { agentId, amountUsdc } = req.body ?? {};
      if (agentId === undefined) throw new Error("agentId required");
      const c = await getConfig();
      const amount = resolveAmount(amountUsdc, 1n); // any positive amount
      const calls: Call[] = [
        call(c.usdc, erc20Iface.encodeFunctionData("approve", [env.proofStakeAddr, amount]),
          `approve ${fromUsdc(amount)} USDC to ProofStake`),
        call(env.proofStakeAddr, psIface.encodeFunctionData("topUp", [Number(agentId), amount]),
          `top up agent #${agentId} bond by ${fromUsdc(amount)} USDC`),
      ];
      res.json(prepared(`Top up agent #${agentId}'s Moonwell-backed bond by ${fromUsdc(amount)} USDC.`, calls));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Challenge an agent's output: approve challenger bond -> challenge(...).
  app.post("/prepare/challenge", async (req, res) => {
    try {
      const { agentId, requestId, evidenceURI, bondUsdc } = req.body ?? {};
      if (agentId === undefined) throw new Error("agentId required");
      if (!requestId || !ethers.isHexString(requestId, 32)) throw new Error("requestId must be a 32-byte hex string");
      if (!evidenceURI || typeof evidenceURI !== "string") throw new Error("evidenceURI (string) required");
      const c = await getConfig();
      const bond = resolveAmount(bondUsdc, c.minChallengerBond);
      const calls: Call[] = [
        call(c.usdc, erc20Iface.encodeFunctionData("approve", [env.proofStakeAddr, bond]),
          `approve ${fromUsdc(bond)} USDC challenger bond to ProofStake`),
        call(env.proofStakeAddr, psIface.encodeFunctionData("challenge", [Number(agentId), requestId, evidenceURI, bond]),
          `open a challenge against agent #${agentId} staking ${fromUsdc(bond)} USDC`),
      ];
      res.json(prepared(`Challenge agent #${agentId}'s output, staking ${fromUsdc(bond)} USDC.`, calls));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Deactivate an agent (operator only): deactivate(agentId).
  app.post("/prepare/deactivate", async (req, res) => {
    try {
      const { agentId } = req.body ?? {};
      if (agentId === undefined) throw new Error("agentId required");
      const calls: Call[] = [
        call(env.proofStakeAddr, psIface.encodeFunctionData("deactivate", [Number(agentId)]),
          `deactivate agent #${agentId} (starts the 7-day withdraw cooldown)`),
      ];
      res.json(prepared(`Deactivate agent #${agentId}.`, calls));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Withdraw a deactivated agent's bond after cooldown: withdraw(agentId).
  app.post("/prepare/withdraw", async (req, res) => {
    try {
      const { agentId } = req.body ?? {};
      if (agentId === undefined) throw new Error("agentId required");
      const calls: Call[] = [
        call(env.proofStakeAddr, psIface.encodeFunctionData("withdraw", [Number(agentId)]),
          `withdraw agent #${agentId}'s bond (principal + accrued Moonwell yield)`),
      ];
      res.json(prepared(`Withdraw agent #${agentId}'s Moonwell-backed bond.`, calls));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.listen(PORT, () =>
    console.log(
      `[prepare] ProofStake prepare/calldata service on http://127.0.0.1:${PORT}  (no keys; build->send_calls)`
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
