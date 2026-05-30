import type { Activity, Agent, DashboardState } from "./types";

const VAULT_APY = 0.061; // Moonwell ERC4626 USDC vault, ~6.1%

const agents: Agent[] = [
  {
    agentId: 1,
    name: "Good Agent",
    profile: "good",
    operator: "0x9A3f4cE1b7D2e8F05a1C6b4D3e2F1a0B9c8D7e6F",
    endpoint: "https://good.proofstake.dev/mcp",
    principalUsd: 1000,
    bondUsd: 1004.18,
    apy: VAULT_APY,
    jobsServed: 142,
    jobsSuccessful: 141,
    timesSlashed: 0,
    priceUsd: 0.002,
    active: true,
    score: 0,
  },
  {
    agentId: 2,
    name: "Mediocre Agent",
    profile: "mediocre",
    operator: "0x3D7bA2c9E1f0584B6a2C1d8E7f6A5b4C3d2E1f0a",
    endpoint: "https://mediocre.proofstake.dev/mcp",
    principalUsd: 400,
    bondUsd: 401.67,
    apy: VAULT_APY,
    jobsServed: 88,
    jobsSuccessful: 71,
    timesSlashed: 1,
    priceUsd: 0.001,
    active: true,
    score: 0,
  },
  {
    agentId: 3,
    name: "Malicious Agent",
    profile: "malicious",
    operator: "0x1F0e2D3c4B5a69788776655443322110aAbBcCdD",
    endpoint: "https://malicious.proofstake.dev/mcp",
    principalUsd: 100,
    bondUsd: 0,
    apy: VAULT_APY,
    jobsServed: 12,
    jobsSuccessful: 3,
    timesSlashed: 1,
    priceUsd: 0.0005,
    active: false,
    score: 0,
  },
];

export function scoreAgent(a: Agent): number {
  if (!a.priceUsd || !a.active) return 0;
  const successRate = a.jobsServed > 0 ? a.jobsSuccessful / a.jobsServed : 0.5;
  const slashPenalty = a.timesSlashed > 0 ? 0.1 : 1;
  const reputation = (0.5 + 0.5 * successRate) * Math.log10(10 + a.bondUsd) * slashPenalty;
  return reputation / a.priceUsd;
}

const now = Date.now();
const activity: Activity[] = [
  { id: "a1", kind: "slash", agentId: 3, agentName: "Malicious Agent", text: "Challenge #7 upheld — bond slashed to challenger", amountUsd: 100, txHash: "0x8f2a…d41c", at: now - 1000 * 42 },
  { id: "a2", kind: "challenge", agentId: 3, agentName: "Malicious Agent", text: "Client challenged output of req 0x3b…91 (returned 42)", amountUsd: 0.5, txHash: "0x2c9b…77ea", at: now - 1000 * 95 },
  { id: "a3", kind: "job", agentId: 1, agentName: "Good Agent", text: "Served math task — paid $0.002 via x402", amountUsd: 0.002, at: now - 1000 * 130 },
  { id: "a4", kind: "job", agentId: 2, agentName: "Mediocre Agent", text: "Served math task — paid $0.001 via x402", amountUsd: 0.001, at: now - 1000 * 180 },
  { id: "a5", kind: "yield", agentId: 1, agentName: "Good Agent", text: "Moonwell yield accrued on idle bond", amountUsd: 4.18, at: now - 1000 * 240 },
  { id: "a6", kind: "register", agentId: 1, agentName: "Good Agent", text: "Bonded 1,000 USDC into Moonwell vault", amountUsd: 1000, txHash: "0x55ab…0a91", at: now - 1000 * 600 },
];

export function demoState(): DashboardState {
  const enriched = agents.map((a) => ({ ...a, score: scoreAgent(a) }));
  return {
    live: false,
    network: "Base Sepolia",
    vaultApy: VAULT_APY,
    agents: enriched,
    activity,
  };
}
