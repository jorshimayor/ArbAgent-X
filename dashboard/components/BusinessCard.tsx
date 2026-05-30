"use client";
import { motion } from "framer-motion";
import type { Business } from "@/lib/types";
import { usd, usdMicro, short, pct } from "@/lib/format";

const TIER_META: Record<Business["tier"], { tint: string; label: string }> = {
  trusted: { tint: "#34F5C5", label: "Trusted" },
  new: { tint: "#FFB020", label: "New" },
  watch: { tint: "#FF4D6D", label: "Watch" },
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

export function BusinessCard({
  business,
  liveHeld,
  liveYield,
  isTop,
  index,
}: {
  business: Business;
  liveHeld: number;
  liveYield: number;
  isTop: boolean;
  index: number;
}) {
  const meta = TIER_META[business.tier];
  const total = business.bookingsHonored + business.noShows;
  const rate = total > 0 ? business.bookingsHonored / total : 1;
  const inactive = !business.active;

  return (
    <motion.div
      className="glass glass-hover relative overflow-hidden rounded-2xl p-5"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.1 * index }}
      style={{ opacity: inactive ? 0.72 : 1 }}
    >
      {isTop && (
        <div className="absolute right-0 top-0 rounded-bl-xl bg-base-blue px-3 py-1 text-[10px] font-bold uppercase tracking-wider shadow-glow">
          ★ Most trusted
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
            <h3 className="text-base font-bold">{business.name}</h3>
            <p className="font-mono text-xs text-white/40">
              #{business.businessId} · {business.category} · {short(business.owner)}
            </p>
            <span
              className="mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
              style={{ background: `${meta.tint}22`, color: meta.tint }}
            >
              {meta.label}
            </span>
          </div>
        </div>
        {inactive && (
          <span className="rounded-lg bg-slash/15 px-2.5 py-1 text-[11px] font-bold text-slash">
            DELISTED
          </span>
        )}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-white/[0.03] p-3">
          <p className="text-[10px] uppercase tracking-wider text-white/40">Deposits held</p>
          <p className="mt-0.5 font-mono font-bold tabular-nums text-white">
            {usd(liveHeld, 4)}
          </p>
        </div>
        <div className="rounded-xl bg-white/[0.03] p-3">
          <p className="text-[10px] uppercase tracking-wider text-white/40">Yield accrued</p>
          <p className="mt-0.5 font-mono font-bold tabular-nums text-yield">
            +{usdMicro(liveYield)}
          </p>
        </div>
        <div className="rounded-xl bg-white/[0.03] p-3">
          <p className="text-[10px] uppercase tracking-wider text-white/40">Deposit / booking</p>
          <p className="mt-0.5 font-mono font-bold tabular-nums text-white">{usdMicro(business.depositUsd)}</p>
        </div>
        <div className="rounded-xl bg-white/[0.03] p-3">
          <p className="text-[10px] uppercase tracking-wider text-white/40">Trust score</p>
          <p className="mt-0.5 font-mono font-bold tabular-nums" style={{ color: meta.tint }}>
            {business.score.toFixed(1)}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-white/40">
        <span>{business.bookingsHonored}/{total} honored · {business.activeBookings} active</span>
        <span>{business.noShows} no-show{business.noShows === 1 ? "" : "s"}</span>
      </div>
    </motion.div>
  );
}
