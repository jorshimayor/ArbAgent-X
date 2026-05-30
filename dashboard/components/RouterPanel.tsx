"use client";
import { motion } from "framer-motion";
import type { Agent } from "@/lib/types";
import { usdMicro } from "@/lib/format";

/**
 * Visualizes the `proofstake_route` MCP tool: it ranks active agents by
 * reputation-per-price and returns the winner. The malicious agent undercuts on
 * price but its slash history tanks its score — so it never wins the route.
 */
export function RouterPanel({ agents }: { agents: Agent[] }) {
  const ranked = [...agents].filter((a) => a.active).sort((a, b) => b.score - a.score);
  const max = Math.max(1, ...ranked.map((a) => a.score));

  return (
    <div className="glass rounded-2xl p-5">
      <div className="mb-1 flex items-center gap-2">
        <span className="rounded-md bg-base-blue/20 px-2 py-0.5 font-mono text-[11px] font-bold text-base-glow">
          proofstake_route()
        </span>
        <h2 className="text-sm font-bold uppercase tracking-wider text-white/60">Base MCP routing</h2>
      </div>
      <p className="mb-4 text-xs text-white/45">
        One MCP call scores every bonded agent by reputation ÷ price and returns the best.
      </p>

      <div className="flex flex-col gap-3">
        {ranked.map((a, i) => (
          <motion.div
            key={a.agentId}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.1 * i }}
          >
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className={i === 0 ? "font-bold text-white" : "text-white/60"}>
                {i === 0 && "★ "}
                {a.name}
              </span>
              <span className="font-mono text-white/40">
                {usdMicro(a.priceUsd)}/call · score {a.score.toFixed(1)}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-white/5">
              <motion.div
                className="h-full rounded-full"
                style={{
                  background: i === 0 ? "linear-gradient(90deg,#0052FF,#34F5C5)" : "rgba(255,255,255,0.18)",
                }}
                initial={{ width: 0 }}
                animate={{ width: `${(a.score / max) * 100}%` }}
                transition={{ duration: 1, delay: 0.1 * i, ease: "easeOut" }}
              />
            </div>
          </motion.div>
        ))}
      </div>

      {ranked[0] && (
        <div className="mt-4 rounded-xl border border-base-blue/30 bg-base-blue/10 p-3 text-xs">
          <span className="text-white/50">Routed to </span>
          <span className="font-bold text-base-glow">{ranked[0].name}</span>
          <span className="text-white/50"> — highest reputation per dollar, bond at risk.</span>
        </div>
      )}
    </div>
  );
}
