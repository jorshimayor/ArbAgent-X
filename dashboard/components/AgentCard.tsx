"use client";
import { motion } from "framer-motion";
import type { Agent } from "@/lib/types";
import { usd, usdMicro, short, pct } from "@/lib/format";

const PROFILE_META: Record<Agent["profile"], { tint: string; label: string }> = {
  good: { tint: "#34F5C5", label: "Reliable" },
  mediocre: { tint: "#FFB020", label: "Inconsistent" },
  malicious: { tint: "#FF4D6D", label: "Slashed" },
};

function RepRing({ rate, color }: { rate: number; color: string }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" className="-rotate-90">
      <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
      <motion.circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={c}
        initial={{ strokeDashoffset: c }}
        animate={{ strokeDashoffset: c * (1 - rate) }}
        transition={{ duration: 1.2, ease: "easeOut" }}
      />
    </svg>
  );
}

export function AgentCard({
  agent,
  liveBond,
  liveYield,
  isTop,
  index,
}: {
  agent: Agent;
  liveBond: number;
  liveYield: number;
  isTop: boolean;
  index: number;
}) {
  const meta = PROFILE_META[agent.profile];
  const rate = agent.jobsServed > 0 ? agent.jobsSuccessful / agent.jobsServed : 0;
  const slashed = !agent.active && agent.timesSlashed > 0;

  return (
    <motion.div
      className="glass glass-hover relative overflow-hidden rounded-2xl p-5"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.1 * index }}
      style={{ opacity: slashed ? 0.72 : 1 }}
    >
      {isTop && (
        <div className="absolute right-0 top-0 rounded-bl-xl bg-base-blue px-3 py-1 text-[10px] font-bold uppercase tracking-wider shadow-glow">
          ★ Best route
        </div>
      )}

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="relative grid place-items-center">
            <RepRing rate={rate} color={meta.tint} />
            <span className="absolute font-mono text-sm font-bold" style={{ color: meta.tint }}>
              {pct(rate, 0)}
            </span>
          </div>
          <div>
            <h3 className="text-base font-bold">{agent.name}</h3>
            <p className="font-mono text-xs text-white/40">#{agent.agentId} · {short(agent.operator)}</p>
            <span
              className="mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
              style={{ background: `${meta.tint}22`, color: meta.tint }}
            >
              {meta.label}
            </span>
          </div>
        </div>
        {slashed && (
          <span className="rounded-lg bg-slash/15 px-2.5 py-1 text-[11px] font-bold text-slash">
            BOND SLASHED
          </span>
        )}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-white/[0.03] p-3">
          <p className="text-[10px] uppercase tracking-wider text-white/40">Bond value</p>
          <p className="mt-0.5 font-mono font-bold tabular-nums text-white">
            {slashed ? "$0.00" : usd(liveBond, 4)}
          </p>
        </div>
        <div className="rounded-xl bg-white/[0.03] p-3">
          <p className="text-[10px] uppercase tracking-wider text-white/40">Yield earned</p>
          <p className="mt-0.5 font-mono font-bold tabular-nums text-yield">
            {slashed ? "—" : "+" + usdMicro(liveYield)}
          </p>
        </div>
        <div className="rounded-xl bg-white/[0.03] p-3">
          <p className="text-[10px] uppercase tracking-wider text-white/40">x402 price</p>
          <p className="mt-0.5 font-mono font-bold tabular-nums text-white">{usdMicro(agent.priceUsd)}</p>
        </div>
        <div className="rounded-xl bg-white/[0.03] p-3">
          <p className="text-[10px] uppercase tracking-wider text-white/40">Route score</p>
          <p className="mt-0.5 font-mono font-bold tabular-nums" style={{ color: meta.tint }}>
            {agent.score.toFixed(1)}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-white/40">
        <span>{agent.jobsSuccessful}/{agent.jobsServed} jobs clean</span>
        <span>{agent.timesSlashed} slash{agent.timesSlashed === 1 ? "" : "es"}</span>
      </div>
    </motion.div>
  );
}
