import type { Activity, Business, DashboardState, Tier } from "./types";

const VAULT_APY = 0.061; // Moonwell ERC4626 USDC vault, ~6.1%

function tierFor(b: { bookingsHonored: number; noShows: number }): Tier {
  const total = b.bookingsHonored + b.noShows;
  if (total < 10) return "new";
  const rate = b.bookingsHonored / total;
  return rate >= 0.9 ? "trusted" : "watch";
}

const base: Omit<Business, "tier" | "score">[] = [
  {
    businessId: 1,
    name: "Tony's Bistro",
    category: "Restaurant",
    owner: "0x9A3f4cE1b7D2e8F05a1C6b4D3e2F1a0B9c8D7e6F",
    depositUsd: 2,
    principalHeldUsd: 48,
    depositsHeldUsd: 48.21,
    apy: VAULT_APY,
    bookingsHonored: 214,
    noShows: 17,
    activeBookings: 24,
    active: true,
  },
  {
    businessId: 2,
    name: "Bright Smile Dental",
    category: "Dental",
    owner: "0x3D7bA2c9E1f0584B6a2C1d8E7f6A5b4C3d2E1f0a",
    depositUsd: 1.5,
    principalHeldUsd: 18,
    depositsHeldUsd: 18.07,
    apy: VAULT_APY,
    bookingsHonored: 96,
    noShows: 8,
    activeBookings: 12,
    active: true,
  },
  {
    businessId: 3,
    name: "Fade Room Barbers",
    category: "Barber",
    owner: "0x1F0e2D3c4B5a69788776655443322110aAbBcCdD",
    depositUsd: 1,
    principalHeldUsd: 7,
    depositsHeldUsd: 7.01,
    apy: VAULT_APY,
    bookingsHonored: 5,
    noShows: 1,
    activeBookings: 7,
    active: true,
  },
];

export function scoreBusiness(b: Business): number {
  const total = b.bookingsHonored + b.noShows;
  const reliability = total > 0 ? b.bookingsHonored / total : 1;
  return reliability * Math.log10(10 + total);
}

const businesses: Business[] = base.map((b) => {
  const tier = tierFor(b);
  const full = { ...b, tier, score: 0 } as Business;
  full.score = scoreBusiness(full);
  return full;
});

const now = Date.now();
const activity: Activity[] = [
  { id: "a1", kind: "noshow", businessId: 1, businessName: "Tony's Bistro", text: "No-show settled — $2.00 deposit slashed to the business", amountUsd: 2, txHash: "0x8f2a…d41c", at: now - 1000 * 38 },
  { id: "a2", kind: "booking", businessId: 2, businessName: "Bright Smile Dental", text: "New booking — $1.50 deposit supplied to Moonwell", amountUsd: 1.5, txHash: "0x2c9b…77ea", at: now - 1000 * 88 },
  { id: "a3", kind: "attended", businessId: 1, businessName: "Tony's Bistro", text: "Guest showed — deposit + yield refunded", amountUsd: 2.01, txHash: "0x4d1e…11a2", at: now - 1000 * 140 },
  { id: "a4", kind: "cancel", businessId: 3, businessName: "Fade Room Barbers", text: "Cancelled in time — full refund + yield", amountUsd: 1.0, txHash: "0x77c3…9b0d", at: now - 1000 * 195 },
  { id: "a5", kind: "yield", businessId: 1, businessName: "Tony's Bistro", text: "Moonwell yield accruing on held deposits", amountUsd: 0.21, at: now - 1000 * 250 },
  { id: "a6", kind: "register", businessId: 3, businessName: "Fade Room Barbers", text: "Listed with a $1.00 no-show deposit policy", txHash: "0x55ab…0a91", at: now - 1000 * 640 },
];

export function demoState(): DashboardState {
  return {
    live: false,
    network: "Base Sepolia",
    vaultApy: VAULT_APY,
    businesses,
    activity,
  };
}
