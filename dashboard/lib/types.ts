export type Tier = "trusted" | "new" | "watch";

export interface Business {
  businessId: number;
  name: string;
  category: string; // e.g. "Restaurant", "Dental", "Barber"
  owner: string;
  depositUsd: number; // required deposit per booking
  depositsHeldUsd: number; // current redeemable value of active deposits (principal + yield)
  principalHeldUsd: number; // principal of active deposits
  apy: number; // Moonwell vault APY, e.g. 0.061
  bookingsHonored: number; // attended or cancelled in time
  noShows: number; // slashed no-shows
  activeBookings: number; // deposits currently held in the vault
  active: boolean;
  tier: Tier;
  score: number;
}

export type ActivityKind = "booking" | "cancel" | "attended" | "noshow" | "yield" | "register";

export interface Activity {
  id: string;
  kind: ActivityKind;
  businessId: number;
  businessName: string;
  text: string;
  amountUsd?: number;
  txHash?: string;
  at: number; // epoch ms
}

export interface DashboardState {
  live: boolean; // true if read from chain, false if demo data
  network: string;
  vaultApy: number;
  businesses: Business[];
  activity: Activity[];
}
