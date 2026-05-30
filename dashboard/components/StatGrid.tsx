"use client";
import { motion } from "framer-motion";
import type { Agent } from "@/lib/types";
import { CountUp } from "./CountUp";
import { usd, usdMicro, pct } from "@/lib/format";

function Stat({
  label,
  children,
  accent,
  delay,
  sub,
}: {
  label: string;
  children: React.ReactNode;
  accent: string;
  delay: number;
  sub?: string;
}) {
  return (
    <motion.div
      className="glass glass-hover relative overflow-hidden rounded-2xl p-5"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay }}
    >
      <div
        className="absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-30 blur-2xl"
        style={{ background: accent }}
      />
      <p className="text-xs font-semibold uppercase tracking-wider text-white/40">
        {label}
      </p>
      <p className="mt-2 font-mono text-2xl font-bold tabular-nums" style={{ color: accent }}>
        {children}
      </p>
      {sub && <p className="mt-1 text-xs text-white/40">{sub}</p>}
    </motion.div>
  );
}

export function StatGrid({ agents, accruedYield, vaultApy }: { agents: Agent[]; accruedYield: number; vaultApy: number }) {
  const totalBonded = agents.reduce((s, a) => s + a.bondUsd, 0);
  const activeCount = agents.filter((a) => a.active).length;
  const served = agents.reduce((s, a) => s + a.jobsServed, 0);
  const slashes = agents.reduce((s, a) => s + a.timesSlashed, 0);

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Stat label="Total Value Bonded" accent="#3D7BFF" delay={0.05} sub={`across ${activeCount} active agents`}>
        <CountUp value={totalBonded} format={(n) => usd(n)} />
      </Stat>
      <Stat label="Moonwell Yield Accrued" accent="#34F5C5" delay={0.12} sub={`${pct(vaultApy)} APY · live`}>
        <CountUp value={accruedYield} format={(n) => usdMicro(n)} duration={0.4} />
      </Stat>
      <Stat label="Jobs Served (x402)" accent="#A78BFA" delay={0.19} sub="paid per call">
        <CountUp value={served} format={(n) => Math.round(n).toLocaleString()} />
      </Stat>
      <Stat label="Bonds Slashed" accent="#FF4D6D" delay={0.26} sub="bad outputs punished">
        <CountUp value={slashes} format={(n) => Math.round(n).toString()} />
      </Stat>
    </div>
  );
}
