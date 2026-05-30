import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

const USDC = (n: number) => BigInt(Math.round(n * 1e6)); // 6 decimals
const MIN_DEPOSIT = USDC(1);
const DISPUTE_WINDOW = 24 * 3600; // 1 day
const FEE_BPS = 500; // 5%

const DAY = 24 * 3600;

async function deployFixture() {
  const [owner, bizA, bizB, customer, verifier, treasury] =
    await ethers.getSigners();

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();

  const MockVault = await ethers.getContractFactory("MockMoonwellVault");
  const vault = await MockVault.deploy(await usdc.getAddress());

  const SkinBook = await ethers.getContractFactory("SkinBook");
  const sb = await SkinBook.deploy(
    await usdc.getAddress(),
    await vault.getAddress(),
    verifier.address,
    treasury.address,
    FEE_BPS,
    MIN_DEPOSIT,
    DISPUTE_WINDOW
  );

  for (const s of [bizA, bizB, customer, verifier]) {
    await usdc.mint(s.address, USDC(10_000));
  }

  const sbAddr = await sb.getAddress();
  return { usdc, vault, sb, sbAddr, owner, bizA, bizB, customer, verifier, treasury };
}

type Ctx = Awaited<ReturnType<typeof deployFixture>>;

async function registerBusiness(
  ctx: Ctx,
  biz: any,
  name: string,
  deposit: bigint,
  cancelWindow = DAY,
  grace = 2 * 3600
) {
  await ctx.sb.connect(biz).registerBusiness(name, deposit, cancelWindow, grace);
  return await ctx.sb.businessCount();
}

async function book(ctx: Ctx, customer: any, businessId: bigint, deposit: bigint, slotInDays = 3) {
  const slot = (await time()) + slotInDays * DAY;
  await ctx.usdc.connect(customer).approve(ctx.sbAddr, deposit);
  await ctx.sb.connect(customer).book(businessId, slot);
  return { bookingId: await ctx.sb.bookingCount(), slot };
}

async function time() {
  const b = await ethers.provider.getBlock("latest");
  return b!.timestamp;
}

async function warpTo(ts: number) {
  await ethers.provider.send("evm_setNextBlockTimestamp", [ts]);
  await ethers.provider.send("evm_mine", []);
}

describe("SkinBook", () => {
  describe("deployment", () => {
    it("stores config and rejects fee above ceiling", async () => {
      const ctx = await loadFixture(deployFixture);
      expect(await ctx.sb.protocolFeeBps()).to.equal(FEE_BPS);
      expect(await ctx.sb.minDeposit()).to.equal(MIN_DEPOSIT);
      expect(await ctx.sb.disputeWindow()).to.equal(DISPUTE_WINDOW);
      expect(await ctx.sb.verifier()).to.equal(ctx.verifier.address);

      const SkinBook = await ethers.getContractFactory("SkinBook");
      await expect(
        SkinBook.deploy(
          await ctx.usdc.getAddress(),
          await ctx.vault.getAddress(),
          ctx.verifier.address,
          ctx.treasury.address,
          5000, // > MAX_FEE_BPS
          MIN_DEPOSIT,
          DISPUTE_WINDOW
        )
      ).to.be.revertedWithCustomError(ctx.sb, "FeeTooHigh");
    });
  });

  describe("business registry", () => {
    it("registers a business and lists it active", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await registerBusiness(ctx, ctx.bizA, "Tony's Bistro", USDC(20));
      const b = await ctx.sb.businesses(id);
      expect(b.owner).to.equal(ctx.bizA.address);
      expect(b.depositAmount).to.equal(USDC(20));
      expect(b.active).to.equal(true);

      const active = await ctx.sb.listActiveBusinesses();
      expect(active.map((x: bigint) => x.toString())).to.include(id.toString());
    });

    it("rejects a deposit below the floor", async () => {
      const ctx = await loadFixture(deployFixture);
      await expect(
        ctx.sb.connect(ctx.bizA).registerBusiness("x", USDC(0.5), DAY, 3600)
      ).to.be.revertedWithCustomError(ctx.sb, "DepositTooSmall");
    });

    it("only the owner can update or deactivate", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await registerBusiness(ctx, ctx.bizA, "A", USDC(20));
      await expect(
        ctx.sb.connect(ctx.bizB).updateBusiness(id, USDC(30), DAY, 3600)
      ).to.be.revertedWithCustomError(ctx.sb, "NotBusinessOwner");
      await ctx.sb.connect(ctx.bizA).deactivateBusiness(id);
      expect((await ctx.sb.businesses(id)).active).to.equal(false);
    });
  });

  describe("book", () => {
    it("pulls the deposit into the Moonwell vault", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await registerBusiness(ctx, ctx.bizA, "A", USDC(20));
      const { bookingId } = await book(ctx, ctx.customer, id, USDC(20));

      const bk = await ctx.sb.bookings(bookingId);
      expect(bk.customer).to.equal(ctx.customer.address);
      expect(bk.status).to.equal(1n); // Booked
      expect(bk.shares).to.be.gt(0n);
      expect(await ctx.sb.bookingValue(bookingId)).to.equal(USDC(20));
      expect(await ctx.usdc.balanceOf(await ctx.vault.getAddress())).to.equal(USDC(20));
    });

    it("rejects a slot in the past and an inactive business", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await registerBusiness(ctx, ctx.bizA, "A", USDC(20));
      await ctx.usdc.connect(ctx.customer).approve(ctx.sbAddr, USDC(20));
      await expect(
        ctx.sb.connect(ctx.customer).book(id, (await time()) - 10)
      ).to.be.revertedWithCustomError(ctx.sb, "BadSlotTime");

      await ctx.sb.connect(ctx.bizA).deactivateBusiness(id);
      await expect(
        ctx.sb.connect(ctx.customer).book(id, (await time()) + DAY)
      ).to.be.revertedWithCustomError(ctx.sb, "BusinessNotActive");
    });
  });

  describe("cancel (in time)", () => {
    it("refunds the deposit plus yield to the customer", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await registerBusiness(ctx, ctx.bizA, "A", USDC(20), DAY, 2 * 3600);
      const { bookingId } = await book(ctx, ctx.customer, id, USDC(20), 3);

      // Yield accrues while the deposit waits.
      await ctx.usdc.connect(ctx.verifier).approve(await ctx.vault.getAddress(), USDC(2));
      await ctx.vault.connect(ctx.verifier).simulateYield(USDC(2));

      const before = await ctx.usdc.balanceOf(ctx.customer.address);
      await ctx.sb.connect(ctx.customer).cancel(bookingId);
      const gained = (await ctx.usdc.balanceOf(ctx.customer.address)) - before;

      expect(gained).to.be.closeTo(USDC(22), USDC(0.01)); // deposit + yield
      expect((await ctx.sb.bookings(bookingId)).status).to.equal(2n); // Refunded
      expect((await ctx.sb.businesses(id)).bookingsHonored).to.equal(1n);
    });

    it("reverts once the cancellation window has passed", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await registerBusiness(ctx, ctx.bizA, "A", USDC(20), DAY, 2 * 3600);
      const { bookingId, slot } = await book(ctx, ctx.customer, id, USDC(20), 3);

      // Move to inside the 1-day cancellation cutoff.
      await warpTo(slot - DAY + 60);
      await expect(
        ctx.sb.connect(ctx.customer).cancel(bookingId)
      ).to.be.revertedWithCustomError(ctx.sb, "CancelWindowPassed");
    });
  });

  describe("confirmAttendance", () => {
    it("refunds the customer and is owner-only", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await registerBusiness(ctx, ctx.bizA, "A", USDC(20));
      const { bookingId } = await book(ctx, ctx.customer, id, USDC(20));

      await expect(
        ctx.sb.connect(ctx.bizB).confirmAttendance(bookingId)
      ).to.be.revertedWithCustomError(ctx.sb, "NotBusinessOwner");

      const before = await ctx.usdc.balanceOf(ctx.customer.address);
      await ctx.sb.connect(ctx.bizA).confirmAttendance(bookingId);
      expect((await ctx.usdc.balanceOf(ctx.customer.address)) - before).to.equal(USDC(20));
      expect((await ctx.sb.bookings(bookingId)).status).to.equal(2n); // Refunded
    });
  });

  describe("no-show: claim + settle", () => {
    it("slashes the deposit to the business after the dispute window", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await registerBusiness(ctx, ctx.bizA, "A", USDC(20), DAY, 2 * 3600);
      const { bookingId, slot } = await book(ctx, ctx.customer, id, USDC(20), 3);

      // Too early: before slot + grace.
      await expect(
        ctx.sb.connect(ctx.bizA).claimNoShow(bookingId)
      ).to.be.revertedWithCustomError(ctx.sb, "TooEarlyToClaim");

      await warpTo(slot + 2 * 3600 + 1);
      await ctx.sb.connect(ctx.bizA).claimNoShow(bookingId);
      expect((await ctx.sb.bookings(bookingId)).status).to.equal(3n); // NoShowClaimed

      // Can't settle while the dispute window is open.
      await expect(
        ctx.sb.connect(ctx.bizA).settleNoShow(bookingId)
      ).to.be.revertedWithCustomError(ctx.sb, "DisputeWindowOpen");

      await warpTo(slot + 2 * 3600 + 1 + DISPUTE_WINDOW + 1);
      const bizBefore = await ctx.usdc.balanceOf(ctx.bizA.address);
      const treasBefore = await ctx.usdc.balanceOf(ctx.treasury.address);
      await ctx.sb.connect(ctx.bizA).settleNoShow(bookingId);

      const fee = (USDC(20) * BigInt(FEE_BPS)) / 10_000n;
      expect((await ctx.usdc.balanceOf(ctx.bizA.address)) - bizBefore).to.equal(USDC(20) - fee);
      expect((await ctx.usdc.balanceOf(ctx.treasury.address)) - treasBefore).to.equal(fee);
      expect((await ctx.sb.bookings(bookingId)).status).to.equal(5n); // Slashed
      expect((await ctx.sb.businesses(id)).noShows).to.equal(1n);
    });
  });

  describe("disputed no-show", () => {
    it("refunds the customer when the arbiter rules they were present", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await registerBusiness(ctx, ctx.bizA, "A", USDC(20), DAY, 2 * 3600);
      const { bookingId, slot } = await book(ctx, ctx.customer, id, USDC(20), 3);

      await warpTo(slot + 2 * 3600 + 1);
      await ctx.sb.connect(ctx.bizA).claimNoShow(bookingId);
      await ctx.sb.connect(ctx.customer).dispute(bookingId);
      expect((await ctx.sb.bookings(bookingId)).status).to.equal(4n); // Disputed

      await expect(
        ctx.sb.connect(ctx.bizA).resolveDispute(bookingId, true)
      ).to.be.revertedWithCustomError(ctx.sb, "NotVerifier");

      const before = await ctx.usdc.balanceOf(ctx.customer.address);
      await ctx.sb.connect(ctx.verifier).resolveDispute(bookingId, true);
      expect((await ctx.usdc.balanceOf(ctx.customer.address)) - before).to.equal(USDC(20));
      expect((await ctx.sb.bookings(bookingId)).status).to.equal(2n); // Refunded
      expect((await ctx.sb.businesses(id)).bookingsHonored).to.equal(1n);
    });

    it("slashes to the business when the arbiter rules a no-show", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await registerBusiness(ctx, ctx.bizA, "A", USDC(20), DAY, 2 * 3600);
      const { bookingId, slot } = await book(ctx, ctx.customer, id, USDC(20), 3);

      await warpTo(slot + 2 * 3600 + 1);
      await ctx.sb.connect(ctx.bizA).claimNoShow(bookingId);
      await ctx.sb.connect(ctx.customer).dispute(bookingId);

      const fee = (USDC(20) * BigInt(FEE_BPS)) / 10_000n;
      const bizBefore = await ctx.usdc.balanceOf(ctx.bizA.address);
      await ctx.sb.connect(ctx.verifier).resolveDispute(bookingId, false);
      expect((await ctx.usdc.balanceOf(ctx.bizA.address)) - bizBefore).to.equal(USDC(20) - fee);
      expect((await ctx.sb.businesses(id)).noShows).to.equal(1n);
    });

    it("rejects a dispute filed after the window closes", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await registerBusiness(ctx, ctx.bizA, "A", USDC(20), DAY, 2 * 3600);
      const { bookingId, slot } = await book(ctx, ctx.customer, id, USDC(20), 3);

      await warpTo(slot + 2 * 3600 + 1);
      await ctx.sb.connect(ctx.bizA).claimNoShow(bookingId);
      await warpTo(slot + 2 * 3600 + 1 + DISPUTE_WINDOW + 1);
      await expect(
        ctx.sb.connect(ctx.customer).dispute(bookingId)
      ).to.be.revertedWithCustomError(ctx.sb, "DisputeWindowClosed");
    });
  });
});
