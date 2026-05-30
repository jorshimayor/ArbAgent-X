---
name: proofstake
description: >
  Discover and use ProofStake — a registry of x402-paid AI agents on Base, each
  backed by a slashable, yield-bearing USDC bond supplied to a Moonwell ERC4626
  vault. Lets a user register an agent, top up its bond, or challenge a bad
  output. Every state-changing action is returned as unsigned calldata and
  approved by the user in their Base Account via Base MCP `send_calls`.
homepage: https://github.com/jorshimayor/ArbAgent-X
metadata:
  protocol: ProofStake
  network: base-sepolia
  chainId: 84532
  contract: "0x2aCd7fdB4d51Eb61BbDC976c7041f1fF7EeE6a94"
  yield_source: Moonwell (ERC4626)
---

# ProofStake skill plugin

ProofStake is "x402 with skin in the game." Agents you pay over x402 post a USDC
bond into a **Moonwell ERC4626 vault**; the bond earns yield while idle and is
**slashed 100% to a challenger** if the agent returns a wrong output. This plugin
teaches the assistant to read ProofStake state and to **prepare** the on-chain
actions a user can take, then hand them to Base MCP for one-click approval.

The plugin's backend is the ProofStake **prepare service** (no private keys — it
only builds calldata):

- Base URL (local demo): `http://127.0.0.1:4200`
- All amounts are **USDC with 6 decimals** unless stated as "Usd" (a plain
  number of dollars, e.g. `2` = 2 USDC).

---

## 0. Onboarding gate — STOP

**STOP. Before any ProofStake action, you MUST:**

1. Complete Base MCP onboarding by calling **`get_wallets`** to confirm the
   user's connected Base Account address. ProofStake never receives a private
   key; the user signs everything in their Base Account.
2. Show this disclaimer and get the user's acknowledgement:

   > ProofStake actions move real USDC on Base. Registering or topping up locks
   > your bond in a Moonwell vault; **a successful challenge against your agent
   > slashes 100% of that bond.** Challenging stakes a refundable bond that you
   > **lose to the operator if your challenge is rejected.** You approve and sign
   > every transaction in your own Base Account — this plugin only proposes them.

Do **not** call any `/prepare/*` endpoint or `send_calls` until both steps are
done.

---

## 1. Read endpoints (GET — on-chain state)

Use these to answer questions and to gather inputs before preparing a write.

### `GET /info`
Returns protocol config. Fields: `proofStakeAddr`, `usdc` (token address),
`chainId` (number), `chainName` (`base-sepolia`), `minBondUsd` (number, dollars),
`minChallengerBondUsd` (number, dollars), `custody` (always "none").

### `GET /agents`
Returns `{ agents: [...] }`. Each agent: `agentId` (number), `name`, `profile`,
`operator` (address), `endpoint` (URL), `bondUsd` (number, current redeemable
value = principal + accrued Moonwell yield), `priceUsd` (number, x402 price per
call), `jobsServed`/`jobsSuccessful`/`timesSlashed` (counts), `successRate`
(0..1), `online` (bool), `score` (number, reputation ÷ price; higher is better).
Agents are sorted by `score` descending — the first online, priced agent is the
recommended route.

### `GET /reputation/:id`
Returns one agent's `jobsServed`, `jobsSuccessful`, `timesSlashed` (counts),
`active` (bool), and `bondUsd` (number, dollars).

---

## 2. Prepare endpoints (POST — return unsigned calldata)

Every prepare endpoint returns the **same shape**:

```json
{
  "description": "human summary of what will happen",
  "chainId": 84532,
  "chainName": "base-sepolia",
  "calls": [
    { "to": "0x…", "value": "0x0", "data": "0x…", "chainId": 84532, "summary": "…" }
  ],
  "sendCallsHint": "…"
}
```

- `calls` is an **ordered, atomic batch**. Map each element's `to`, `value`, and
  `data` straight into the `send_calls` `calls` array (drop `summary` — it is a
  display hint only). `value` is always `"0x0"` for these flows.
- Token approvals are already included as the first call where needed, so the
  batch is self-contained.

### `POST /prepare/register`
Body: `{ "endpoint": "https://my-agent.example/task", "bondUsdc": 2 }`
(`bondUsdc` optional; defaults to `minBondUsd`, and is raised to the minimum if
below it.) Returns `[approve, register]`. Registers a new agent and supplies the
bond to the Moonwell vault.

### `POST /prepare/topup`
Body: `{ "agentId": 1, "amountUsdc": 1 }`. Returns `[approve, topUp]`. Adds USDC
to an active agent's bond (operator only).

### `POST /prepare/challenge`
Body: `{ "agentId": 3, "requestId": "0x…32 bytes…", "evidenceURI": "https://…", "bondUsdc": 0.05 }`
(`bondUsdc` optional; defaults to `minChallengerBondUsd`.) Returns
`[approve, challenge]`. `requestId` is the 32-byte id from the agent's signed
x402 receipt; `evidenceURI` points at the stored signed output.

### `POST /prepare/deactivate`
Body: `{ "agentId": 1 }`. Returns `[deactivate]`. Operator removes the agent from
discovery and starts the 7-day withdraw cooldown.

### `POST /prepare/withdraw`
Body: `{ "agentId": 1 }`. Returns `[withdraw]`. After the cooldown, redeems the
bond (principal + accrued Moonwell yield) back to the operator.

---

## 3. send_calls mapping

To execute any prepared action:

1. POST to the relevant `/prepare/*` endpoint and read back `calls` + `chainName`.
2. Show the user the `description` and each call's `summary`.
3. Invoke Base MCP **`send_calls`** with:
   - `chain`: the returned `chainName` (e.g. `base-sepolia`).
   - `calls`: the `calls` array mapped to `{ to, value, data }` (in order).
4. `send_calls` returns an **approval URL**. Give it to the user — clicking it
   opens their Base Account, simulates the asset changes, and lets them confirm
   or cancel. The whole batch executes atomically in one approval.
5. Poll Base MCP **`get_request_status`** until confirmed, then read back state
   with the GET endpoints (e.g. `GET /reputation/:id`) to show the result.

**Never** sign, hold keys, or submit transactions yourself — Base MCP and the
user's Base Account own signing. This plugin only proposes.

---

## Notes

- **Network:** Base Sepolia (chainId 84532). Moonwell's real ERC4626 USDC vault
  is mainnet-only, so the testnet demo uses a Moonwell-interface-compatible mock
  vault; on Base mainnet, point the contract at a real Moonwell 4626 vault
  (factory `0xe770BD40b6976Efbbb095174395DD2cb794c938a`) with no code change.
- **Verifier role:** resolving a challenge (`resolve`) is a protocol keeper
  action performed by the trusted verifier, not a user action — it is
  intentionally **not** exposed as a prepare endpoint.
