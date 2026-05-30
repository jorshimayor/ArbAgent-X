import express from "express";
import cors from "cors";
import { ethers } from "ethers";
import * as dotenv from "dotenv";
import { env, getSkinBookRead, toUsdc, fromUsdc } from "../shared/chain.js";
import { SKINBOOK_ABI, ERC20_ABI } from "../shared/abi.js";
import { enrichActiveBusinesses, recentBookings } from "../shared/registry.js";

dotenv.config();

/**
 * SkinBook "prepare" service — the Base MCP skill-plugin backend.
 *
 * This server NEVER holds or accesses a private key. It only *builds* unsigned
 * transaction calldata ({ to, value, data, chainId }) and hands it back to the
 * agent, which passes it to Base MCP `send_calls` so the user approves and signs
 * in their Base Account. This is the no-custody model the Base MCP article
 * requires — nothing moves without the user.
 *
 * Read endpoints (GET)  -> on-chain state (businesses, bookings).
 * Prepare endpoints (POST) -> batched unsigned calls for registerBusiness /
 *                             book / cancel / confirmAttendance / claimNoShow /
 *                             dispute.
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

const sbIface = new ethers.Interface(SKINBOOK_ABI);
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

// Cache the on-chain USDC + minimums so prepare calls are one round-trip.
let cfg: { usdc: string; minDeposit: bigint } | null = null;
async function getConfig() {
  if (cfg) return cfg;
  const sb = getSkinBookRead();
  if (!sb) throw new Error("SKINBOOK_ADDR not set");
  const [usdc, minDeposit] = await Promise.all([
    sb.usdc() as Promise<string>,
    sb.minDeposit() as Promise<bigint>,
  ]);
  cfg = { usdc, minDeposit };
  return cfg;
}

// Look up a business's required deposit (the exact amount `book` will pull).
async function depositForBusiness(businessId: number): Promise<bigint> {
  const sb = getSkinBookRead();
  if (!sb) throw new Error("SKINBOOK_ADDR not set");
  const b = await sb.businesses(businessId);
  return b.depositAmount as bigint;
}

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
    sendCallsHint:
      "Pass `calls` (to/value/data) to Base MCP send_calls on chain `chainName`; the user approves the batch in their Base Account.",
  };
}

async function main() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ ok: true, service: "skinbook-prepare" }));

  // Plugin self-description / onboarding context.
  app.get("/info", async (_req, res) => {
    try {
      const c = await getConfig();
      res.json({
        name: "SkinBook",
        skinBookAddr: env.skinBookAddr,
        usdc: c.usdc,
        chainId: env.chainId,
        chainName: chainName(env.chainId),
        minDepositUsd: fromUsdc(c.minDeposit),
        custody: "none — this service only builds unsigned calldata; the user signs via Base Account / send_calls",
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Read endpoints ---

  app.get("/businesses", async (_req, res) => {
    try {
      res.json({ businesses: await enrichActiveBusinesses() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/bookings", async (req, res) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : 20;
      res.json({ bookings: await recentBookings(limit) });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/reliability/:id", async (req, res) => {
    try {
      const sb = getSkinBookRead();
      if (!sb) throw new Error("SKINBOOK_ADDR not set");
      const id = Number(req.params.id);
      const rel = await sb.getReliability(id);
      const b = await sb.businesses(id);
      res.json({
        businessId: id,
        name: b.name,
        bookingsHonored: Number(rel.bookingsHonored),
        noShows: Number(rel.noShows),
        active: rel.active,
        depositUsd: fromUsdc(b.depositAmount),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Prepare endpoints (return unsigned calldata only) ---

  // Register a business + booking policy. No token movement, so a single call.
  app.post("/prepare/register-business", async (req, res) => {
    try {
      const { name, depositUsdc, cancellationWindowSecs, gracePeriodSecs } = req.body ?? {};
      if (!name || typeof name !== "string") throw new Error("name (string) required");
      const c = await getConfig();
      const deposit = resolveAmount(depositUsdc, c.minDeposit);
      const cancelWin = Number(cancellationWindowSecs ?? 24 * 3600);
      const grace = Number(gracePeriodSecs ?? 2 * 3600);
      const calls: Call[] = [
        call(
          env.skinBookAddr,
          sbIface.encodeFunctionData("registerBusiness", [name, deposit, cancelWin, grace]),
          `register business "${name}" with a ${fromUsdc(deposit)} USDC deposit`
        ),
      ];
      res.json(prepared(`Register "${name}" with a ${fromUsdc(deposit)} USDC booking deposit.`, calls));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Book a slot: approve the business's deposit -> book(businessId, slotTime).
  app.post("/prepare/book", async (req, res) => {
    try {
      const { businessId, slotTime } = req.body ?? {};
      if (businessId === undefined) throw new Error("businessId required");
      const slot = Number(slotTime);
      if (!Number.isFinite(slot) || slot <= Math.floor(Date.now() / 1000)) {
        throw new Error("slotTime must be a future unix timestamp (seconds)");
      }
      const c = await getConfig();
      const deposit = await depositForBusiness(Number(businessId));
      const calls: Call[] = [
        call(c.usdc, erc20Iface.encodeFunctionData("approve", [env.skinBookAddr, deposit]),
          `approve ${fromUsdc(deposit)} USDC deposit to SkinBook`),
        call(env.skinBookAddr, sbIface.encodeFunctionData("book", [Number(businessId), slot]),
          `book business #${businessId} for slot ${new Date(slot * 1000).toISOString()}`),
      ];
      res.json(prepared(`Book business #${businessId}, depositing ${fromUsdc(deposit)} USDC into the Moonwell vault.`, calls));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Cancel in time (customer): cancel(bookingId).
  app.post("/prepare/cancel", async (req, res) => {
    try {
      const { bookingId } = req.body ?? {};
      if (bookingId === undefined) throw new Error("bookingId required");
      const calls: Call[] = [
        call(env.skinBookAddr, sbIface.encodeFunctionData("cancel", [Number(bookingId)]),
          `cancel booking #${bookingId} and refund the deposit (+ yield)`),
      ];
      res.json(prepared(`Cancel booking #${bookingId} (refund deposit + accrued Moonwell yield).`, calls));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Business confirms the customer showed: confirmAttendance(bookingId).
  app.post("/prepare/confirm-attendance", async (req, res) => {
    try {
      const { bookingId } = req.body ?? {};
      if (bookingId === undefined) throw new Error("bookingId required");
      const calls: Call[] = [
        call(env.skinBookAddr, sbIface.encodeFunctionData("confirmAttendance", [Number(bookingId)]),
          `confirm attendance for booking #${bookingId} and refund the customer`),
      ];
      res.json(prepared(`Confirm attendance for booking #${bookingId} (refunds the customer).`, calls));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Business files a no-show: claimNoShow(bookingId). Opens the dispute window.
  app.post("/prepare/claim-noshow", async (req, res) => {
    try {
      const { bookingId } = req.body ?? {};
      if (bookingId === undefined) throw new Error("bookingId required");
      const calls: Call[] = [
        call(env.skinBookAddr, sbIface.encodeFunctionData("claimNoShow", [Number(bookingId)]),
          `file a no-show for booking #${bookingId} (opens the dispute window)`),
      ];
      res.json(prepared(`File a no-show for booking #${bookingId}.`, calls));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Customer contests a no-show within the window: dispute(bookingId).
  app.post("/prepare/dispute", async (req, res) => {
    try {
      const { bookingId } = req.body ?? {};
      if (bookingId === undefined) throw new Error("bookingId required");
      const calls: Call[] = [
        call(env.skinBookAddr, sbIface.encodeFunctionData("dispute", [Number(bookingId)]),
          `dispute the no-show on booking #${bookingId}`),
      ];
      res.json(prepared(`Dispute the no-show claim on booking #${bookingId}.`, calls));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.listen(PORT, () =>
    console.log(
      `[prepare] SkinBook prepare/calldata service on http://127.0.0.1:${PORT}  (no keys; build->send_calls)`
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
