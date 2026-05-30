import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { getSkinBookWrite, getSkinBookRead, getProvider, env } from "../shared/chain.js";
import { SKINBOOK_ABI } from "../shared/abi.js";

dotenv.config();

/**
 * SkinBook keeper — the autonomous off-chain actor.
 *
 *  - Uncontested no-shows: when a business files a no-show, a dispute window
 *    opens. After it closes with no dispute, anyone may settle the booking; the
 *    keeper does this automatically (settleNoShow needs no special role).
 *  - Disputed no-shows: resolving a dispute requires the trusted arbiter
 *    (`verifier`). There is no objective on-chain ground truth for "did the
 *    customer show up," so the keeper only *surfaces* disputes; a human arbiter
 *    runs `resolve <bookingId> <present>`.
 */

const KEEPER_KEY = process.env.KEEPER_PRIVATE_KEY ?? process.env.VERIFIER_PRIVATE_KEY ?? "";

/** Settle an uncontested no-show once its dispute window has elapsed. */
export async function settle(bookingId: number): Promise<void> {
  if (!KEEPER_KEY) throw new Error("KEEPER_PRIVATE_KEY not set");
  const sb = getSkinBookWrite(KEEPER_KEY);
  const tx = await sb.settleNoShow(bookingId);
  const rc = await tx.wait();
  console.log(`[keeper] settled no-show #${bookingId} in tx ${rc?.hash}`);
}

/** Arbiter resolves a disputed no-show. `present` = customer was actually there. */
export async function resolve(bookingId: number, present: boolean): Promise<void> {
  if (!KEEPER_KEY) throw new Error("KEEPER_PRIVATE_KEY (arbiter) not set");
  const sb = getSkinBookWrite(KEEPER_KEY);
  const tx = await sb.resolveDispute(bookingId, present);
  const rc = await tx.wait();
  console.log(
    `[keeper] resolved dispute #${bookingId}: customerPresent=${present} -> ${
      present ? "REFUND customer" : "SLASH to business"
    } (tx ${rc?.hash})`
  );
}

/** Watch for no-show claims and disputes; auto-settle once windows elapse. */
export async function watch(): Promise<void> {
  if (!env.skinBookAddr) throw new Error("SKINBOOK_ADDR not set");
  const read = getSkinBookRead()!;
  const disputeWindow = Number(await read.disputeWindow());
  const sb = new ethers.Contract(env.skinBookAddr, SKINBOOK_ABI, getProvider());
  console.log(`[keeper] watching ${env.skinBookAddr} (dispute window ${disputeWindow}s)...`);

  sb.on("NoShowClaimed", async (bookingId: bigint, _businessId: bigint, at: bigint) => {
    const id = Number(bookingId);
    const settleAt = Number(at) + disputeWindow + 2;
    const waitMs = Math.max(0, settleAt * 1000 - Date.now());
    console.log(`[keeper] no-show filed on #${id}; will settle in ~${Math.round(waitMs / 1000)}s if undisputed`);
    setTimeout(async () => {
      try {
        const bk = await read.bookings(id);
        if (Number(bk.status) === 3 /* NoShowClaimed */) await settle(id);
        else console.log(`[keeper] #${id} no longer settleable (status ${Number(bk.status)})`);
      } catch (e) {
        console.error(`[keeper] settle #${id} failed:`, e);
      }
    }, waitMs);
  });

  sb.on("Disputed", (bookingId: bigint) => {
    console.log(
      `[keeper] booking #${Number(bookingId)} DISPUTED — needs an arbiter. Run: tsx keeper/index.ts resolve ${Number(
        bookingId
      )} <true|false>`
    );
  });
}

// CLI: watch | settle <id> | resolve <id> <true|false>
if (process.argv[1] && process.argv[1].endsWith("index.ts")) {
  const [cmd, a, b] = process.argv.slice(2);
  const run = async () => {
    if (cmd === "settle" && a) return settle(Number(a));
    if (cmd === "resolve" && a) return resolve(Number(a), String(b) === "true");
    return watch();
  };
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
