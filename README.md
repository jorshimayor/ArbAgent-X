# SkinBook

SkinBook is about making booking deposits feel fair again.

If you’ve ever lost your deposit for a missed reservation, you know how annoying it can be. Businesses need a way to protect themselves from no-shows, but customers don’t want money to disappear into a dead card hold.

SkinBook changes that by keeping every deposit working while the reservation is pending. The money sits in a yield-bearing account, and if the booking is kept or canceled in time, the customer gets the deposit back plus whatever it earned.

If the customer doesn't show up and the business has a valid claim, the deposit goes to the business instead — but only after a short dispute window. That means no-shows are handled cleanly, and honest customers don't lose out.

## What this repo is for

This project is a working proof of the idea:

- `contracts/SkinBook.sol` has the booking logic, deposit handling, and no-show flow.
- `test/SkinBook.test.ts` proves the main scenarios work: booking, canceling, confirming attendance, disputing, and settling no-shows.
- `offchain/` contains helpers for the user-facing booking flow, like building unsigned transactions and keeping the state in sync.
- `dashboard/` is a demo UI that shows deposits, yield, and how trusted businesses are performing.

## How SkinBook feels

- Customer books a slot and leaves a refundable deposit.
- The deposit earns yield while it is held.
- If the customer shows up or cancels on time, they get the deposit back plus the yield.
- If the customer no-shows, the business can claim the deposit, but there is a fair dispute step first.

## Why this matters

Most no-show systems are either:

- a frozen credit card hold that earns nothing, or
- a blunt penalty that feels unfair.

SkinBook tries to make the deposit useful instead of wasteful. It gives customers a better experience while still protecting businesses.

## What you can see in the repo

- `contracts/SkinBook.sol` — the core booking contract.
- `test/SkinBook.test.ts` — simple checks for the main booking flows.
- `offchain/prepare/server.ts` — builds unsigned transaction data for the booking actions.
- `offchain/reservation/server.ts` — optional booking-fee logic.
- `offchain/keeper/index.ts` — watches for no-shows and settles them when the time comes.
- `dashboard/` — a demo site showing deposits and booking activity.

## Dashboard demo

To run the dashboard:

```bash
cd dashboard
npm install
npm run dev
```

It can show live state from a deployed contract or a demo dataset if you just want to explore the idea.

