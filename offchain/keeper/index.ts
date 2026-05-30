import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { getSkinBookWrite, getSkinBookRead, getProvider, env } from "../shared/chain.js";

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

// Public RPCs (e.g. sepolia.base.org) expire stateful event filters between
// polls (eth_getFilterChanges -> "filter not found") AND cap eth_getLogs to a
// few thousand blocks. So the watcher does NOT use contract.on(); it polls
// queryFilter over a bounded, chunked block window each tick — the same pattern
// the dashboard reader uses. This is robust on public RPCs and on mainnet.
const POLL_MS = Number(process.env.KEEPER_POLL_MS ?? 12_000);
const LOOKBACK = Number(process.env.KEEPER_LOOKBACK ?? 9_000);
const LOG_CHUNK = Number(process.env.KEEPER_LOG_CHUNK ?? 2_000);

const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errMsg = (e: any) => e?.shortMessage ?? e?.message ?? String(e);

/** Page queryFilter through [from,to] in chunks; a rejected chunk is skipped. */
async function scanLogs(
  contract: ethers.Contract,
  filter: ethers.DeferredTopicFilter,
  from: number,
  to: number
): Promise<ethers.EventLog[]> {
  const out: ethers.EventLog[] = [];
  for (let lo = from; lo <= to; lo += LOG_CHUNK) {
    const hi = Math.min(lo + LOG_CHUNK - 1, to);
    try {
      out.push(...((await contract.queryFilter(filter, lo, hi)) as ethers.EventLog[]));
    } catch {
      /* skip a chunk the RPC rejects rather than dropping the whole scan */
    }
  }
  return out;
}

/**
 * Watch for no-show claims and disputes; auto-settle uncontested no-shows once
 * their dispute window elapses. Idempotent: every tick re-scans the recent
 * window and re-reads on-chain status, so it self-heals across restarts and
 * never double-acts (a `settled`/`seen` set just trims duplicate logging).
 */
export async function watch(): Promise<void> {
  if (!env.skinBookAddr) throw new Error("SKINBOOK_ADDR not set");
  const read = getSkinBookRead()!;
  const provider = getProvider();
  const disputeWindow = Number(await read.disputeWindow());
  const canSettle = Boolean(KEEPER_KEY);
  console.log(
    `[keeper] polling ${env.skinBookAddr} every ${POLL_MS / 1000}s over ~${LOOKBACK} blocks ` +
      `(dispute window ${disputeWindow}s, settle ${canSettle ? "enabled" : "DISABLED — no key"})`
  );

  const settled = new Set<number>();
  const disputeSeen = new Set<number>();

  for (;;) {
    try {
      const latest = await provider.getBlockNumber();
      const from = Math.max(0, latest - LOOKBACK);
      const now = Math.floor(Date.now() / 1000);

      // 1) Settle uncontested no-shows whose dispute window has elapsed.
      for (const log of await scanLogs(read, read.filters.NoShowClaimed(), from, latest)) {
        const id = Number(log.args.bookingId);
        if (settled.has(id)) continue;
        const bk = await read.bookings(id);
        if (Number(bk.status) !== 3 /* NoShowClaimed */) {
          settled.add(id); // already resolved/disputed elsewhere
          continue;
        }
        const settleAt = Number(bk.claimedAt) + disputeWindow;
        if (now < settleAt) {
          console.log(`[keeper] #${id} no-show pending — settle in ${settleAt - now}s if undisputed`);
          continue;
        }
        if (!canSettle) {
          console.log(`[keeper] #${id} ready to settle but no KEEPER_PRIVATE_KEY set`);
          continue;
        }
        try {
          await settle(id);
          settled.add(id);
        } catch (e) {
          console.error(`[keeper] settle #${id} failed:`, errMsg(e));
        }
      }

      // 2) Surface disputes — these need the human arbiter (no on-chain truth).
      for (const log of await scanLogs(read, read.filters.Disputed(), from, latest)) {
        const id = Number(log.args.bookingId);
        if (disputeSeen.has(id)) continue;
        disputeSeen.add(id);
        const bk = await read.bookings(id);
        if (Number(bk.status) === 4 /* Disputed */) {
          console.log(
            `[keeper] booking #${id} DISPUTED — needs an arbiter. Run: tsx keeper/index.ts resolve ${id} <true|false>`
          );
        }
      }
    } catch (e) {
      console.error("[keeper] poll error:", errMsg(e));
    }
    await sleepMs(POLL_MS);
  }
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
