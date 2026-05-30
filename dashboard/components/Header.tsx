"use client";
import { motion } from "framer-motion";

export function Header({ live, network }: { live: boolean; network: string }) {
  return (
    <header className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-base-blue shadow-glow">
            <span className="text-lg font-black">▣</span>
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight">
              Proof<span className="shimmer">Stake</span>
            </h1>
            <p className="text-xs font-medium text-white/45">
              x402 with skin in the game
            </p>
          </div>
        </div>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-white/55">
          Slashable agent reputation backed by yield-bearing USDC bonds on Base.
          Bad outputs are challengeable — a valid challenge slashes the agent&apos;s
          bond to the challenger. Honest agents compound Morpho yield and on-chain
          reputation.
        </p>
      </motion.div>

      <motion.div
        className="flex items-center gap-3"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.15 }}
      >
        {["Base MCP", "Morpho", "x402"].map((t) => (
          <span
            key={t}
            className="glass rounded-full px-3 py-1.5 text-xs font-semibold text-white/70"
          >
            {t}
          </span>
        ))}
        <span className="glass flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold">
          <span className="relative inline-block">
            <span
              className={`pulse-dot block h-2 w-2 rounded-full ${
                live ? "bg-yield" : "bg-base-glow"
              }`}
            />
          </span>
          <span className="text-white/70">{live ? "Live" : "Demo"} · {network}</span>
        </span>
      </motion.div>
    </header>
  );
}
