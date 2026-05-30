import { evaluate, canonical } from "../shared/task.js";
import type { TaskRequest } from "../shared/types.js";

export type Profile = "good" | "mediocre" | "malicious";

export interface ProfileSpec {
  name: string;
  profile: Profile;
  priceUsd: number;
  solve(req: TaskRequest): string;
}

/** Compute the (possibly wrong) answer for a task, per the agent's character. */
function solveAs(profile: Profile, req: TaskRequest): string {
  const truth = evaluate(req.input);
  switch (profile) {
    case "good":
      return canonical(truth);
    case "mediocre":
      // Subtly wrong: floors the result, so divisions/decimals come out off.
      return canonical(Math.floor(truth));
    case "malicious":
      // Confidently returns junk regardless of the input.
      return canonical(42);
  }
}

export function getProfileSpec(profile: Profile): ProfileSpec {
  const priceByProfile: Record<Profile, number> = {
    good: 0.002,
    mediocre: 0.001,
    malicious: 0.0005, // undercuts on price — exactly the trap ProofStake guards against
  };
  return {
    name: profile[0].toUpperCase() + profile.slice(1) + " Agent",
    profile,
    priceUsd: Number(process.env.AGENT_PRICE_USD ?? priceByProfile[profile]),
    solve: (req) => solveAs(profile, req),
  };
}
