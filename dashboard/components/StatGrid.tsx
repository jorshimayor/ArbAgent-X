"use client";
import { motion } from "framer-motion";
import type { Business } from "@/lib/types";
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

export function StatGrid({ businesses, accruedYield, vaultApy }: { businesses: Business[]; accruedYield: number; vaultApy: number }) {
  const totalHeld = businesses.reduce((s, b) => s + b.depositsHeldUsd, 0);
  const activeCount = businesses.filter((b) => b.active).length;
  const honored = businesses.reduce((s, b) => s + b.bookingsHonored, 0);
  const noShows = businesses.reduce((s, b) => s + b.noShows, 0);

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Stat label="Deposits Held" accent="#3D7BFF" delay={0.05} sub={`across ${activeCount} active businesses`}>
        <CountUp value={totalHeld} format={(n) => usd(n)} />
      </Stat>
      <Stat label="Moonwell Yield Accrued" accent="#34F5C5" delay={0.12} sub={`${pct(vaultApy)} APY · live`}>
        <CountUp value={accruedYield} format={(n) => usdMicro(n)} duration={0.4} />
      </Stat>
      <Stat label="Bookings Honored" accent="#A78BFA" delay={0.19} sub="showed up or cancelled in time">
        <CountUp value={honored} format={(n) => Math.round(n).toLocaleString()} />
      </Stat>
      <Stat label="No-Shows Slashed" accent="#FF4D6D" delay={0.26} sub="deposit paid to the business">
        <CountUp value={noShows} format={(n) => Math.round(n).toString()} />
      </Stat>
    </div>
  );
}
