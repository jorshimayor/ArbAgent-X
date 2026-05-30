import * as dotenv from "dotenv";
import type { AgentReceipt, TaskRequest } from "../shared/types.js";

dotenv.config();

export interface TaskResponse {
  output: string;
  receipt: AgentReceipt;
  evidenceURI: string | null;
  paid: "x402" | "demo"; // how the call was settled
  paymentTx?: string; // settlement tx hash, when the facilitator returns one
}

/**
 * Pay an x402-gated agent and return its signed answer.
 *
 * Real settlement: when X402_ENABLED=true and CLIENT_PRIVATE_KEY is set we use
 * `x402-fetch`, which performs the full 402 -> sign EIP-3009 authorization ->
 * facilitator settle -> retry handshake against Base Sepolia. The agent's
 * pay-to address actually receives USDC.
 *
 * Demo fallback: otherwise we replay the same HTTP shape with a stub `X-PAYMENT`
 * header, which the agent's self-contained gate accepts. No funds move, but the
 * request/receipt/evidence flow is identical — so a challenge still works.
 */
export async function payAndCall(endpoint: string, task: TaskRequest): Promise<TaskResponse> {
  const url = `${endpoint.replace(/\/$/, "")}/task`;
  const body = JSON.stringify(task);
  const headers = { "content-type": "application/json" };

  const enabled = (process.env.X402_ENABLED ?? "false").toLowerCase() === "true";
  const key = process.env.CLIENT_PRIVATE_KEY ?? "";

  if (enabled && key.startsWith("0x")) {
    const { wrapFetchWithPayment, createSigner, decodeXPaymentResponse } = await import("x402-fetch");
    const network = process.env.X402_NETWORK ?? "base-sepolia";
    // Cap any single payment at $1 so a misconfig can't drain the wallet.
    const maxValue = BigInt(process.env.X402_MAX_VALUE ?? 1_000_000);

    const signer = await createSigner(network, key);
    const fetchWithPay = wrapFetchWithPayment(globalThis.fetch, signer, maxValue);

    const res = await fetchWithPay(url, { method: "POST", headers, body });
    if (!res.ok) throw new Error(`agent ${endpoint} returned ${res.status}: ${await res.text()}`);

    let paymentTx: string | undefined;
    const payHeader = res.headers.get("x-payment-response");
    if (payHeader) {
      try {
        const decoded = decodeXPaymentResponse(payHeader) as { transaction?: string };
        paymentTx = decoded?.transaction;
      } catch {
        /* header present but unparseable — settlement still happened */
      }
    }

    const data = (await res.json()) as Omit<TaskResponse, "paid" | "paymentTx">;
    return { ...data, paid: "x402", paymentTx };
  }

  // Demo settlement: stub payment header, no funds move.
  const res = await fetch(url, {
    method: "POST",
    headers: { ...headers, "X-PAYMENT": "demo" },
    body,
  });
  if (!res.ok) throw new Error(`agent ${endpoint} returned ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as Omit<TaskResponse, "paid" | "paymentTx">;
  return { ...data, paid: "demo" };
}

// CLI: `tsx scripts/client.ts <endpoint> "<expression>"`
if (process.argv[1] && process.argv[1].endsWith("client.ts")) {
  const [endpoint, input] = process.argv.slice(2);
  if (!endpoint || !input) {
    console.error('usage: tsx scripts/client.ts <endpoint> "<expression>"');
    process.exit(1);
  }
  payAndCall(endpoint, { kind: "math", input })
    .then((r) => {
      console.log(`paid via ${r.paid}${r.paymentTx ? ` (tx ${r.paymentTx})` : ""}`);
      console.log(`output:      ${r.output}`);
      console.log(`requestId:   ${r.receipt.requestId}`);
      console.log(`evidenceURI: ${r.evidenceURI ?? "(none)"}`);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
