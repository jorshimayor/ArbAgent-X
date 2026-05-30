export type Profile = "good" | "mediocre" | "malicious";

export interface Agent {
  agentId: number;
  name: string;
  profile: Profile;
  operator: string;
  endpoint: string;
  bondUsd: number; // current redeemable value (principal + accrued yield)
  principalUsd: number; // original bond
  apy: number; // Moonwell vault APY, e.g. 0.061
  jobsServed: number;
  jobsSuccessful: number;
  timesSlashed: number;
  priceUsd: number;
  active: boolean;
  score: number;
}

export type ActivityKind = "job" | "challenge" | "slash" | "register" | "yield";

export interface Activity {
  id: string;
  kind: ActivityKind;
  agentId: number;
  agentName: string;
  text: string;
  amountUsd?: number;
  txHash?: string;
  at: number; // epoch ms
}

export interface DashboardState {
  live: boolean; // true if read from chain, false if demo data
  network: string;
  vaultApy: number;
  agents: Agent[];
  activity: Activity[];
}
