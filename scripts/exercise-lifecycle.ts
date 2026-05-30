import { ethers } from "hardhat";

/**
 * Drives the full SkinBook booking lifecycle on the LIVE chain so the dashboard
 * activity feed shows every outcome: cancel, attendance, no-show settle, and
 * both dispute resolutions.
 *
 * The deployer plays every role (business owner, customer, arbiter) — fine for a
 * testnet demo. Deposits are faucet-scale (minDeposit). The two terminal
 * settlements that the OFF-CHAIN KEEPER owns (settleNoShow, resolveDispute) are
 * intentionally left for the keeper to perform, so running the keeper afterwards
 * exercises it end-to-end against the live contract. This script drives the rest:
 *
 *   A) book -> cancel                    => Refunded   (Cancelled event)
 *   B) book -> confirmAttendance         => Refunded   (AttendanceConfirmed)
 *   C) book -> claimNoShow               => NoShowClaimed   [keeper: settleNoShow]
 *   D) book -> claimNoShow -> dispute    => Disputed        [keeper: resolve false]
 *   E) book -> claimNoShow -> dispute    => Disputed        [keeper: resolve true]
 *
 * Prints C/D/E booking ids at the end for the keeper step.
 */

const USDC = (n: number) => BigInt(Math.round(n * 1e6));
const fromUsdc = (v: bigint) => Number(v) / 1e6;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function blockTime(): Promise<number> {
  return (await ethers.provider.getBlock("latest"))!.timestamp;
}

async function waitUntil(ts: number, label: string) {
  process.stdout.write(`   waiting until ${label} (${new Date(ts * 1000).toISOString()})`);
  // poll the chain clock, not wall clock — claimNoShow checks block.timestamp
  for (;;) {
    const now = await blockTime();
    if (now >= ts) break;
    process.stdout.write(".");
    await sleep(3000);
  }
  process.stdout.write(" ✓\n");
}

async function eventArg(rc: any, sb: any, name: string, arg: string): Promise<bigint> {
  const parsed = rc!.logs
    .map((l: any) => { try { return sb.interface.parseLog(l); } catch { return null; } })
    .find((p: any) => p?.name === name);
  if (!parsed) throw new Error(`event ${name} not found`);
  return parsed.args[arg] as bigint;
}

const DISPUTE_WINDOW = Number(process.env.DEMO_DISPUTE_WINDOW ?? 30); // seconds

async function main() {
  const addr = process.env.SKINBOOK_ADDR;
  if (!addr) throw new Error("Set SKINBOOK_ADDR");

  const [deployer] = await ethers.getSigners();
  const sb = await ethers.getContractAt("SkinBook", addr, deployer);
  const usdc = await ethers.getContractAt("MockUSDC", await sb.usdc(), deployer);

  console.log(`Signer ${deployer.address}`);
  console.log(`USDC balance ${fromUsdc(await usdc.balanceOf(deployer.address))}\n`);

  // 0) Shrink the dispute window so settle/dispute are demoable in real time.
  if (Number(await sb.disputeWindow()) !== DISPUTE_WINDOW) {
    console.log(`Setting disputeWindow -> ${DISPUTE_WINDOW}s`);
    await (await sb.setDisputeWindow(DISPUTE_WINDOW)).wait();
  }

  // 1) Register three fast-demo businesses (grace 0 so a no-show is claimable the
  //    instant the slot passes; small cancellation window).
  const demoBiz = [
    { name: "Lumen Day Spa", deposit: USDC(0.5), cancelWindow: 60, grace: 0 },
    { name: "Northside Health Clinic", deposit: USDC(0.5), cancelWindow: 60, grace: 0 },
    { name: "Apex Ink Studio", deposit: USDC(0.5), cancelWindow: 60, grace: 0 },
  ];
  const bizIds: bigint[] = [];
  for (const b of demoBiz) {
    const rc = await (await sb.registerBusiness(b.name, b.deposit, b.cancelWindow, b.grace)).wait();
    const id = await eventArg(rc, sb, "BusinessRegistered", "businessId");
    bizIds.push(id);
    console.log(`Registered business #${id} "${b.name}" (deposit ${fromUsdc(b.deposit)} USDC, grace ${b.grace}s)`);
  }
  const [bizA, bizB, bizC] = bizIds;

  // Approve enough USDC for the 5 demo deposits up front.
  await (await usdc.approve(addr, USDC(0.5) * 5n)).wait();
  console.log(`Approved 2.5 USDC to SkinBook\n`);

  const book = async (bizId: bigint, secsAhead: number, tag: string): Promise<bigint> => {
    const slot = (await blockTime()) + secsAhead;
    const rc = await (await sb.book(bizId, slot)).wait();
    const id = await eventArg(rc, sb, "Booked", "bookingId");
    console.log(`[${tag}] Booked #${id} at biz #${bizId}, slot +${secsAhead}s`);
    return id;
  };

  // 2) A) cancel-in-time flow  (far-out slot so cancel window is open)
  console.log("--- A) cancel flow ---");
  const cancelId = await book(bizA, 3600, "A");
  await (await sb.cancel(cancelId)).wait();
  console.log(`[A] Cancelled #${cancelId} -> refunded (+ yield)\n`);

  // 3) B) attendance flow
  console.log("--- B) attendance flow ---");
  const attendId = await book(bizA, 3600, "B");
  await (await sb.confirmAttendance(attendId)).wait();
  console.log(`[B] Confirmed attendance #${attendId} -> refunded\n`);

  // 4) C/D/E) no-show + dispute setup. Book all three at near slots, wait once.
  console.log("--- C/D/E) no-show + dispute setup ---");
  const settleId = await book(bizB, 10, "C"); // -> keeper settles
  const slashId = await book(bizC, 10, "D");  // -> keeper resolves false (slash)
  const refundId = await book(bizC, 10, "E"); // -> keeper resolves true (refund)

  const slotPassed = (await blockTime()) + 12;
  await waitUntil(slotPassed, "slots elapse");

  for (const id of [settleId, slashId, refundId]) {
    await (await sb.claimNoShow(id)).wait();
    console.log(`   claimNoShow #${id} -> NoShowClaimed`);
  }
  // Customer disputes D and E (within the window); C is left uncontested.
  for (const id of [slashId, refundId]) {
    await (await sb.dispute(id)).wait();
    console.log(`   dispute #${id} -> Disputed`);
  }

  console.log("\n=== Setup complete. Hand off to the off-chain keeper: ===");
  console.log(`  C (uncontested no-show, settle after ${DISPUTE_WINDOW}s):`);
  console.log(`     cd offchain && npx tsx keeper/index.ts settle ${settleId}`);
  console.log(`  D (disputed, arbiter slashes):`);
  console.log(`     cd offchain && npx tsx keeper/index.ts resolve ${slashId} false`);
  console.log(`  E (disputed, arbiter refunds):`);
  console.log(`     cd offchain && npx tsx keeper/index.ts resolve ${refundId} true`);
  console.log(`\nKEEPER_IDS settle=${settleId} slash=${slashId} refund=${refundId}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
