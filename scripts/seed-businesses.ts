import { ethers } from "hardhat";

const USDC = (n: number) => BigInt(Math.round(n * 1e6));
const fromUsdc = (v: bigint) => Number(v) / 1e6;

const DAY = 24 * 3600;

/**
 * Registers three demo businesses and seeds a couple of live bookings against a
 * deployed SkinBook.
 *
 * Deposit amounts are intentionally tiny so the whole demo fits inside Circle's
 * ~10 USDC/day Base Sepolia faucet. Set SKINBOOK_ADDR to the deployed address.
 * On a mock-USDC deployment the deployer is auto-minted; on real USDC the
 * deployer must already hold the funds.
 */
async function main() {
  const addr = process.env.SKINBOOK_ADDR;
  if (!addr) throw new Error("Set SKINBOOK_ADDR to the deployed SkinBook address");

  const [deployer] = await ethers.getSigners();
  const sb = await ethers.getContractAt("SkinBook", addr, deployer);
  const usdcAddr: string = await sb.usdc();
  const usdc = await ethers.getContractAt("MockUSDC", usdcAddr, deployer);

  const businesses = [
    { name: "Tony's Bistro", deposit: USDC(Number(process.env.DEPOSIT_BISTRO ?? 2)), cancelWindow: DAY, grace: 2 * 3600 },
    { name: "Bright Smile Dental", deposit: USDC(Number(process.env.DEPOSIT_DENTAL ?? 1.5)), cancelWindow: 2 * DAY, grace: 1 * 3600 },
    { name: "Fade Room Barbers", deposit: USDC(Number(process.env.DEPOSIT_BARBER ?? 1)), cancelWindow: 12 * 3600, grace: 30 * 60 },
  ];

  // Seed two bookings (so deposits sit in the vault accruing yield on the dashboard).
  const bookingsToSeed = 2;
  const totalDeposits = businesses
    .slice(0, bookingsToSeed)
    .reduce((s, b) => s + b.deposit, 0n);

  console.log(`Deposit for seeded bookings: ${fromUsdc(totalDeposits)} USDC`);

  // Mint for mock USDC; for real USDC verify the deployer is funded.
  try {
    const tx = await usdc.mint(deployer.address, totalDeposits);
    await tx.wait();
    console.log(`Minted ${fromUsdc(totalDeposits)} mock USDC to ${deployer.address}`);
  } catch {
    const bal: bigint = await usdc.balanceOf(deployer.address);
    console.log(`Real USDC — deployer balance: ${fromUsdc(bal)} USDC`);
    if (bal < totalDeposits) {
      throw new Error(
        `Deployer needs >= ${fromUsdc(totalDeposits)} USDC at ${usdcAddr}. Top up from the Circle Base Sepolia faucet.`
      );
    }
  }

  const ids: bigint[] = [];
  for (const b of businesses) {
    const rc = await (await sb.registerBusiness(b.name, b.deposit, b.cancelWindow, b.grace)).wait();
    // Read the id from the event, not a follow-up businessCount() call: public RPCs
    // can serve a stale read right after the tx and hand back the wrong id.
    const ev = rc!.logs
      .map((l) => { try { return sb.interface.parseLog(l); } catch { return null; } })
      .find((p) => p?.name === "BusinessRegistered");
    const id = ev!.args.businessId as bigint;
    ids.push(id);
    console.log(`Registered business #${id} -> ${b.name} (deposit ${fromUsdc(b.deposit)} USDC)`);
  }

  // Book one slot at each of the first two businesses (deployer plays the customer).
  const now = (await ethers.provider.getBlock("latest"))!.timestamp;
  for (let i = 0; i < bookingsToSeed; i++) {
    const id = ids[i];
    const deposit = businesses[i].deposit;
    await (await usdc.approve(addr, deposit)).wait();
    const slot = now + (i + 3) * DAY; // a few days out
    const rc = await (await sb.book(id, slot)).wait();
    const ev = rc!.logs
      .map((l) => { try { return sb.interface.parseLog(l); } catch { return null; } })
      .find((p) => p?.name === "Booked");
    const bookingId = ev!.args.bookingId as bigint;
    console.log(`Booked #${bookingId} at business #${id} for slot ${new Date(slot * 1000).toISOString()}`);
  }

  const active = (await sb.listActiveBusinesses()).map((x: bigint) => x.toString());
  console.log(`\nActive businesses: ${active.join(", ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
