# SkinBook — no-show deposits with skin in the game

> Book a slot at a business and post a **refundable, yield-bearing USDC deposit**
> on Base. Show up (or cancel in time) and get it back *with* the yield it earned
> while you waited; no-show and the deposit is slashed to the business. Reliability
> is the profitable strategy — on both sides of the counter.

- **Network:** Base Sepolia (`chainId 84532`) for the demo; one address swap to Base mainnet.
- **USDC (Circle, Base Sepolia):** `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- **Deposit vault (ERC-4626):** a Moonwell USDC vault on mainnet; a Moonwell-shaped mock on Base Sepolia.

---

## 1. What it is and what it solves

### The problem

No-shows are a quiet tax on every appointment business — restaurants, dental and
medical clinics, barbers, salons, studios. An empty reserved slot is revenue that
can never be recovered. The standard defence is a **card hold or pre-charge**: the
business (or its booking platform) puts a hold on the customer's card and captures
it if they don't show.

That fix has three problems. It's **opaque** — the customer can't see the rules or
the money. It's **dead capital** — the held amount earns the customer nothing and
just sits in a processor's ledger. And it's **business-adjudicated** — the business
decides whether you showed up, with no recourse for the customer if it lies.

### The SkinBook answer

SkinBook turns the deposit into something *productive and fair*.

1. **Deposit to book.** To reserve a slot, the customer deposits the business's
   required USDC. The deposit goes straight into a **Moonwell ERC-4626 vault** and
   earns yield the entire time it's held, so the customer is *paid to wait*.
2. **Most bookings self-resolve — no arbiter.** Cancel before the cutoff
   (`cancel`) → trustless refund + yield. The business confirms you showed up
   (`confirmAttendance`) → refund + yield to you. The business gains nothing by
   confirming, so it has no incentive to lie on the honest path.
3. **No-show → slash.** If you don't show, the business files a no-show after a
   grace period (`claimNoShow`). After a bounded **dispute window** with no
   challenge, anyone can `settleNoShow` and the deposit is slashed to the business
   (minus a small protocol fee).
4. **Contested no-show → bounded arbitration.** If the business filed a false
   no-show, the customer `dispute`s inside the window. Only *then* does the trusted
   arbiter (`verifier`) step in via `resolveDispute` — refund the customer or
   uphold the slash.
5. **Reliability is visible.** Every business carries an on-chain
   `bookingsHonored / noShows` record that feeds a public reliability score, so
   customers (and booking agents) can see who honours deposits before they book.

The result: no-shows carry a real cost to the customer, false no-shows carry a real
risk to the business, and honest behaviour on both sides compounds Moonwell yield
plus on-chain reputation.

### Why the trust model is fairer than ProofStake's

SkinBook reuses the yield-bearing-deposit-and-slash core from the earlier
ProofStake design, but inverts its default. ProofStake routed *every* job through a
verifier verdict. SkinBook makes the **arbiter the exception**: the honest paths
(`cancel`, `confirmAttendance`) are fully trustless, and the arbiter is only
reachable through a customer `dispute` inside a bounded window. Fewer transactions
touch the trusted role, so there is less trust surface to abuse.

---

## 2. System map

```
                         ┌────────────────────────────────────────┐
                         │  Base (Sepolia) — SkinBook.sol           │
                         │  registry • deposits • no-show settle     │
                         └──────▲────────────────▲──────────────────┘
                                │ book / cancel  │ settleNoShow (anyone)
                                │ confirm / claim │ resolveDispute (arbiter)
       ┌────────────┐  prepare  │ dispute        │
 MCP   │ Base MCP   │──────────►│  unsigned       │◄──── Keeper / arbiter
 host  │ skill      │  calldata │  calldata only  │      (settles uncontested;
 (you) │ plugin     │           │  (no keys)      │       resolves disputes)
       └─────┬──────┘           └───────▲─────────┘
             │ send_calls               │ (optional, separate money)
             ▼                  ┌────────┴─────────┐
     user signs in              │ x402 reservation │  non-refundable
     Base Account               │ desk (:4300)     │  booking fee
                                └──────────────────┘
                                          │
                                  Dashboard (Next.js) reads
                                  live chain state + events
```

Three protocols, each doing exactly one job:

| Protocol     | Role in SkinBook                                                  |
|--------------|------------------------------------------------------------------|
| **Base MCP** | The action surface — the user's assistant proposes book/cancel/etc. and the user approves in their Base Account |
| **Moonwell** | The deposit vault — deposits earn yield while held, refund/slash redeems them |
| **x402**     | *Optional.* A non-refundable per-reservation booking fee, separate from the refundable deposit |

---

## 3. How Base MCP is implemented (no-custody actions)

The Base MCP article's requirement is: the agent *proposes*, the **user approves in
their Base Account**, and the MCP layer never holds a key. SkinBook ships exactly
that as a **skill plugin** — `plugins/skinbook.md` backed by the **prepare service**
(`offchain/prepare/server.ts`).

The plugin follows the four mandatory sections from the Base MCP custom-plugin spec:

1. **Onboarding gate** — a `STOP` that forces Base MCP onboarding (`get_wallets`)
   and a deposit/slash risk disclaimer before any action.
2. **Read endpoints** — `GET /info`, `GET /businesses`, `GET /bookings`,
   `GET /reliability/:id` for state, with USDC units documented.
3. **Prepare endpoints** — `POST /prepare/{register-business, book, cancel,
   confirm-attendance, claim-noshow, dispute}` return **unsigned calldata** as a
   batch of `{ to, value, data, chainId }` objects (the USDC approval is batched as
   the first call ahead of `book`). The service uses
   `ethers.Interface.encodeFunctionData` and **never touches a private key**.
4. **`send_calls` mapping** — the assistant maps the returned `calls` into Base MCP
   `send_calls` on the right `chainName`, gets an approval link, and the user signs
   the atomic batch in their **Base Account**. Status is polled via
   `get_request_status`.

So a user-facing action like booking a slot is `prepare → send_calls → Base Account
approval` — *nothing moves without the user*. The keeper roles (`settleNoShow`,
`resolveDispute`) are protocol/arbiter actions and are intentionally *not* exposed
as user prepare endpoints.

Example — `POST /prepare/book {"businessId":1,"slotTime":<ts>}` looks up the
business's on-chain deposit and returns:

```json
{
  "description": "Book a slot at <business> and deposit 2.00 USDC into Moonwell.",
  "chainId": 84532,
  "chainName": "base-sepolia",
  "calls": [
    { "to": "<USDC>",     "value": "0x0", "data": "0x095ea7b3…", "chainId": 84532, "summary": "Approve 2.00 USDC" },
    { "to": "<SkinBook>", "value": "0x0", "data": "0x…",         "chainId": 84532, "summary": "book(1, <slotTime>)" }
  ]
}
```

### The reliability score

Discovery is what makes the deposit *matter* to a customer choosing where to book.
`offchain/shared/registry.ts → scoreBusiness` ranks businesses by honored-booking
rate weighted by volume:

```ts
reliability = bookingsHonored / (bookingsHonored + noShows)   // or 1 with no history
score       = reliability * log10(10 + bookingsHonored + noShows)
```

A clean record and real volume lift a business; a string of upheld no-show *disputes*
(i.e. false no-shows the business lost) drags reliability down. The dashboard's
`skinbook_reliability()` panel renders this ranking live.

---

## 4. How Moonwell is implemented

The deposit is not a dead card hold — it lives in a **Moonwell ERC-4626 vault** and
earns yield the whole time it secures the booking.

### Deposits as vault shares

`SkinBook.sol` holds each booking's deposit as **vault shares**, not raw USDC:

- **Book** → `_depositToVault`:
  ```solidity
  usdc.safeTransferFrom(msg.sender, address(this), amount);
  usdc.forceApprove(address(vault), amount);
  shares = vault.deposit(amount, address(this));   // shares recorded on the booking
  ```
- **Current deposit value** is read live from the vault:
  ```solidity
  function bookingValue(uint256 id) → vault.convertToAssets(bookings[id].shares)
  ```
  Because the vault accrues yield, `convertToAssets(shares)` grows over time — so a
  refunded customer gets back **more than they deposited**. (In the dashboard this
  shows as each business's held deposits ticking above their principal.)

- **Refund** → atomic redeem straight to the customer, yield riding with principal:
  ```solidity
  assets = vault.redeem(shares, customer, address(this));   // cancel / confirm / dispute-won
  ```
- **Slash** → atomic redeem, fee skimmed, remainder to the business:
  ```solidity
  uint256 assets = vault.redeem(shares, address(this), address(this));
  fee = assets * protocolFeeBps / 10_000;   // → treasury
  // assets − fee → business owner
  ```
  The shares convert back to liquid USDC in the same transaction that pays out, so
  there is no settlement gap.

The constructor enforces `vault.asset() == usdc`, so the deposit asset and the
vault's underlying can never diverge. Moonwell exposes real ERC-4626 vaults on Base
**mainnet** (ERC20 4626 factory `0xe770BD40b6976Efbbb095174395DD2cb794c938a`); Base
Sepolia only has partial Moonwell test deployments, so the testnet demo uses a
Moonwell-interface-compatible mock (`MockMoonwellVault`) over real Circle USDC.
Moving to mainnet is a one-line address change (`MOONWELL_VAULT=…`) — the contract
only ever talks to the ERC-4626 interface, so no code changes.

### Booking lifecycle (state machine)

```
                cancel (before slot − cancellationWindow)        ┌────────────┐
        ┌──────────────────────────────────────────────────────►│  Refunded  │ (terminal)
        │       confirmAttendance (business)                     └────────────┘
        │  ┌────────────────────────────────────────────────────────▲
  ┌─────┴──┴─┐  claimNoShow            ┌───────────────┐  dispute     │ resolveDispute(true)
  │  Booked  │───(after slot+grace)──► │ NoShowClaimed │──(in window)─┤
  └──────────┘                         └───────┬───────┘              ▼
                                               │             ┌─────────────┐ resolveDispute(false)
                                  settleNoShow │             │  Disputed   │──────────┐
                               (after window,  │             └─────────────┘          │
                                anyone)        ▼                                       ▼
                                        ┌────────────┐◄─────────────────────────  ┌────────────┐
                                        │  Slashed   │ (terminal — deposit to business + fee)
                                        └────────────┘
```

`MAX_FEE_BPS = 2000` caps the protocol fee, `disputeWindow` bounds how long a
no-show claim stays contestable, and `resolveDispute` is `onlyVerifier` — so the
trusted surface is small, bounded, and only reached on a contested no-show.

### Key contract surface (`contracts/SkinBook.sol`)

| Function                                          | Who         | Effect                                                     |
|---------------------------------------------------|-------------|------------------------------------------------------------|
| `registerBusiness(name, deposit, cancelWin, grace)` | business    | list a business + its booking policy                       |
| `updateBusiness` / `deactivateBusiness`           | business    | edit policy / stop new bookings                            |
| `book(businessId, slotTime)`                      | customer    | deposit → vault shares, open a booking                     |
| `cancel(bookingId)`                               | customer    | before cutoff → refund + yield                             |
| `confirmAttendance(bookingId)`                    | business    | customer showed → refund + yield to customer               |
| `claimNoShow(bookingId)`                          | business    | after slot + grace → open the dispute window               |
| `settleNoShow(bookingId)`                         | anyone      | after window, uncontested → slash to business + fee        |
| `dispute(bookingId)`                              | customer    | within window → escalate to the arbiter                    |
| `resolveDispute(bookingId, present)`              | arbiter     | present → refund customer; absent → slash to business      |

---

## 5. How x402 is implemented (optional booking fee)

x402 is *not* the deposit rail — the refundable deposit lives on-chain in the vault.
x402 covers a different, optional piece: a small **non-refundable booking fee** a
business may charge just to *make* a reservation (the cost of holding the slot open),
separate from the deposit that comes back.

`offchain/reservation/server.ts` gates `POST /reserve` behind an x402 middleware
(`offchain/shared/x402gate.ts`):

- **Real mode (`X402_ENABLED=true`):** uses `x402-express`'s `paymentMiddleware`,
  which settles real USDC through the configured Base facilitator
  (`https://x402.org/facilitator`) via EIP-3009 gasless transfer.
- **Demo mode (default):** a self-contained gate that performs the *same* HTTP 402
  handshake — an unpaid request gets `402` with the `accepts` payment requirements
  (`scheme: "exact"`, `network`, `maxAmountRequired`, `payTo`, `asset: "USDC"`); a
  request carrying an `X-PAYMENT` header is let through. This keeps the flow runnable
  with no facilitator or funded wallet, while staying byte-compatible with the spec.

A successful `/reserve` returns a reservation authorization plus the next-step hint
to `prepare → send_calls` the on-chain `book` (which posts the refundable deposit).
The two money flows are deliberately independent.

---

## 6. End-to-end demo flow

The narrative the dashboard tells, end to end:

1. **List** — a business registers with a deposit policy (`registerBusiness`); it
   appears in the reliability ranking with a "New" tier.
2. **Book** — a customer `book`s a slot; the deposit is supplied to Moonwell and the
   held value starts accruing yield live on the dashboard.
3. **Honest paths** — the customer either `cancel`s in time or the business
   `confirmAttendance`s; either way the deposit + yield is refunded, `bookingsHonored++`,
   and the business's reliability climbs.
4. **No-show** — a different booking goes unattended; after the grace period the
   business `claimNoShow`s, opening the dispute window.
5. **Settle** — the window passes uncontested, anyone calls `settleNoShow`, and the
   deposit is slashed to the business (minus the protocol fee); `noShows++`.
6. **Contested** — on a *false* no-show the customer `dispute`s; the arbiter
   `resolveDispute(…, present)` refunds them and the business eats the loss on its
   reliability score.

Every on-chain step emits an event the Next.js dashboard reads live
(`BusinessRegistered` / `Booked` / `Cancelled` / `AttendanceConfirmed` /
`NoShowSettled` / `DisputeResolved`), rendered as the booking/cancel/attended/no-show
activity feed.

---

## 7. Running it locally

```bash
# contract
npx hardhat compile && npx hardhat test

# off-chain (no-custody Base MCP layer)
cd offchain && npm install
npm run smoke         # offline: USDC round-trip, status mirror, calldata encoding
npm run prepare       # Base MCP prepare/calldata service on :4200 (no keys)
npm run reservation   # optional x402 booking-fee desk on :4300
npm run keeper        # settles uncontested no-shows; surfaces disputes

# dashboard
cd ../dashboard && npm install && npm run dev   # http://localhost:3000
```

Env lives in `offchain/.env` (RPC, `SKINBOOK_ADDR`, `X402_ENABLED`, `KEEPER_PRIVATE_KEY`)
and the dashboard reads `SKINBOOK_ADDR` + `RPC_URL` (falling back to demo data when
unset). Flip `X402_ENABLED=true` for real-USDC booking-fee settlement through the
Base facilitator.

### Contract verification (Etherscan API V2)

Base contract data is served by **Etherscan API V2** — a single key works for Base
and 60+ EVM chains via the `chainid` param (Base Sepolia = `84532`). Wire the key
into `hardhat.config.ts`'s `etherscan.apiKey` to verify the deployed contract on
BaseScan.
