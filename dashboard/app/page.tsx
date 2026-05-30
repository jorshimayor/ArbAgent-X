"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DashboardState } from "@/lib/types";
import { Header } from "@/components/Header";
import { StatGrid } from "@/components/StatGrid";
import { AgentCard } from "@/components/AgentCard";
import { ActivityFeed } from "@/components/ActivityFeed";
import { RouterPanel } from "@/components/RouterPanel";

const SECONDS_PER_YEAR = 31_536_000;
// Visualization speed-up so Morpho yield is visibly accruing during a 3-min demo.
// Underlying bond values are real; only the live-accrual animation is scaled.
const ACCRUAL_SPEED = 1200;

export default function Page() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number>(Date.now());

  useEffect(() => {
    let alive = true;
    fetch("/api/state")
      .then((r) => r.json())
      .then((s: DashboardState) => alive && setState(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setElapsed((Date.now() - startRef.current) / 1000), 100);
    return () => clearInterval(t);
  }, []);

  const computed = useMemo(() => {
    if (!state) return null;
    const accruedFactor = (elapsed / SECONDS_PER_YEAR) * ACCRUAL_SPEED;
    let totalAccrued = 0;
    const agents = state.agents.map((a) => {
      const accrued = a.active ? a.bondUsd * a.apy * accruedFactor : 0;
      totalAccrued += accrued;
      return {
        agent: a,
        liveBond: a.bondUsd + accrued,
        liveYield: Math.max(0, a.bondUsd - a.principalUsd) + accrued,
      };
    });
    return { agents, totalAccrued };
  }, [state, elapsed]);

  if (!state || !computed) {
    return (
      <main className="grid min-h-screen place-items-center">
        <p className="animate-pulse text-white/40">Loading ProofStake…</p>
      </main>
    );
  }

  const topId = [...state.agents].filter((a) => a.active).sort((a, b) => b.score - a.score)[0]?.agentId;

  return (
    <main className="mx-auto max-w-6xl px-5 py-10 md:px-8 md:py-14">
      <Header live={state.live} network={state.network} />

      <div className="mt-10">
        <StatGrid agents={state.agents} accruedYield={computed.totalAccrued} vaultApy={state.vaultApy} />
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-white/60">Bonded agents</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {computed.agents.map((c, i) => (
              <AgentCard
                key={c.agent.agentId}
                agent={c.agent}
                liveBond={c.liveBond}
                liveYield={c.liveYield}
                isTop={c.agent.agentId === topId}
                index={i}
              />
            ))}
          </div>
          <div className="mt-6">
            <RouterPanel agents={state.agents} />
          </div>
        </div>

        <div className="lg:col-span-1">
          <ActivityFeed activity={state.activity} />
        </div>
      </div>

      <footer className="mt-12 border-t border-white/5 pt-6 text-center text-xs text-white/30">
        ProofStake · Built with Base MCP + Morpho + x402 · v1 uses a single trusted verifier (called out openly)
      </footer>
    </main>
  );
}
