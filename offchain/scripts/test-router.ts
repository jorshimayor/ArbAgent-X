// Spawns the router over stdio as a real MCP client would and lists its tools.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "router/mcp.ts"],
});
const client = new Client({ name: "router-test", version: "0.1.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log("router exposes tools:");
for (const t of tools) console.log(`  - ${t.name}: ${t.description}`);

await client.close();
process.exit(tools.length === 3 ? 0 : 1);
