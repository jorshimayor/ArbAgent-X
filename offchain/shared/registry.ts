import { getProofStakeRead, fromUsdc } from "./chain.js";
import type { AgentInfo } from "./types.js";

export interface EnrichedAgent {
  agentId: number;
  operator: string;
  endpoint: string;
  active: boolean;
  jobsServed: number;
  jobsSuccessful: number;
  timesSlashed: number;
  bondUsd: number;
  successRate: number; // 0..1, neutral 0.5 prior when no jobs yet
  online: boolean;
  name?: string;
  profile?: string;
  priceUsd?: number;
  score: number; // reputation-per-price; higher is better
}

/** Reputation-per-price score used by the router. Slashing tanks the score. */
export function scoreAgent(a: {
  successRate: number;
  bondUsd: number;
  timesSlashed: number;
  priceUsd?: number;
}): number {
  if (!a.priceUsd || a.priceUsd <= 0) return 0;
  const slashPenalty = a.timesSlashed > 0 ? 0.1 : 1;
  const reputation = (0.5 + 0.5 * a.successRate) * Math.log10(10 + a.bondUsd) * slashPenalty;
  return reputation / a.priceUsd;
}

async function fetchInfo(endpoint: string): Promise<AgentInfo | null> {
  try {
    const r = await fetch(`${endpoint.replace(/\/$/, "")}/info`, {
      signal: AbortSignal.timeout(2500),
    });
    return r.ok ? ((await r.json()) as AgentInfo) : null;
  } catch {
    return null;
  }
}

/** Read all agents from the registry and enrich with live off-chain info. */
export async function enrichActiveAgents(): Promise<EnrichedAgent[]> {
  const ps = getProofStakeRead();
  if (!ps) throw new Error("PROOFSTAKE_ADDR not set");

  const ids: bigint[] = await ps.listActive();
  const out: EnrichedAgent[] = [];

  for (const idB of ids) {
    const id = Number(idB);
    const a = await ps.agents(id);
    const bondUsd = fromUsdc(await ps.bondValue(id));
    const served = Number(a.jobsServed);
    const successful = Number(a.jobsSuccessful);
    const successRate = served > 0 ? successful / served : 0.5;

    const info = await fetchInfo(a.endpoint);

    out.push({
      agentId: id,
      operator: a.operator,
      endpoint: a.endpoint,
      active: a.active,
      jobsServed: served,
      jobsSuccessful: successful,
      timesSlashed: Number(a.timesSlashed),
      bondUsd,
      successRate,
      online: info !== null,
      name: info?.name,
      profile: info?.profile,
      priceUsd: info?.priceUsd,
      score: scoreAgent({ successRate, bondUsd, timesSlashed: Number(a.timesSlashed), priceUsd: info?.priceUsd }),
    });
  }

  return out.sort((x, y) => y.score - x.score);
}
