# ProofStake — x402 with skin in the game

> A marketplace of x402-paid AI agents on Base where every agent posts a
> **slashable, yield-bearing USDC bond**. Pay an agent, and if it lies, you
> challenge it and take its bond. Honesty is the profitable strategy.

- **Live contract (Base Sepolia):** `0x2aCd7fdB4d51Eb61BbDC976c7041f1fF7EeE6a94`
- **Bond vault (ERC-4626):** `0xe9f109b826de37A6481eAfC60985B5b36763558B`
- **USDC (Circle, Base Sepolia):** `0x036CbD53842c5426634e7929541eC2318f3dCF7e`

---

## 1. What it is and what it solves

### The problem

[x402](https://x402.org) is a clean answer to *"how does an agent pay for a
service?"* — an HTTP 402 handshake that settles stablecoin payment per request.
But payment is not quality. x402 guarantees the agent **gets paid**; it
guarantees nothing about whether the agent **did the work correctly**.

In an agent-to-agent economy this is the whole ballgame. A router picking the
"best" agent purely on price will always pick the cheapest one — which is
exactly the agent with the least incentive to be honest. There is no cost to
returning garbage. The naive market selects *for* fraud.

### The ProofStake answer

ProofStake adds the missing half: **financial accountability**.

1. **Bond to play.** To list in the registry, an agent deposits a USDC bond.
   The bond sits in a Morpho ERC-4626 vault and earns yield while the agent is
   idle, so honest agents are *paid to wait*.
2. **Get paid per job via x402.** Clients pay the agent's price through the
   standard x402 flow. Nothing new for the client to learn.
3. **Challenge bad output.** Any client who receives a wrong answer can open a
   challenge by staking a smaller bond plus the agent's **signed receipt** as
   evidence.
4. **Objective slashing.** A verifier re-computes the ground truth. If the
   output was wrong, the challenge is *upheld*: **100% of the agent's bond is
   redeemed from the vault and paid to the challenger** (minus a small protocol
   fee), the agent is deactivated, and its `timesSlashed` counter increments.
5. **Reputation re-routes traffic.** A slash tanks the agent's routing score,
   so the router stops sending it work. Skin in the game wins.

The result: cheating is *negative expected value*. An agent that lies loses a
bond worth far more than the per-call fee it collected.

---

## 2. System map

```
                         ┌──────────────────────────────────────┐
                         │  Base (Sepolia) — ProofStake.sol      │
                         │  registry • bonds • challenges • slash │
                         └───────▲───────────────▲───────────────┘
                                 │ register/topUp │ recordJob/resolve
                                 │ challenge      │ (verifier)
       ┌───────────┐  x402 pay   │                │
 MCP   │  Router   │────────────►│  Agent servers │◄──── Verifier
 host  │ (mcp.ts)  │  /task      │  :4001/2/3     │      (re-computes
 (you) └─────┬─────┘             │  x402-gated    │       ground truth)
             │ proofstake_route  └───────┬────────┘
             │                           │ signed receipt + evidence
             ▼                           ▼
        ranks agents              Evidence store (:4100)
       reputation ÷ price         serves the challengeable JSON
                                          │
                                  Dashboard (Next.js) reads
                                  live chain state + events
```

Three protocols, each doing exactly one job:

| Protocol     | Role in ProofStake                                              |
|--------------|----------------------------------------------------------------|
| **Base MCP** | The discovery + routing surface agents/hosts call to pick whom to pay |
| **x402**     | The payment rail — pay-per-task with a 402 handshake           |
| **Morpho**   | The bond vault — bonds earn yield idle, slashing redeems them  |

---

## 3. How Base MCP is implemented

The router is a Model Context Protocol server (`offchain/router/mcp.ts`) spoken
over stdio, so it drops into any MCP-capable host (Claude, Cursor, the Base MCP
host). It exposes three tools:

- **`proofstake_list_agents`** — every active agent enriched with bond,
  reputation, price, and routing score.
- **`proofstake_route(kind, input?)`** — the headline tool. Picks the best agent
  for a task and returns *who to call*, *its x402 price*, and *how to pay*:
  ```json
  {
    "task": { "kind": "math" },
    "chosen": {
      "agentId": 1, "name": "...", "endpoint": ".../task",
      "priceUsd": 0.002, "bondUsd": 2.00,
      "successRate": 100.0, "timesSlashed": 0, "score": 1.84
    },
    "howToPay": "POST the task to `endpoint`; the agent answers 402 with an x402
                 payment spec, pay it, and resubmit with the X-PAYMENT header.",
    "alternatives": [ ... ]
  }
  ```
- **`proofstake_reputation(agentId)`** — on-chain reputation for one agent
  (jobs served/successful, times slashed, current bond value).

### The routing score

Routing is what makes the bond *matter*. The score
(`offchain/shared/registry.ts → scoreAgent`) is **reputation ÷ price**:

```ts
reputation = (0.5 + 0.5 * successRate)   // honesty history
           * log10(10 + bondUsd)         // size of skin in the game
           * (timesSlashed > 0 ? 0.1 : 1) // a slash craters the score
score      = reputation / priceUsd
```

A larger bond and a clean record lift an agent; a single slash multiplies its
score by 0.1 and effectively removes it from contention. This is what turns an
on-chain slash into real economic consequence: the agent doesn't just lose its
bond, it loses all future routed traffic.

`enrichActiveAgents()` reads `listActive()` from the contract, pulls each
agent's on-chain stats and live `bondValue`, pings each agent's `/info`
endpoint for name/price/liveness, scores them, and returns the list sorted by
score descending.

---

## 4. How x402 is implemented

x402 is the payment rail on both sides of the call.

### Agent side — gating `/task` (`offchain/shared/x402gate.ts`)

Each agent server (`offchain/agents/server.ts`) gates its `POST /task` route
behind an x402 middleware:

- **Real mode (`X402_ENABLED=true`):** uses `x402-express`'s
  `paymentMiddleware(payTo, { "POST /task": { price: "$0.002", network } },
  { url: facilitatorUrl })`, which settles real USDC through the configured
  Base facilitator (`https://x402.org/facilitator`) via EIP-3009 gasless
  transfer.
- **Demo mode (default):** a self-contained gate that performs the *same* HTTP
  402 handshake — an unpaid request gets `402` with the `accepts` payment
  requirements (`scheme: "exact"`, `network`, `maxAmountRequired`, `payTo`,
  `asset: "USDC"`); a request carrying an `X-PAYMENT` header is let through. This
  keeps the entire flow runnable with no facilitator or funded wallet, while
  staying byte-compatible with the real spec.

### Client side — paying (`offchain/scripts/client.ts`)

`payAndCall(endpoint, task)`:

- **Real mode:** dynamic-imports `x402-fetch`, builds a signer with
  `createSigner(network, CLIENT_PRIVATE_KEY)`, wraps fetch with
  `wrapFetchWithPayment(fetch, signer, maxValue)`, and POSTs the task. The
  wrapper transparently catches the `402`, signs the payment, and resubmits with
  the `X-PAYMENT` header. The settled tx hash is decoded from the
  `x-payment-response` header.
- **Demo mode:** POSTs with `X-PAYMENT: "demo"` so the handshake completes
  without moving funds.

### Signed receipts — the evidence trail

Every served task returns an **EIP-191 signed receipt**
(`offchain/shared/receipt.ts`): the agent signs
`keccak256(agentId, requestId, output)` with its wallet. This receipt is what
makes a challenge *objective* — the agent cannot later deny it produced the
output, because the output is signed by its own key. The agent also POSTs the
full job to the evidence store (`:4100`), which returns an `evidenceURI` the
challenger submits on-chain.

---

## 5. How Morpho is implemented

The bond is not a dead deposit sitting in the contract — it lives in a
**Morpho ERC-4626 (MetaMorpho) vault** and earns yield the whole time it
secures the agent.

### Bonds as vault shares

`ProofStake.sol` holds each agent's bond as **vault shares**, not raw USDC:

- **Register / top up** → `_depositToVault`:
  ```solidity
  usdc.forceApprove(address(vault), amount);
  uint256 shares = vault.deposit(amount, address(this));
  // shares credited to the agent's bond
  ```
- **Current bond value** is read live from the vault:
  ```solidity
  function bondValue(uint256 id) → vault.convertToAssets(agent.shares)
  ```
  Because the vault accrues yield, `convertToAssets(shares)` grows over time —
  so an honest agent's bond is **worth more than it deposited**. (In the live
  dashboard this shows as the Good agent's bond ticking above its $2.00
  principal.) Honest agents are paid to keep their stake online.

- **Slash** → atomic redeem, on an upheld challenge:
  ```solidity
  uint256 assets = vault.redeem(shares, address(this), address(this));
  // protocolFeeBps → treasury
  // remainder + challenger's bond → challenger
  ```
  The shares convert back to liquid USDC in the same transaction that pays the
  challenger, so there is no settlement gap.

The constructor enforces `vault.asset() == usdc`, so the bond asset and the
vault's underlying can never diverge. On Base Sepolia the demo uses a mock
ERC-4626 vault over real Circle USDC; on mainnet this slot takes a production
MetaMorpho USDC vault address unchanged — the contract only ever talks to the
ERC-4626 interface.

### Key contract surface (`contracts/ProofStake.sol`)

| Function                                    | Who        | Effect                                                |
|---------------------------------------------|------------|-------------------------------------------------------|
| `register(endpoint, bond)`                  | operator   | deposit bond → vault shares, list agent               |
| `topUp(id, amount)`                         | operator   | add to bond (more shares)                             |
| `deactivate(id)` / `withdraw(id)`           | operator   | leave; `withdraw` after 7-day cooldown                |
| `recordJob(id, requestId, success)`         | verifier   | append to reputation                                  |
| `challenge(id, requestId, evidenceURI, bond)` | challenger | stake challenger bond, open a challenge             |
| `resolve(challengeId, upheld)`              | verifier   | upheld → slash 100% to challenger + fee; else refund agent |

`WITHDRAW_COOLDOWN = 7 days` and `MAX_FEE_BPS = 2000` bound the trust surface;
`resolve` is `onlyVerifier` and the verdict is reproducible from the signed
evidence, so slashing is objective rather than discretionary.

---

## 6. End-to-end demo flow

`offchain/scripts/demo-testnet.ts` runs the whole narrative on Base Sepolia:

1. **Route** — rank active agents by reputation ÷ price. With no track record,
   the naive score tops the *cheapest* agent (the malicious one) — *the exact
   trap ProofStake exists to close.*
2. **Honest job** — pay the good agent via x402, get a correct answer; verifier
   `recordJob(..., true)`.
3. **Bad actor** — pay the malicious agent, which returns junk regardless of
   input.
4. **Challenge** — client stakes a bond + the signed evidence URI.
5. **Resolve** — verifier re-computes ground truth and slashes objectively.
6. **Result** — malicious bond `$x → $0.00` (slashed, deactivated), challenger
   USDC up by the bond payout.
7. **Re-rank** — the slash deactivates the liar and the honest job lifts the
   good agent; the router now picks the honest agent. **Skin in the game wins.**

Every step prints a BaseScan link (`https://sepolia.basescan.org/tx/<hash>`),
and the Next.js dashboard reads the same contract live (on-chain state + the
`AgentRegistered` / `JobRecorded` / `ChallengeOpened` / `ChallengeResolved`
event feed).

---

## 7. Running it locally

```bash
# 1. agents (3 profiles: good / mediocre / malicious)
#    each listens on :4001 / :4002 / :4003, x402-gates POST /task
# 2. evidence store on :4100
# 3. point env at the live contract (offchain/.env, dashboard/.env.local)

cd offchain
npm run demo            # scripts/demo-testnet.ts — full route→pay→challenge→slash

cd ../dashboard
npm run dev             # live dashboard at :3001, reads the contract
```

Env lives in `offchain/.env` (RPC, contract addr, keys, `X402_ENABLED`) and
`dashboard/.env.local` (contract addr, RPC, `VAULT_APY`, start block). Flip
`X402_ENABLED=true` for real-USDC settlement through the Base facilitator.

### Contract verification (Etherscan API V2)

Base contract data is served by **Etherscan API V2** — a single key works for
Base and 60+ EVM chains via the `chainid` param (Base Sepolia = `84532`). Wire
the existing key into `hardhat.config.ts`'s `etherscan.apiKey` to verify the
deployed contract on BaseScan.
