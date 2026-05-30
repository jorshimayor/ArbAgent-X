import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as dotenv from "dotenv";
import { enrichActiveAgents } from "../shared/registry.js";

dotenv.config();

// ProofStake's Base MCP surface. Drop this server into any MCP-capable client
// (Claude, Cursor, the Base MCP host) and routing a paid task becomes one call.
const server = new McpServer({ name: "proofstake-router", version: "0.1.0" });

server.tool(
  "proofstake_list_agents",
  "List active ProofStake agents with their bond, reputation, price, and routing score.",
  {},
  async () => {
    const agents = await enrichActiveAgents();
    return { content: [{ type: "text", text: JSON.stringify(agents, null, 2) }] };
  }
);

server.tool(
  "proofstake_route",
  "Pick the best agent for a task by reputation-per-price. Returns the agent to call, its x402 price, and how to pay.",
  {
    kind: z.string().describe("Task kind, e.g. 'math'"),
    input: z.string().optional().describe("The task input (optional, for context)"),
  },
  async ({ kind }) => {
    const agents = await enrichActiveAgents();
    const eligible = agents.filter((a) => a.online && a.priceUsd && a.priceUsd > 0);
    const best = eligible[0] ?? null;

    if (!best) {
      return {
        content: [{ type: "text", text: "No online, priced agents available for routing." }],
        isError: true,
      };
    }

    const result = {
      task: { kind },
      chosen: {
        agentId: best.agentId,
        name: best.name,
        endpoint: `${best.endpoint.replace(/\/$/, "")}/task`,
        priceUsd: best.priceUsd,
        bondUsd: Number(best.bondUsd.toFixed(2)),
        successRate: Number((best.successRate * 100).toFixed(1)),
        timesSlashed: best.timesSlashed,
        score: Number(best.score.toFixed(2)),
      },
      howToPay: "POST the task to `endpoint`; the agent answers 402 with an x402 payment spec, pay it, and resubmit with the X-PAYMENT header.",
      alternatives: eligible.slice(1, 4).map((a) => ({
        agentId: a.agentId,
        name: a.name,
        priceUsd: a.priceUsd,
        score: Number(a.score.toFixed(2)),
      })),
    };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "proofstake_reputation",
  "Get the on-chain reputation (jobs served/successful, times slashed, bond value) for one agent.",
  { agentId: z.number().int().describe("The on-chain agent id") },
  async ({ agentId }) => {
    const agents = await enrichActiveAgents();
    const a = agents.find((x) => x.agentId === agentId);
    if (!a) {
      return { content: [{ type: "text", text: `Agent #${agentId} not found among active agents.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(a, null, 2) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[router] ProofStake MCP router connected over stdio");
