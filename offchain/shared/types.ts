export type TaskKind = "math";

export interface TaskRequest {
  kind: TaskKind;
  input: string; // e.g. an arithmetic expression "2 + 2 * 5"
}

export interface AgentReceipt {
  agentId: number;
  requestId: string; // bytes32 hex
  outputHash: string; // bytes32 hex
  signer: string; // agent wallet address
  signature: string; // EIP-191 signature over the digest
}

export interface JobResult {
  agentId: number;
  endpoint: string;
  request: TaskRequest;
  output: string; // the agent's claimed answer
  receipt: AgentReceipt;
  servedAt: number;
}

export interface AgentInfo {
  agentId: number | null; // onchain id once registered
  name: string;
  profile: "good" | "mediocre" | "malicious";
  address: string;
  priceUsd: number;
  kinds: TaskKind[];
}
