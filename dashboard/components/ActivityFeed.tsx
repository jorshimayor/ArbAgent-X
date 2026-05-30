"use client";
import { AnimatePresence, motion } from "framer-motion";
import type { Activity } from "@/lib/types";
import { timeAgo, usd } from "@/lib/format";

const KIND_META: Record<Activity["kind"], { color: string; icon: string }> = {
  noshow: { color: "#FF4D6D", icon: "⚠" },
  cancel: { color: "#FFB020", icon: "↺" },
  booking: { color: "#3D7BFF", icon: "→" },
  attended: { color: "#34F5C5", icon: "✓" },
  register: { color: "#A78BFA", icon: "◆" },
  yield: { color: "#34F5C5", icon: "↑" },
};

export function ActivityFeed({ activity }: { activity: Activity[] }) {
  return (
    <div className="glass rounded-2xl p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wider text-white/60">Live activity</h2>
        <span className="flex items-center gap-1.5 text-xs text-white/40">
          <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-yield" /> streaming
        </span>
      </div>
      <div className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {activity.map((a) => {
            const m = KIND_META[a.kind];
            return (
              <motion.div
                key={a.id}
                layout
                initial={{ opacity: 0, x: -16, height: 0 }}
                animate={{ opacity: 1, x: 0, height: "auto" }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
                className="flex items-start gap-3 rounded-xl bg-white/[0.02] p-3"
              >
                <span
                  className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg text-xs font-bold"
                  style={{ background: `${m.color}22`, color: m.color }}
                >
                  {m.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-white/80">{a.text}</p>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-white/35">
                    <span style={{ color: m.color }}>{a.businessName}</span>
                    {a.amountUsd !== undefined && a.amountUsd > 0 && <span>· {usd(a.amountUsd, a.amountUsd < 1 ? 4 : 2)}</span>}
                    {a.txHash && <span className="font-mono">· {a.txHash}</span>}
                    <span className="ml-auto">{timeAgo(a.at)}</span>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
