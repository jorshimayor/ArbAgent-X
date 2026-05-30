# SkinBook

**No-show deposits with skin in the game.** Refundable booking deposits held as yield-bearing USDC on Base.

No-shows quietly bleed appointment businesses — restaurants, clinics, barbers, salons. The usual fix is a card hold, which is clunky, opaque, and earns the customer nothing. SkinBook makes the deposit *productive and fair*: a customer books a slot and posts a USDC deposit that goes straight into a Moonwell ERC4626 vault, **earning yield while it waits**. Show up or cancel in time → the deposit is refunded *with* its yield. No-show → the deposit is slashed to the business that held the slot.

Built for the Base MCP bounty with **Base MCP + Moonwell** (and optional **x402** for the booking fee). Customer/business actions (register, book, cancel, confirm, dispute) are exposed as a **Base MCP skill plugin** that returns unsigned calldata for one-click approval in the user's Base Account — the MCP layer never holds a private key (see `plugins/skinbook.md`).

## Why it's fairer than ProofStake's model

SkinBook reuses the yield-bearing-deposit core from the earlier ProofStake design, but with a **better trust model**. Most bookings self-resolve on-chain with no arbiter at all:

- **Customer cancels in time** (`cancel`) → trustless refund + yield.
- **Business confirms attendance** (`confirmAttendance`) → refund + yield to the customer; the business gains nothing by confirming, so it has no reason to lie.

Only a *contested* no-show ever touches the trusted arbiter (`verifier`), and only inside a bounded **dispute window**. The arbiter is the exception, not the per-transaction default.

## What's in this repo (v1 contract core)

`contracts/SkinBook.sol` is one contract that holds the registry, the deposit vault, and the no-show settlement logic:

- **Business registry** — `registerBusiness`, `updateBusiness`, `deactivateBusiness`, `getReliability`, `listActiveBusinesses`
- **Deposit vault** — each booking's deposit is deposited straight into a Moonwell ERC4626 USDC vault; it earns yield while held, and refund/slash redeems the shares atomically for liquid USDC
- **No-show settlement** — `book`, `cancel`, `confirmAttendance`, `claimNoShow`, `settleNoShow` (uncontested, anyone), `dispute` (customer), `resolveDispute` (arbiter)

| Path | Purpose |
|---|---|
| `contracts/SkinBook.sol` | Registry + deposit vault + no-show settlement |
| `contracts/mocks/MockUSDC.sol` | 6-decimal test USDC |
| `contracts/mocks/MockMoonwellVault.sol` | Moonwell-shaped ERC4626 vault stand-in with `simulateYield` |
| `test/SkinBook.test.ts` | Full Chai suite (register, book, cancel, attend, no-show, dispute, access control) |
| `ignition/modules/SkinBook.ts` | Deploy module (auto-deploys mocks when `MOONWELL_VAULT` is unset) |
| `scripts/seed-businesses.ts` | Registers the 3 demo businesses + seeds bookings |
| `offchain/prepare/server.ts` | Base MCP prepare service — builds unsigned calldata (no keys) |
| `offchain/reservation/server.ts` | Optional x402-gated booking-fee desk |
| `offchain/keeper/index.ts` | Keeper that settles uncontested no-shows / surfaces disputes |
| `plugins/skinbook.md` | Base MCP skill-plugin spec (onboarding gate, read/prepare endpoints, send_calls) |

## Quickstart (Windows-native, no WSL)

```bash
npm install
npx hardhat compile
npx hardhat test
```

Requires Node 20+. Solidity targets the Cancun EVM (required by OpenZeppelin 5.x).

## Deploy to Base Sepolia

1. Copy `.env.example` to `.env` and fill in `DEPLOYER_PRIVATE_KEY`, `BASESCAN_API_KEY`.
2. To hold deposits in a real Moonwell vault, set `USDC` and `MOONWELL_VAULT` to a Base **mainnet** Moonwell ERC4626 USDC vault (factory `0xe770BD40b6976Efbbb095174395DD2cb794c938a`). On Base Sepolia, leave `MOONWELL_VAULT` blank to deploy the Moonwell-shaped mock (Moonwell's real 4626 USDC vault is mainnet-only).

```bash
npx hardhat ignition deploy ./ignition/modules/SkinBook.ts --network baseSepolia
SKINBOOK_ADDR=0x... npx hardhat run scripts/seed-businesses.ts --network baseSepolia
```

## Contract surface

```solidity
registerBusiness(name, depositAmount, cancellationWindow, gracePeriod) returns (uint256 businessId)
updateBusiness(businessId, depositAmount, cancellationWindow, gracePeriod)
deactivateBusiness(businessId)                      // stop new bookings; existing ones still resolve

book(businessId, slotTime) returns (uint256 bookingId)   // deposit → vault shares
cancel(bookingId)                                   // customer, before slot − cancellationWindow → refund + yield
confirmAttendance(bookingId)                        // business → refund + yield to customer
claimNoShow(bookingId)                              // business, after slot + gracePeriod → opens dispute window
settleNoShow(bookingId)                             // anyone, after dispute window → slash to business
dispute(bookingId)                                  // customer, within dispute window
resolveDispute(bookingId, customerPresent)          // arbiter only

bookingValue(bookingId)                             // live redeemable USDC (principal + yield)
getReliability(businessId)                           // (bookingsHonored, noShows, active)
listActiveBusinesses() returns (uint256[])
```

**Refund paths** (`cancel`, `confirmAttendance`, `resolveDispute(…, true)`) → all shares are redeemed from Moonwell and the deposit **plus its accrued yield** goes to the customer; `bookingsHonored++`.
**Slash paths** (`settleNoShow`, `resolveDispute(…, false)`) → shares redeemed, protocol fee skimmed to treasury, remainder paid to the business; `noShows++`.

## Off-chain stack (`offchain/`)

Pure-Node/TypeScript, run with `tsx`. The Base MCP layer is **no-custody**: it only ever builds unsigned calldata; nothing moves without the user signing in their Base Account.

```bash
cd offchain && npm install
npm run smoke                    # offline: USDC round-trip, status mirror, calldata encoding
npm run prepare                  # Base MCP prepare/calldata service on :4200 (no keys)
npm run reservation              # optional x402-gated booking-fee desk on :4300
npm run keeper                   # settles uncontested no-shows; surfaces disputes to the arbiter
```

- **Base MCP skill plugin** (`plugins/skinbook.md` + `prepare/server.ts`) — turns SkinBook's user actions into a real Base MCP plugin. The prepare service builds **unsigned calldata** (`{to,value,data,chainId}`, with the USDC approval batched in front of `book`) for `register-business` / `book` / `cancel` / `confirm-attendance` / `claim-noshow` / `dispute`; the plugin spec maps that batch into Base MCP `send_calls`, so the user approves and signs in their **Base Account**. No private key ever touches the MCP layer.
- **Reservation desk** (`reservation/server.ts`) — an optional x402-gated endpoint that charges a small **non-refundable booking fee** per reservation (separate from the on-chain refundable deposit). Uses the real `x402-express` middleware when `X402_ENABLED=true`, else a self-contained 402 handshake so it runs key-free.
- **Keeper** (`keeper/index.ts`) — watches `NoShowClaimed`, and after the dispute window calls `settleNoShow` (anyone can); for `Disputed` bookings it surfaces the case for the arbiter's `resolveDispute`. Settling is permissionless; only the contested-dispute verdict needs the trusted arbiter.

## Dashboard (`dashboard/`)

Animated Next.js dashboard (Tailwind + Framer Motion): total deposits held, **live-accruing Moonwell yield**, per-business reliability rings and trust tiers, the `skinbook_reliability` ranking, and a live booking/cancel/attended/no-show feed.

```bash
cd dashboard && npm install && npm run dev   # http://localhost:3000
```

Reads live state from a deployed `SkinBook` when `SKINBOOK_ADDR` + `RPC_URL` are set, and falls back to a rich demo dataset otherwise — so it always demos well and lights up automatically against a chain.

## Status

- Contract + tests: load-bearing, locally-verifiable core — **13 passing tests**.
- Off-chain: Base MCP prepare service (no-custody calldata), optional x402 reservation desk, no-show keeper — **offline smoke suite green**.
- Dashboard: runs, renders, yield visibly accrues, no-show narrative on screen.
- v1 deliberately uses a single trusted arbiter for *contested* no-shows only (called out openly); a verifier committee is v2.
