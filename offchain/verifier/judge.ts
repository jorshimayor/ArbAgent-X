import { evaluate, canonical } from "../shared/task.js";
import { verifyReceipt } from "../shared/receipt.js";
import type { JobResult } from "../shared/types.js";

export interface Verdict {
  correct: boolean;
  truth: string;
  claimed: string;
  receiptValid: boolean;
  reason: string;
}

/**
 * Objectively judge a served job. The verifier re-runs the deterministic task
 * and checks the agent's signed receipt. A challenge is *upheld* (agent slashed)
 * when the output is wrong or the receipt doesn't bind to the claimed output.
 */
export function judge(job: JobResult): Verdict {
  const receiptValid = verifyReceipt(job.receipt, job.output);

  let truth: string;
  try {
    truth = canonical(evaluate(job.request.input));
  } catch (e: any) {
    return {
      correct: false,
      truth: "NaN",
      claimed: job.output,
      receiptValid,
      reason: `task input is malformed: ${e.message}`,
    };
  }

  const correct = receiptValid && job.output === truth;
  const reason = !receiptValid
    ? "receipt signature does not match the claimed output"
    : correct
    ? "output matches re-computed ground truth"
    : `output ${job.output} != ground truth ${truth}`;

  return { correct, truth, claimed: job.output, receiptValid, reason };
}

/** A challenge is upheld (slash) exactly when the job is NOT correct. */
export function challengeUpheld(job: JobResult): boolean {
  return !judge(job).correct;
}
