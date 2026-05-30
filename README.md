# ProofStake

**x402 with skin in the game.** Slashable agent reputation backed by yield-bearing USDC bonds on Base.

x402 lets agents charge per call but enforces nothing about quality. ProofStake makes agents *financially accountable*: every listed agent posts a USDC bond into a Morpho vault. The bond earns yield while idle. A client who gets a bad output can challenge it; an upheld challenge slashes the bond to the challenger. Honest agents compound yield and onchain reputation.

Built for the Base MCP bounty with **Base MCP + Morpho + x402**.

## What's in this repo (v1 contract core)

`contracts/ProofStake.sol` collapses the three PRD primitives into one contract:

- **AgentRegistry** — `register`, `topUp`, `deactivate`, `getReputation`, `listActive`
- **BondVault** — bonds are deposited straight into an ERC4626 MetaMorpho USDC vault; principal earns yield, slashing redeems shares atomically for liquid USDC
- **Slasher** — `challenge` (client stakes a bond + evidence URI) and `resolve` (trusted verifier upholds or rejects)

v1 deliberately uses a single trusted verifier (called out openly per the PRD); a verifier committee is v2.

| Path | Purpose |
|---|---|
| `contracts/ProofStake.sol` | Registry + BondVault + Slasher |
| `contracts/mocks/MockUSDC.sol` | 6-decimal test USDC |
| `contracts/mocks/MockMetaMorpho.sol` | ERC4626 vault stand-in with `simulateYield` |
| `test/ProofStake.test.ts` | Full Chai suite (register, yield, slash, withdraw, access control) |
| `ignition/modules/ProofStake.ts` | Deploy module (auto-deploys mocks when `MORPHO_VAULT` is unset) |
| `scripts/seed-agents.ts` | Registers the 3 demo agents (good / mediocre / malicious) |

## Quickstart (Windows-native, no WSL)

```bash
npm install
npx hardhat compile
npx hardhat test
```

Requires Node 20+. Solidity targets the Cancun EVM (required by OpenZeppelin 5.x).

## Deploy to Base Sepolia

1. Copy `.env.example` to `.env` and fill in `DEPLOYER_PRIVATE_KEY`, `BASESCAN_API_KEY`.
2. To bond into a real curated vault, set `USDC` and `MORPHO_VAULT` to a Base MetaMorpho USDC vault. Leave them blank to deploy the mocks.

```bash
npx hardhat ignition deploy ./ignition/modules/ProofStake.ts --network baseSepolia
PROOFSTAKE_ADDR=0x... npx hardhat run scripts/seed-agents.ts --network baseSepolia
```

## Contract surface

```solidity
register(string endpoint, uint256 bondAmount) returns (uint256 agentId)
topUp(uint256 agentId, uint256 amount)
deactivate(uint256 agentId)                       // starts 7-day cooldown
withdraw(uint256 agentId)                          // principal + yield, post-cooldown
getReputation(uint256 agentId)                     // (served, successful, slashed, active)
bondValue(uint256 agentId)                         // live redeemable USDC (principal + yield)
listActive() returns (uint256[])

challenge(uint256 agentId, bytes32 requestId, string evidenceURI, uint256 challengerBond)
resolve(uint256 challengeId, bool upheld)          // verifier only
recordJob(uint256 agentId, bytes32 requestId, bool success)   // verifier only
```

**Upheld challenge** → 100% of the bond is redeemed from Morpho, protocol fee skimmed to treasury, the rest plus the challenger's bond paid to the challenger; agent deactivated and `timesSlashed++`.
**Rejected challenge** → challenger bond awarded to the operator; counts as a clean served job.

## Off-chain stack (`offchain/`)

Pure-Node/TypeScript, run with `tsx`. The demo task is deterministic arithmetic, so the verifier can re-compute ground truth and slash **objectively** — no subjective judging needed for the live demo.

```bash
cd offchain && npm install
npm run smoke                    # offline: task engine, judge, receipt sign/verify
npm run evidence                 # IPFS-stand-in evidence store on :4100
npm run agents                   # good (:4001) + mediocre (:4002) + malicious (:4003)
npm run verifier                 # watches ChallengeOpened and resolves
```

- **Agents** (`agents/server.ts`) — one configurable Express runner, three profiles. `POST /task` is x402-gated: an unpaid call returns `402` with the payment spec, a paid call returns the answer plus a wallet-**signed receipt** binding `(agentId, requestId, outputHash)`. `good` answers correctly, `mediocre` floors decimals, `malicious` always returns `42`. Uses the real `x402-express` middleware when `X402_ENABLED=true`, else a self-contained 402 handshake so it runs key-free.
- **Verifier** (`verifier/index.ts`) — pulls the evidence record, re-runs the task, verifies the receipt, and calls `resolve(challengeId, upheld)`. Watch mode auto-resolves new challenges.
- **Base MCP router** (`router/mcp.ts`) — an MCP server exposing `proofstake_route(task)`, `proofstake_list_agents`, and `proofstake_reputation`. `proofstake_route` scores every active agent by **reputation ÷ price** (slashing tanks the score) and returns the best agent + how to pay. Drop it into any MCP client.

## Dashboard (`dashboard/`)

Animated Next.js operator dashboard (Tailwind + Framer Motion): total value bonded, **live-accruing Morpho yield**, per-agent reputation rings, the `proofstake_route` ranking, and a live slash/challenge feed.

```bash
cd dashboard && npm install && npm run dev   # http://localhost:3000
```

Reads live state from a deployed `ProofStake` when `PROOFSTAKE_ADDR` + `RPC_URL` are set, and falls back to a rich demo dataset otherwise — so it always demos well and lights up automatically against a chain.

## Status

- Contract + tests: load-bearing, locally-verifiable core — **14 passing tests**.
- Off-chain: agents (live x402 402→pay→serve handshake verified), verifier, MCP router (3 tools, validated over stdio) — **offline smoke suite green**.
- Dashboard: runs, renders, yield visibly accrues, slash narrative on screen.
- Follow-ups: deploy to Base Sepolia, point the dashboard at the live contract, and index real `ChallengeResolved`/`JobRecorded` events into the activity feed.
