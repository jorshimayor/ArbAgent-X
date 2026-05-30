---
name: skinbook
description: >
  Discover and use SkinBook — no-show booking deposits on Base. A customer books
  a slot at a business and posts a refundable USDC deposit that is supplied to a
  Moonwell ERC4626 vault, so it earns yield while it waits. Show up (or cancel in
  time) and the deposit is refunded with its yield; no-show and it is slashed to
  the business. Lets a user register a business, book a slot, cancel, confirm
  attendance, file a no-show, or dispute one. Every state-changing action is
  returned as unsigned calldata and approved by the user in their Base Account via
  Base MCP `send_calls`.
homepage: https://github.com/jorshimayor/ArbAgent-X
metadata:
  protocol: SkinBook
  network: base-sepolia
  chainId: 84532
  contract: "0x0000000000000000000000000000000000000000"
  yield_source: Moonwell (ERC4626)
---

# SkinBook skill plugin

SkinBook is "booking deposits with skin in the game." A customer's deposit is
supplied to a **Moonwell ERC4626 vault**; it earns yield while the booking is
pending and is **refunded with that yield** on attendance or an in-time cancel,
or **slashed to the business** on a no-show. This plugin teaches the assistant to
read SkinBook state and to **prepare** the on-chain actions a user can take, then
hand them to Base MCP for one-click approval.

The plugin's backend is the SkinBook **prepare service** (no private keys — it
only builds calldata):

- Base URL (local demo): `http://127.0.0.1:4200`
- All amounts are **USDC with 6 decimals** unless stated as "Usd" (a plain
  number of dollars, e.g. `2` = 2 USDC). Times are **unix seconds**.

---

## 0. Onboarding gate — STOP

**STOP. Before any SkinBook action, you MUST:**

1. Complete Base MCP onboarding by calling **`get_wallets`** to confirm the
   user's connected Base Account address. SkinBook never receives a private key;
   the user signs everything in their Base Account.
2. Show this disclaimer and get the user's acknowledgement:

   > SkinBook actions move real USDC on Base. Booking locks a refundable deposit
   > in a Moonwell vault; **if you no-show, that deposit is slashed to the
   > business.** Cancelling in time or being marked attended refunds it with its
   > yield. You approve and sign every transaction in your own Base Account —
   > this plugin only proposes them.

Do **not** call any `/prepare/*` endpoint or `send_calls` until both steps are
done.

---

## 1. Read endpoints (GET — on-chain state)

Use these to answer questions and to gather inputs before preparing a write.

### `GET /info`
Returns protocol config. Fields: `skinBookAddr`, `usdc` (token address),
`chainId` (number), `chainName` (`base-sepolia`), `minDepositUsd` (number,
dollars), `custody` (always "none").

### `GET /businesses`
Returns `{ businesses: [...] }`. Each business: `businessId` (number), `name`,
`owner` (address), `depositUsd` (number, the deposit each booking posts),
`cancellationWindowSecs`/`gracePeriodSecs` (policy), `bookingsHonored`/`noShows`
(counts), `reliability` (0..1), `score` (ranking; higher is more reliable).
Sorted by `score` descending.

### `GET /bookings?limit=20`
Returns `{ bookings: [...] }`, newest first. Each booking: `bookingId`,
`businessId`, `customer` (address), `slotTime` (unix secs), `status`
(`Booked` | `Refunded` | `NoShowClaimed` | `Disputed` | `Slashed`), `depositUsd`
(current redeemable value = principal + accrued yield), `claimedAt`.

### `GET /reliability/:id`
One business's `name`, `bookingsHonored`, `noShows`, `active`, `depositUsd`.

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
- Where a deposit is moved, the USDC `approve` is already included as the first
  call, so the batch is self-contained.

### `POST /prepare/register-business`
Body: `{ "name": "Tony's Bistro", "depositUsdc": 2, "cancellationWindowSecs": 86400, "gracePeriodSecs": 7200 }`
(`depositUsdc` defaults to `minDepositUsd`; windows default to 1 day / 2 hours.)
Returns `[registerBusiness]`. No token movement.

### `POST /prepare/book`
Body: `{ "businessId": 1, "slotTime": 1735689600 }`. Returns `[approve, book]`.
The deposit is the business's configured amount (looked up on-chain); the plugin
should read it from `GET /businesses` first to show the user.

### `POST /prepare/cancel`
Body: `{ "bookingId": 1 }`. Returns `[cancel]`. Customer cancels before the
cancellation window; deposit + yield is refunded.

### `POST /prepare/confirm-attendance`
Body: `{ "bookingId": 1 }`. Returns `[confirmAttendance]`. Business confirms the
customer showed; deposit + yield is refunded to the customer. **Owner only.**

### `POST /prepare/claim-noshow`
Body: `{ "bookingId": 1 }`. Returns `[claimNoShow]`. Business files a no-show
after the slot + grace period; opens the dispute window. **Owner only.**

### `POST /prepare/dispute`
Body: `{ "bookingId": 1 }`. Returns `[dispute]`. Customer contests a no-show
claim within the dispute window. The arbiter then resolves it.

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
   with the GET endpoints (e.g. `GET /bookings`) to show the result.

**Never** sign, hold keys, or submit transactions yourself — Base MCP and the
user's Base Account own signing. This plugin only proposes.

---

## Notes

- **Network:** Base Sepolia (chainId 84532). Moonwell's real ERC4626 USDC vault
  is mainnet-only, so the testnet demo uses a Moonwell-interface-compatible mock
  vault; on Base mainnet, point the contract at a real Moonwell 4626 vault
  (factory `0xe770BD40b6976Efbbb095174395DD2cb794c938a`) with no code change.
- **Keeper / arbiter roles:** settling an uncontested no-show (`settleNoShow`,
  callable by anyone after the dispute window) and resolving a *disputed*
  no-show (`resolveDispute`, arbiter only) are protocol keeper actions, not
  everyday user actions — they are intentionally **not** exposed as prepare
  endpoints. A keeper service performs them automatically.
