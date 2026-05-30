import { ethers } from "ethers";
import type { Activity, Agent, DashboardState, Profile } from "./types";
import { scoreAgent, demoState } from "./demo";

const ABI = [
  "function agentCount() view returns (uint256)",
  "function agents(uint256) view returns (address operator, string endpoint, uint256 shares, uint64 jobsServed, uint64 jobsSuccessful, uint64 timesSlashed, bool active, uint64 deactivatedAt)",
  "function bondValue(uint256) view returns (uint256)",
  "event AgentRegistered(uint256 indexed agentId, address indexed operator, string endpoint, uint256 bond, uint256 shares)",
  "event ChallengeOpened(uint256 indexed challengeId, uint256 indexed agentId, address indexed challenger, bytes32 requestId, string evidenceURI, uint256 bond)",
  "event ChallengeResolved(uint256 indexed challengeId, uint256 indexed agentId, bool upheld, uint256 payout, uint256 fee)",
  "event JobRecorded(uint256 indexed agentId, bytes32 indexed requestId, bool success)",
];

const fromUsdc = (v: bigint) => Number(v) / 1e6;
const VAULT_APY = Number(process.env.VAULT_APY ?? 0.061);

interface AgentInfo {
  name?: string;
  profile?: Profile;
  priceUsd?: number;
}

/** Server-side fetch of an agent's /info, with a short timeout. */
async function fetchInfo(endpoint: string): Promise<AgentInfo> {
  try {
    const r = await fetch(`${endpoint.replace(/\/$/, "")}/info`, {
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    });
    if (!r.ok) return {};
    const j = await r.json();
    return { name: j.name, profile: j.profile, priceUsd: j.priceUsd };
  } catch {
    return {};
  }
}

/**
 * Reads live state from a deployed ProofStake. Falls back to the demo dataset
 * when no address/RPC is configured or the read fails — so the dashboard is
 * always presentable, and lights up automatically once pointed at a chain.
 *
 * Live mode enriches each agent with its off-chain /info (name, profile, price),
 * derives the original bond principal from AgentRegistered events (so accrued
 * Morpho yield = bondValue − principal), and builds the activity feed from
 * on-chain events instead of the demo placeholder.
 */
export async function getState(): Promise<DashboardState> {
  const addr = process.env.PROOFSTAKE_ADDR;
  const rpc = process.env.RPC_URL;
  if (!addr || !rpc) return demoState();

  try {
    const provider = new ethers.JsonRpcProvider(rpc);
    const ps = new ethers.Contract(addr, ABI, provider);
    const count = Number(await ps.agentCount());

    // Original bonds, keyed by agentId, from registration events.
    const principalById = new Map<number, number>();
    const regLogs = await safeQuery(ps, ps.filters.AgentRegistered(), provider);
    for (const log of regLogs) {
      const ev = log as ethers.EventLog;
      principalById.set(Number(ev.args.agentId), fromUsdc(ev.args.bond));
    }

    const agents: Agent[] = [];
    for (let id = 1; id <= count; id++) {
      const a = await ps.agents(id);
      const bondUsd = fromUsdc(await ps.bondValue(id));
      const info = await fetchInfo(a.endpoint);
      const principalUsd = principalById.get(id) ?? bondUsd;
      const agent: Agent = {
        agentId: id,
        name: info.name ?? `Agent #${id}`,
        profile: info.profile ?? "good",
        operator: a.operator,
        endpoint: a.endpoint,
        principalUsd,
        bondUsd,
        apy: VAULT_APY,
        jobsServed: Number(a.jobsServed),
        jobsSuccessful: Number(a.jobsSuccessful),
        timesSlashed: Number(a.timesSlashed),
        priceUsd: info.priceUsd ?? 0.001,
        active: a.active,
        score: 0,
      };
      agent.score = scoreAgent(agent);
      agents.push(agent);
    }

    const nameById = new Map(agents.map((a) => [a.agentId, a.name]));
    const activity = await buildActivity(ps, provider, nameById);

    return {
      live: true,
      network: process.env.NETWORK_NAME ?? "Base Sepolia",
      vaultApy: VAULT_APY,
      agents: agents.sort((x, y) => y.score - x.score),
      activity: activity.length ? activity : demoState().activity,
    };
  } catch {
    return demoState();
  }
}

/**
 * Query a single event filter across the indexed range. We bound the lookback so
 * the call stays under common RPC getLogs limits; set PROOFSTAKE_START_BLOCK to
 * the deploy block to capture the full history reliably.
 */
async function safeQuery(
  ps: ethers.Contract,
  filter: ethers.DeferredTopicFilter,
  provider: ethers.JsonRpcProvider
): Promise<(ethers.EventLog | ethers.Log)[]> {
  try {
    const latest = await provider.getBlockNumber();
    const startEnv = process.env.PROOFSTAKE_START_BLOCK;
    const lookback = Number(process.env.PROOFSTAKE_LOOKBACK ?? 9000);
    const from = startEnv ? Number(startEnv) : Math.max(0, latest - lookback);
    return await ps.queryFilter(filter, from, latest);
  } catch {
    return [];
  }
}

const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

/** Build the activity feed from on-chain events, newest first. */
async function buildActivity(
  ps: ethers.Contract,
  provider: ethers.JsonRpcProvider,
  nameById: Map<number, string>
): Promise<Activity[]> {
  const [regs, opens, resolves, jobs] = await Promise.all([
    safeQuery(ps, ps.filters.AgentRegistered(), provider),
    safeQuery(ps, ps.filters.ChallengeOpened(), provider),
    safeQuery(ps, ps.filters.ChallengeResolved(), provider),
    safeQuery(ps, ps.filters.JobRecorded(), provider),
  ]);

  const blockTimes = new Map<number, number>();
  const timeOf = async (bn: number): Promise<number> => {
    if (!blockTimes.has(bn)) {
      const b = await provider.getBlock(bn);
      blockTimes.set(bn, (b?.timestamp ?? 0) * 1000);
    }
    return blockTimes.get(bn)!;
  };
  const name = (id: number) => nameById.get(id) ?? `Agent #${id}`;

  const out: Activity[] = [];

  for (const log of regs) {
    const ev = log as ethers.EventLog;
    const agentId = Number(ev.args.agentId);
    out.push({
      id: `reg-${ev.transactionHash}-${ev.index}`,
      kind: "register",
      agentId,
      agentName: name(agentId),
      text: `Bonded ${fromUsdc(ev.args.bond).toFixed(2)} USDC into MetaMorpho vault`,
      amountUsd: fromUsdc(ev.args.bond),
      txHash: short(ev.transactionHash),
      at: await timeOf(ev.blockNumber),
    });
  }

  for (const log of jobs) {
    const ev = log as ethers.EventLog;
    const agentId = Number(ev.args.agentId);
    out.push({
      id: `job-${ev.transactionHash}-${ev.index}`,
      kind: "job",
      agentId,
      agentName: name(agentId),
      text: ev.args.success ? "Served a verified job via x402" : "Job recorded as failed",
      txHash: short(ev.transactionHash),
      at: await timeOf(ev.blockNumber),
    });
  }

  for (const log of opens) {
    const ev = log as ethers.EventLog;
    const agentId = Number(ev.args.agentId);
    out.push({
      id: `open-${ev.transactionHash}-${ev.index}`,
      kind: "challenge",
      agentId,
      agentName: name(agentId),
      text: `Client challenged output of req ${short(ev.args.requestId)}`,
      amountUsd: fromUsdc(ev.args.bond),
      txHash: short(ev.transactionHash),
      at: await timeOf(ev.blockNumber),
    });
  }

  for (const log of resolves) {
    const ev = log as ethers.EventLog;
    const agentId = Number(ev.args.agentId);
    const upheld = Boolean(ev.args.upheld);
    out.push({
      id: `res-${ev.transactionHash}-${ev.index}`,
      kind: upheld ? "slash" : "job",
      agentId,
      agentName: name(agentId),
      text: upheld
        ? `Challenge upheld — bond slashed to challenger`
        : `Challenge rejected — agent vindicated, bond awarded`,
      amountUsd: fromUsdc(ev.args.payout),
      txHash: short(ev.transactionHash),
      at: await timeOf(ev.blockNumber),
    });
  }

  return out.sort((a, b) => b.at - a.at).slice(0, 12);
}
