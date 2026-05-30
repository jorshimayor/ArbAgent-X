import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// 6-decimal helpers
const USDC = (n: number) => BigInt(Math.round(n * 1e6));

/**
 * Deploys ProofStake against three supported vault/USDC combinations:
 *
 *   1. MORPHO_VAULT set            -> use that real ERC4626 vault + the real USDC
 *                                     at USDC (must be the vault's asset).
 *   2. USDC set, MORPHO_VAULT unset-> use the real USDC at USDC, but deploy our
 *                                     MockMetaMorpho ERC4626 vault wrapping it.
 *                                     (Used for the Base Sepolia demo: real Circle
 *                                     USDC, reliable mock vault for instant slash.)
 *   3. neither set                 -> deploy MockUSDC + MockMetaMorpho (local).
 *
 * Bond minimums default to faucet-friendly amounts so the whole demo fits inside
 * the ~10 USDC/day Circle testnet faucet drip.
 */
export default buildModule("ProofStakeModule", (m) => {
  const externalUsdc = process.env.USDC ?? "";
  const externalVault = process.env.MORPHO_VAULT ?? "";

  const verifier = m.getParameter("verifier", m.getAccount(0));
  const treasury = m.getParameter("treasury", m.getAccount(0));
  const protocolFeeBps = m.getParameter("protocolFeeBps", 500);
  const minBond = m.getParameter("minBond", USDC(0.5));
  const minChallengerBond = m.getParameter("minChallengerBond", USDC(0.05));

  let usdcAddr: any;
  let vaultAddr: any;

  if (externalVault !== "") {
    usdcAddr = externalUsdc;
    vaultAddr = externalVault;
  } else if (externalUsdc !== "") {
    usdcAddr = externalUsdc;
    vaultAddr = m.contract("MockMetaMorpho", [externalUsdc]);
  } else {
    const usdc = m.contract("MockUSDC");
    usdcAddr = usdc;
    vaultAddr = m.contract("MockMetaMorpho", [usdc]);
  }

  const proofStake = m.contract("ProofStake", [
    usdcAddr,
    vaultAddr,
    verifier,
    treasury,
    protocolFeeBps,
    minBond,
    minChallengerBond,
  ]);

  return { proofStake };
});
