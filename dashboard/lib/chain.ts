import { ethers } from "ethers";
import type { Activity, Business, DashboardState, Tier } from "./types";
import { scoreBusiness, demoState } from "./demo";

const ABI = [
  "function businessCount() view returns (uint256)",
  "function bookingCount() view returns (uint256)",
  "function businesses(uint256) view returns (address owner, string name, uint256 depositAmount, uint64 cancellationWindow, uint64 gracePeriod, uint64 bookingsHonored, uint64 noShows, bool active)",
  "function bookings(uint256) view returns (uint256 businessId, address customer, uint64 slotTime, uint256 shares, uint64 claimedAt, uint8 status)",
  "function bookingValue(uint256) view returns (uint256)",
  "event BusinessRegistered(uint256 indexed businessId, address indexed owner, string name, uint256 depositAmount)",
  "event Booked(uint256 indexed bookingId, uint256 indexed businessId, address indexed customer, uint64 slotTime, uint256 deposit, uint256 shares)",
  "event Cancelled(uint256 indexed bookingId, uint256 indexed businessId, address indexed customer, uint256 refund)",
  "event AttendanceConfirmed(uint256 indexed bookingId, uint256 indexed businessId, address indexed customer, uint256 refund)",
  "event NoShowSettled(uint256 indexed bookingId, uint256 indexed businessId, uint256 toBusiness, uint256 fee)",
  "event DisputeResolved(uint256 indexed bookingId, uint256 indexed businessId, bool customerPresent, uint256 payout, uint256 fee)",
];

const fromUsdc = (v: bigint) => Number(v) / 1e6;
const VAULT_APY = Number(process.env.VAULT_APY ?? 0.061);

// Active = deposit still held in the vault: Booked(1), NoShowClaimed(3), Disputed(4).
const ACTIVE_STATUS = new Set([1, 3, 4]);

function tierFor(honored: number, noShows: number): Tier {
  const total = honored + noShows;
  if (total < 10) return "new";
  return honored / total >= 0.9 ? "trusted" : "watch";
}

const CATEGORIES = ["Restaurant", "Dental", "Barber", "Clinic", "Salon", "Studio"];
const guessCategory = (name: string, i: number) => {
  const n = name.toLowerCase();
  if (n.includes("bistro") || n.includes("kitchen") || n.includes("grill")) return "Restaurant";
  if (n.includes("dental") || n.includes("smile")) return "Dental";
  if (n.includes("barber") || n.includes("fade") || n.includes("cuts")) return "Barber";
  if (n.includes("clinic") || n.includes("health")) return "Clinic";
  if (n.includes("salon") || n.includes("hair") || n.includes("nails")) return "Salon";
  return CATEGORIES[i % CATEGORIES.length];
};

/**
 * Reads live state from a deployed SkinBook. Falls back to the demo dataset when
 * no address/RPC is configured or the read fails — so the dashboard is always
 * presentable, and lights up automatically once pointed at a chain.
 *
 * Per business we sum the current redeemable value of every *active* deposit
 * (principal + accrued Moonwell yield) and derive principal from Booked events,
 * then build the activity feed from on-chain events.
 */
export async function getState(): Promise<DashboardState> {
  const addr = process.env.SKINBOOK_ADDR;
  const rpc = process.env.RPC_URL;
  if (!addr || !rpc) return demoState();

  try {
    const provider = new ethers.JsonRpcProvider(rpc);
    const sb = new ethers.Contract(addr, ABI, provider);
    const bizCount = Number(await sb.businessCount());
    const bookingCount = Number(await sb.bookingCount());

    // Principal per booking, from Booked events.
    const principalByBooking = new Map<number, number>();
    const bookedLogs = await safeQuery(sb, sb.filters.Booked(), provider);
    for (const log of bookedLogs) {
      const ev = log as ethers.EventLog;
      principalByBooking.set(Number(ev.args.bookingId), fromUsdc(ev.args.deposit));
    }

    // Aggregate active deposits per business.
    const heldByBiz = new Map<number, number>();
    const principalByBiz = new Map<number, number>();
    const activeByBiz = new Map<number, number>();
    for (let id = 1; id <= bookingCount; id++) {
      const bk = await sb.bookings(id);
      const status = Number(bk.status);
      if (!ACTIVE_STATUS.has(status)) continue;
      const biz = Number(bk.businessId);
      const held = fromUsdc(await sb.bookingValue(id));
      heldByBiz.set(biz, (heldByBiz.get(biz) ?? 0) + held);
      principalByBiz.set(biz, (principalByBiz.get(biz) ?? 0) + (principalByBooking.get(id) ?? held));
      activeByBiz.set(biz, (activeByBiz.get(biz) ?? 0) + 1);
    }

    const businesses: Business[] = [];
    for (let id = 1; id <= bizCount; id++) {
      const b = await sb.businesses(id);
      const honored = Number(b.bookingsHonored);
      const noShows = Number(b.noShows);
      const biz: Business = {
        businessId: id,
        name: b.name || `Business #${id}`,
        category: guessCategory(b.name ?? "", id - 1),
        owner: b.owner,
        depositUsd: fromUsdc(b.depositAmount),
        depositsHeldUsd: heldByBiz.get(id) ?? 0,
        principalHeldUsd: principalByBiz.get(id) ?? 0,
        apy: VAULT_APY,
        bookingsHonored: honored,
        noShows,
        activeBookings: activeByBiz.get(id) ?? 0,
        active: b.active,
        tier: tierFor(honored, noShows),
        score: 0,
      };
      biz.score = scoreBusiness(biz);
      businesses.push(biz);
    }

    const nameById = new Map(businesses.map((b) => [b.businessId, b.name]));
    const activity = await buildActivity(sb, provider, nameById);

    return {
      live: true,
      network: process.env.NETWORK_NAME ?? "Base Sepolia",
      vaultApy: VAULT_APY,
      businesses: businesses.sort((x, y) => y.score - x.score),
      activity: activity.length ? activity : demoState().activity,
    };
  } catch {
    return demoState();
  }
}

async function safeQuery(
  sb: ethers.Contract,
  filter: ethers.DeferredTopicFilter,
  provider: ethers.JsonRpcProvider
): Promise<(ethers.EventLog | ethers.Log)[]> {
  try {
    const latest = await provider.getBlockNumber();
    const startEnv = process.env.SKINBOOK_START_BLOCK;
    const lookback = Number(process.env.SKINBOOK_LOOKBACK ?? 9000);
    const from = startEnv ? Number(startEnv) : Math.max(0, latest - lookback);
    return await sb.queryFilter(filter, from, latest);
  } catch {
    return [];
  }
}

const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

/** Build the activity feed from on-chain events, newest first. */
async function buildActivity(
  sb: ethers.Contract,
  provider: ethers.JsonRpcProvider,
  nameById: Map<number, string>
): Promise<Activity[]> {
  const [regs, booked, cancels, attended, noshows, disputes] = await Promise.all([
    safeQuery(sb, sb.filters.BusinessRegistered(), provider),
    safeQuery(sb, sb.filters.Booked(), provider),
    safeQuery(sb, sb.filters.Cancelled(), provider),
    safeQuery(sb, sb.filters.AttendanceConfirmed(), provider),
    safeQuery(sb, sb.filters.NoShowSettled(), provider),
    safeQuery(sb, sb.filters.DisputeResolved(), provider),
  ]);

  const blockTimes = new Map<number, number>();
  const timeOf = async (bn: number): Promise<number> => {
    if (!blockTimes.has(bn)) {
      const b = await provider.getBlock(bn);
      blockTimes.set(bn, (b?.timestamp ?? 0) * 1000);
    }
    return blockTimes.get(bn)!;
  };
  const name = (id: number) => nameById.get(id) ?? `Business #${id}`;
  const out: Activity[] = [];

  for (const log of regs) {
    const ev = log as ethers.EventLog;
    const id = Number(ev.args.businessId);
    out.push({
      id: `reg-${ev.transactionHash}-${ev.index}`,
      kind: "register",
      businessId: id,
      businessName: name(id),
      text: `Listed with a ${fromUsdc(ev.args.depositAmount).toFixed(2)} USDC no-show deposit policy`,
      txHash: short(ev.transactionHash),
      at: await timeOf(ev.blockNumber),
    });
  }
  for (const log of booked) {
    const ev = log as ethers.EventLog;
    const id = Number(ev.args.businessId);
    out.push({
      id: `bk-${ev.transactionHash}-${ev.index}`,
      kind: "booking",
      businessId: id,
      businessName: name(id),
      text: `New booking — ${fromUsdc(ev.args.deposit).toFixed(2)} USDC deposit supplied to Moonwell`,
      amountUsd: fromUsdc(ev.args.deposit),
      txHash: short(ev.transactionHash),
      at: await timeOf(ev.blockNumber),
    });
  }
  for (const log of cancels) {
    const ev = log as ethers.EventLog;
    const id = Number(ev.args.businessId);
    out.push({
      id: `cx-${ev.transactionHash}-${ev.index}`,
      kind: "cancel",
      businessId: id,
      businessName: name(id),
      text: `Cancelled in time — full refund + yield`,
      amountUsd: fromUsdc(ev.args.refund),
      txHash: short(ev.transactionHash),
      at: await timeOf(ev.blockNumber),
    });
  }
  for (const log of attended) {
    const ev = log as ethers.EventLog;
    const id = Number(ev.args.businessId);
    out.push({
      id: `at-${ev.transactionHash}-${ev.index}`,
      kind: "attended",
      businessId: id,
      businessName: name(id),
      text: `Guest showed — deposit + yield refunded`,
      amountUsd: fromUsdc(ev.args.refund),
      txHash: short(ev.transactionHash),
      at: await timeOf(ev.blockNumber),
    });
  }
  for (const log of noshows) {
    const ev = log as ethers.EventLog;
    const id = Number(ev.args.businessId);
    out.push({
      id: `ns-${ev.transactionHash}-${ev.index}`,
      kind: "noshow",
      businessId: id,
      businessName: name(id),
      text: `No-show settled — deposit slashed to the business`,
      amountUsd: fromUsdc(ev.args.toBusiness),
      txHash: short(ev.transactionHash),
      at: await timeOf(ev.blockNumber),
    });
  }
  for (const log of disputes) {
    const ev = log as ethers.EventLog;
    const id = Number(ev.args.businessId);
    const present = Boolean(ev.args.customerPresent);
    out.push({
      id: `dr-${ev.transactionHash}-${ev.index}`,
      kind: present ? "attended" : "noshow",
      businessId: id,
      businessName: name(id),
      text: present
        ? `Dispute resolved — customer was present, deposit refunded`
        : `Dispute resolved — no-show upheld, deposit slashed`,
      amountUsd: fromUsdc(ev.args.payout),
      txHash: short(ev.transactionHash),
      at: await timeOf(ev.blockNumber),
    });
  }

  return out.sort((a, b) => b.at - a.at).slice(0, 12);
}
