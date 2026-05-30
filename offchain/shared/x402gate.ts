import type { RequestHandler } from "express";

interface GateOpts {
  payTo: string;
  priceUsd: number;
  route: string; // e.g. "POST /task"
  network: string;
  facilitatorUrl: string;
}

/**
 * Returns an Express middleware that gates a route behind an x402 payment.
 *
 * When X402_ENABLED=true we use the real `x402-express` middleware, which
 * settles USDC via the configured facilitator on Base. When disabled (the
 * default for local demos) we fall back to a self-contained gate that performs
 * the same HTTP 402 handshake — returning the `accepts` payment requirements and
 * letting through any request that carries an `X-PAYMENT` header — so the flow
 * is fully runnable without a facilitator or funded wallet.
 */
export async function makeX402Gate(opts: GateOpts): Promise<RequestHandler> {
  const enabled = (process.env.X402_ENABLED ?? "false").toLowerCase() === "true";

  if (enabled) {
    try {
      const { paymentMiddleware } = await import("x402-express");
      return paymentMiddleware(
        opts.payTo as `0x${string}`,
        { [opts.route]: { price: `$${opts.priceUsd}`, network: opts.network as any } },
        { url: opts.facilitatorUrl as `${string}://${string}` }
      ) as unknown as RequestHandler;
    } catch (err) {
      console.warn("[x402] real middleware unavailable, falling back to demo gate:", err);
    }
  }

  // Self-contained demo gate following the x402 shape.
  const accepts = [
    {
      scheme: "exact",
      network: opts.network,
      maxAmountRequired: String(Math.round(opts.priceUsd * 1e6)),
      resource: opts.route,
      description: "SkinBook booking fee",
      payTo: opts.payTo,
      asset: "USDC",
      mimeType: "application/json",
    },
  ];

  return (req, res, next) => {
    if (req.header("X-PAYMENT")) return next();
    res.status(402).json({
      x402Version: 1,
      error: "payment required",
      accepts,
    });
  };
}
