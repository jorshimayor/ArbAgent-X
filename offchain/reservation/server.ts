import express from "express";
import cors from "cors";
import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { makeX402Gate } from "../shared/x402gate.js";
import { getSkinBookRead, fromUsdc } from "../shared/chain.js";

dotenv.config();

/**
 * SkinBook reservation desk — the x402 piece.
 *
 * The refundable *deposit* lives on-chain (Base MCP + Moonwell). A booking also
 * carries a small, non-refundable **booking fee**, charged per reservation call
 * over x402 — exactly the per-call payment x402 is built for. A client (or its
 * agent) calls `POST /reserve`; unpaid, it gets HTTP 402 with the payment
 * requirements; paid, it gets a reservation authorization telling it which
 * business + slot to then `book` on-chain via the prepare service.
 *
 * Runs key-free by default (self-contained 402 handshake); set X402_ENABLED=true
 * to settle real USDC through an x402 facilitator on Base.
 */

const PORT = Number(process.env.RESERVATION_PORT ?? 4300);
const FEE_USD = Number(process.env.BOOKING_FEE_USD ?? 0.05);
// Where the booking fee is paid. Defaults to a deterministic dev address.
const PAY_TO =
  process.env.RESERVATION_PAYTO && process.env.RESERVATION_PAYTO.startsWith("0x")
    ? process.env.RESERVATION_PAYTO
    : new ethers.Wallet(ethers.id("skinbook-reservation-desk")).address;

async function main() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ ok: true, service: "skinbook-reservation" }));
  app.get("/info", (_req, res) =>
    res.json({ name: "SkinBook reservation desk", bookingFeeUsd: FEE_USD, payTo: PAY_TO })
  );

  const gate = await makeX402Gate({
    payTo: PAY_TO,
    priceUsd: FEE_USD,
    route: "POST /reserve",
    network: process.env.X402_NETWORK ?? "base-sepolia",
    facilitatorUrl: process.env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator",
  });

  // x402-gated: returns a reservation authorization once the booking fee is paid.
  app.post("/reserve", gate, async (req, res) => {
    const { businessId, slotTime } = req.body ?? {};
    if (businessId === undefined || slotTime === undefined) {
      return res.status(400).json({ error: "expected { businessId, slotTime }" });
    }
    const slot = Number(slotTime);
    if (!Number.isFinite(slot) || slot <= Math.floor(Date.now() / 1000)) {
      return res.status(400).json({ error: "slotTime must be a future unix timestamp (seconds)" });
    }

    // If a chain is configured, look up the on-chain deposit for the next step.
    let depositUsd: number | null = null;
    let businessName: string | null = null;
    try {
      const sb = getSkinBookRead();
      if (sb) {
        const b = await sb.businesses(Number(businessId));
        depositUsd = fromUsdc(b.depositAmount);
        businessName = b.name;
      }
    } catch {
      /* chain optional for the reservation step */
    }

    res.json({
      reserved: true,
      businessId: Number(businessId),
      businessName,
      slotTime: slot,
      bookingFeeUsd: FEE_USD,
      depositUsd,
      next: "Post the refundable deposit on-chain via the prepare service: POST /prepare/book { businessId, slotTime }, then approve in your Base Account.",
    });
  });

  app.listen(PORT, () =>
    console.log(
      `[reservation] SkinBook reservation desk on http://127.0.0.1:${PORT}  fee=$${FEE_USD}/reserve (x402)  pay-to=${PAY_TO}`
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
