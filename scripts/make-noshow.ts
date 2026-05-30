import { ethers } from "hardhat";

/**
 * Creates a single pending no-show (status NoShowClaimed) on a grace-0 business,
 * so the off-chain keeper's `watch` loop can be observed auto-settling it once
 * the dispute window elapses. Prints the booking id. BIZ_ID env selects the
 * business (default 5 = "Northside Health Clinic", grace 0).
 */
const fromUsdc = (v: bigint) => Number(v) / 1e6;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const blockTime = async () => (await ethers.provider.getBlock("latest"))!.timestamp;

async function main() {
  const addr = process.env.SKINBOOK_ADDR;
  if (!addr) throw new Error("Set SKINBOOK_ADDR");
  const bizId = Number(process.env.BIZ_ID ?? 5);

  const [deployer] = await ethers.getSigners();
  const sb = await ethers.getContractAt("SkinBook", addr, deployer);
  const usdc = await ethers.getContractAt("MockUSDC", await sb.usdc(), deployer);

  const b = await sb.businesses(bizId);
  if (!b.active) throw new Error(`business #${bizId} is not active`);
  const deposit = b.depositAmount as bigint;

  await (await usdc.approve(addr, deposit)).wait();
  const slot = (await blockTime()) + 10;
  const rcBook = await (await sb.book(bizId, slot)).wait();
  const bookingId = rcBook!.logs
    .map((l) => { try { return sb.interface.parseLog(l); } catch { return null; } })
    .find((p) => p?.name === "Booked")!.args.bookingId as bigint;
  console.log(`Booked #${bookingId} at biz #${bizId} (deposit ${fromUsdc(deposit)} USDC), slot +10s`);

  for (;;) {
    if ((await blockTime()) >= Number(slot)) break;
    await sleep(3000);
  }
  await (await sb.claimNoShow(bookingId)).wait();
  console.log(`claimNoShow #${bookingId} -> NoShowClaimed. Keeper should auto-settle after the dispute window.`);
  console.log(`PENDING_NOSHOW=${bookingId}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
