import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

const USDC = (n: number) => BigInt(Math.round(n * 1e6)); // 6 decimals
const MIN_BOND = USDC(100);
const MIN_CHALLENGER_BOND = USDC(5);
const FEE_BPS = 500; // 5%

async function deployFixture() {
  const [owner, operatorA, operatorB, client, verifier, treasury] =
    await ethers.getSigners();

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();

  const MockVault = await ethers.getContractFactory("MockMetaMorpho");
  const vault = await MockVault.deploy(await usdc.getAddress());

  const ProofStake = await ethers.getContractFactory("ProofStake");
  const ps = await ProofStake.deploy(
    await usdc.getAddress(),
    await vault.getAddress(),
    verifier.address,
    treasury.address,
    FEE_BPS,
    MIN_BOND,
    MIN_CHALLENGER_BOND
  );

  // Fund everyone generously.
  for (const s of [operatorA, operatorB, client, verifier]) {
    await usdc.mint(s.address, USDC(10_000));
  }

  const psAddr = await ps.getAddress();
  return { usdc, vault, ps, psAddr, owner, operatorA, operatorB, client, verifier, treasury };
}

async function registerAgent(
  ctx: Awaited<ReturnType<typeof deployFixture>>,
  operator: any,
  endpoint: string,
  bond: bigint
) {
  await ctx.usdc.connect(operator).approve(ctx.psAddr, bond);
  const tx = await ctx.ps.connect(operator).register(endpoint, bond);
  const rc = await tx.wait();
  // agentId is the new agentCount
  return await ctx.ps.agentCount();
}

describe("ProofStake", () => {
  describe("deployment", () => {
    it("stores config and rejects fee above ceiling", async () => {
      const ctx = await loadFixture(deployFixture);
      expect(await ctx.ps.protocolFeeBps()).to.equal(FEE_BPS);
      expect(await ctx.ps.minBond()).to.equal(MIN_BOND);
      expect(await ctx.ps.verifier()).to.equal(ctx.verifier.address);

      const ProofStake = await ethers.getContractFactory("ProofStake");
      await expect(
        ProofStake.deploy(
          await ctx.usdc.getAddress(),
          await ctx.vault.getAddress(),
          ctx.verifier.address,
          ctx.treasury.address,
          5000, // > MAX_FEE_BPS
          MIN_BOND,
          MIN_CHALLENGER_BOND
        )
      ).to.be.revertedWithCustomError(ctx.ps, "FeeTooHigh");
    });
  });

  describe("register / bond", () => {
    it("pulls USDC, deposits to the vault, and tracks shares", async () => {
      const ctx = await loadFixture(deployFixture);
      const bond = USDC(1_000);
      const id = await registerAgent(ctx, ctx.operatorA, "https://a.example/mcp", bond);

      const agent = await ctx.ps.agents(id);
      expect(agent.operator).to.equal(ctx.operatorA.address);
      expect(agent.active).to.equal(true);
      expect(agent.shares).to.be.gt(0n);

      // Bond value should equal what was deposited (no yield yet).
      expect(await ctx.ps.bondValue(id)).to.equal(bond);
      // Vault holds the USDC.
      expect(await ctx.usdc.balanceOf(await ctx.vault.getAddress())).to.equal(bond);
    });

    it("reverts when bond is below the minimum", async () => {
      const ctx = await loadFixture(deployFixture);
      await ctx.usdc.connect(ctx.operatorA).approve(ctx.psAddr, USDC(10));
      await expect(
        ctx.ps.connect(ctx.operatorA).register("x", USDC(10))
      ).to.be.revertedWithCustomError(ctx.ps, "BondTooSmall");
    });

    it("supports top-up by the operator only", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await registerAgent(ctx, ctx.operatorA, "a", USDC(500));

      await ctx.usdc.connect(ctx.operatorB).approve(ctx.psAddr, USDC(100));
      await expect(
        ctx.ps.connect(ctx.operatorB).topUp(id, USDC(100))
      ).to.be.revertedWithCustomError(ctx.ps, "NotOperator");

      await ctx.usdc.connect(ctx.operatorA).approve(ctx.psAddr, USDC(250));
      await ctx.ps.connect(ctx.operatorA).topUp(id, USDC(250));
      expect(await ctx.ps.bondValue(id)).to.equal(USDC(750));
    });
  });

  describe("yield", () => {
    it("accrues Morpho yield to the agent's bond value", async () => {
      const ctx = await loadFixture(deployFixture);
      const bond = USDC(1_000);
      const id = await registerAgent(ctx, ctx.operatorA, "a", bond);

      // Simulate 10% interest donated to the vault.
      const yieldAmt = USDC(100);
      await ctx.usdc.connect(ctx.client).approve(await ctx.vault.getAddress(), yieldAmt);
      await ctx.vault.connect(ctx.client).simulateYield(yieldAmt);

      // The single depositor owns ~all shares, so value rises to ~1100.
      expect(await ctx.ps.bondValue(id)).to.be.closeTo(USDC(1_100), USDC(1));
    });
  });

  describe("listActive", () => {
    it("returns only active agents", async () => {
      const ctx = await loadFixture(deployFixture);
      const a = await registerAgent(ctx, ctx.operatorA, "a", USDC(200));
      const b = await registerAgent(ctx, ctx.operatorB, "b", USDC(300));

      let active = await ctx.ps.listActive();
      expect(active.map((x: bigint) => x.toString())).to.have.members([a.toString(), b.toString()]);

      await ctx.ps.connect(ctx.operatorA).deactivate(a);
      active = await ctx.ps.listActive();
      expect(active.map((x: bigint) => x.toString())).to.deep.equal([b.toString()]);
    });
  });

  describe("reputation", () => {
    it("records jobs only via the verifier", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await registerAgent(ctx, ctx.operatorA, "a", USDC(200));

      await expect(
        ctx.ps.connect(ctx.client).recordJob(id, ethers.id("req-1"), true)
      ).to.be.revertedWithCustomError(ctx.ps, "NotVerifier");

      await ctx.ps.connect(ctx.verifier).recordJob(id, ethers.id("req-1"), true);
      await ctx.ps.connect(ctx.verifier).recordJob(id, ethers.id("req-2"), false);

      const rep = await ctx.ps.getReputation(id);
      expect(rep.jobsServed).to.equal(2n);
      expect(rep.jobsSuccessful).to.equal(1n);
      expect(rep.timesSlashed).to.equal(0n);
      expect(rep.active).to.equal(true);
    });
  });

  describe("challenge / slash", () => {
    it("slashes the full bond to the challenger on an upheld challenge", async () => {
      const ctx = await loadFixture(deployFixture);
      const bond = USDC(1_000);
      const id = await registerAgent(ctx, ctx.operatorA, "a", bond);

      const cBond = USDC(10);
      await ctx.usdc.connect(ctx.client).approve(ctx.psAddr, cBond);
      await ctx.ps
        .connect(ctx.client)
        .challenge(id, ethers.id("req-bad"), "ipfs://evidence", cBond);

      const before = await ctx.usdc.balanceOf(ctx.client.address);
      const treasuryBefore = await ctx.usdc.balanceOf(ctx.treasury.address);

      await ctx.ps.connect(ctx.verifier).resolve(1, true);

      const fee = (bond * BigInt(FEE_BPS)) / 10_000n;
      const expectedPayout = bond - fee + cBond;

      expect(await ctx.usdc.balanceOf(ctx.client.address)).to.equal(before + expectedPayout);
      expect(await ctx.usdc.balanceOf(ctx.treasury.address)).to.equal(treasuryBefore + fee);

      const agent = await ctx.ps.agents(id);
      expect(agent.active).to.equal(false);
      expect(agent.shares).to.equal(0n);
      expect(agent.timesSlashed).to.equal(1n);
      expect(await ctx.ps.bondValue(id)).to.equal(0n);
    });

    it("awards the challenger bond to the operator on a rejected challenge", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await registerAgent(ctx, ctx.operatorA, "a", USDC(1_000));

      const cBond = USDC(10);
      await ctx.usdc.connect(ctx.client).approve(ctx.psAddr, cBond);
      await ctx.ps.connect(ctx.client).challenge(id, ethers.id("req-ok"), "ipfs://x", cBond);

      const opBefore = await ctx.usdc.balanceOf(ctx.operatorA.address);
      await ctx.ps.connect(ctx.verifier).resolve(1, false);

      expect(await ctx.usdc.balanceOf(ctx.operatorA.address)).to.equal(opBefore + cBond);

      const rep = await ctx.ps.getReputation(id);
      expect(rep.jobsServed).to.equal(1n);
      expect(rep.jobsSuccessful).to.equal(1n);
      expect(rep.timesSlashed).to.equal(0n);
      expect(rep.active).to.equal(true);
    });

    it("includes accrued yield in the slashed amount", async () => {
      const ctx = await loadFixture(deployFixture);
      const bond = USDC(1_000);
      const id = await registerAgent(ctx, ctx.operatorA, "a", bond);

      const yieldAmt = USDC(100);
      await ctx.usdc.connect(ctx.client).approve(await ctx.vault.getAddress(), yieldAmt);
      await ctx.vault.connect(ctx.client).simulateYield(yieldAmt);

      const cBond = USDC(10);
      await ctx.usdc.connect(ctx.client).approve(ctx.psAddr, cBond);
      await ctx.ps.connect(ctx.client).challenge(id, ethers.id("r"), "ipfs://e", cBond);

      const before = await ctx.usdc.balanceOf(ctx.client.address);
      await ctx.ps.connect(ctx.verifier).resolve(1, true);

      const slashed = await ctx.usdc.balanceOf(ctx.client.address);
      // Payout should reflect ~1100 principal+yield minus 5% fee, plus the 10 bond.
      const gained = slashed - before;
      const expected = USDC(1_100) - (USDC(1_100) * BigInt(FEE_BPS)) / 10_000n + cBond;
      expect(gained).to.be.closeTo(expected, USDC(1));
    });

    it("rejects challenges below the minimum challenger bond", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await registerAgent(ctx, ctx.operatorA, "a", USDC(200));
      await ctx.usdc.connect(ctx.client).approve(ctx.psAddr, USDC(1));
      await expect(
        ctx.ps.connect(ctx.client).challenge(id, ethers.id("r"), "x", USDC(1))
      ).to.be.revertedWithCustomError(ctx.ps, "ChallengerBondTooSmall");
    });

    it("only the verifier can resolve, and only once", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await registerAgent(ctx, ctx.operatorA, "a", USDC(200));
      await ctx.usdc.connect(ctx.client).approve(ctx.psAddr, USDC(10));
      await ctx.ps.connect(ctx.client).challenge(id, ethers.id("r"), "x", USDC(10));

      await expect(
        ctx.ps.connect(ctx.client).resolve(1, true)
      ).to.be.revertedWithCustomError(ctx.ps, "NotVerifier");

      await ctx.ps.connect(ctx.verifier).resolve(1, true);
      await expect(
        ctx.ps.connect(ctx.verifier).resolve(1, false)
      ).to.be.revertedWithCustomError(ctx.ps, "AlreadyResolved");
    });

    it("cannot challenge an inactive agent", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await registerAgent(ctx, ctx.operatorA, "a", USDC(200));
      await ctx.ps.connect(ctx.operatorA).deactivate(id);

      await ctx.usdc.connect(ctx.client).approve(ctx.psAddr, USDC(10));
      await expect(
        ctx.ps.connect(ctx.client).challenge(id, ethers.id("r"), "x", USDC(10))
      ).to.be.revertedWithCustomError(ctx.ps, "AgentNotActive");
    });
  });

  describe("withdraw", () => {
    it("blocks withdraw while active and during cooldown, then pays out", async () => {
      const ctx = await loadFixture(deployFixture);
      const bond = USDC(1_000);
      const id = await registerAgent(ctx, ctx.operatorA, "a", bond);

      await expect(
        ctx.ps.connect(ctx.operatorA).withdraw(id)
      ).to.be.revertedWithCustomError(ctx.ps, "AgentInactive");

      await ctx.ps.connect(ctx.operatorA).deactivate(id);
      await expect(
        ctx.ps.connect(ctx.operatorA).withdraw(id)
      ).to.be.revertedWithCustomError(ctx.ps, "CooldownActive");

      // Add yield, fast-forward past cooldown, then withdraw.
      const yieldAmt = USDC(50);
      await ctx.usdc.connect(ctx.client).approve(await ctx.vault.getAddress(), yieldAmt);
      await ctx.vault.connect(ctx.client).simulateYield(yieldAmt);

      await ethers.provider.send("evm_increaseTime", [7 * 24 * 3600 + 1]);
      await ethers.provider.send("evm_mine", []);

      const before = await ctx.usdc.balanceOf(ctx.operatorA.address);
      await ctx.ps.connect(ctx.operatorA).withdraw(id);
      const gained = (await ctx.usdc.balanceOf(ctx.operatorA.address)) - before;

      expect(gained).to.be.closeTo(bond + yieldAmt, USDC(1));
      expect((await ctx.ps.agents(id)).shares).to.equal(0n);
    });
  });
});
