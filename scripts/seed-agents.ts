import { ethers } from "hardhat";

const USDC = (n: number) => BigInt(Math.round(n * 1e6));
const fromUsdc = (v: bigint) => Number(v) / 1e6;

/**
 * Registers the three demo agents against a deployed ProofStake.
 *
 * Bond amounts are intentionally tiny so the whole demo fits inside Circle's
 * ~10 USDC/day Base Sepolia faucet. Endpoints point at the locally-running agent
 * servers so the router and dashboard can reach each agent's /info.
 *
 * Set PROOFSTAKE_ADDR to the deployed address. On a mock-USDC deployment the
 * deployer is auto-minted; on real USDC the deployer must already hold the funds.
 */
async function main() {
  const addr = process.env.PROOFSTAKE_ADDR;
  if (!addr) throw new Error("Set PROOFSTAKE_ADDR to the deployed ProofStake address");

  const [deployer] = await ethers.getSigners();
  const ps = await ethers.getContractAt("ProofStake", addr, deployer);
  const usdcAddr: string = await ps.usdc();
  const usdc = await ethers.getContractAt("MockUSDC", usdcAddr, deployer);

  const agents = [
    { endpoint: process.env.AGENT_GOOD_URL ?? "http://127.0.0.1:4001", bond: USDC(Number(process.env.BOND_GOOD ?? 2)) },
    { endpoint: process.env.AGENT_MEDIOCRE_URL ?? "http://127.0.0.1:4002", bond: USDC(Number(process.env.BOND_MEDIOCRE ?? 1)) },
    { endpoint: process.env.AGENT_BAD_URL ?? "http://127.0.0.1:4003", bond: USDC(Number(process.env.BOND_BAD ?? 0.5)) },
  ];

  const total = agents.reduce((s, a) => s + a.bond, 0n);
  console.log(`Total bond needed: ${fromUsdc(total)} USDC`);

  // Mint for mock USDC; for real USDC verify the deployer is funded.
  try {
    const tx = await usdc.mint(deployer.address, total);
    await tx.wait();
    console.log(`Minted ${fromUsdc(total)} mock USDC to ${deployer.address}`);
  } catch {
    const bal: bigint = await usdc.balanceOf(deployer.address);
    console.log(`Real USDC — deployer balance: ${fromUsdc(bal)} USDC`);
    if (bal < total) {
      throw new Error(
        `Deployer needs >= ${fromUsdc(total)} USDC at ${usdcAddr}. Top up from the Circle Base Sepolia faucet.`
      );
    }
  }

  for (const a of agents) {
    await (await usdc.approve(addr, a.bond)).wait();
    const tx = await ps.register(a.endpoint, a.bond);
    const rc = await tx.wait();
    const id = await ps.agentCount();
    console.log(`Registered agent #${id} -> ${a.endpoint} (bond ${fromUsdc(a.bond)} USDC) tx ${rc?.hash}`);
  }

  const active = (await ps.listActive()).map((x: bigint) => x.toString());
  console.log(`\nActive agents: ${active.join(", ")}`);
  console.log("Run each agent with its AGENT_ID: good=1, mediocre=2, malicious=3");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
