import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// 6-decimal helpers
const USDC = (n: number) => BigInt(Math.round(n * 1e6));

/**
 * Deploys SkinBook against three supported vault/USDC combinations:
 *
 *   1. MOONWELL_VAULT set            -> use that real ERC4626 vault + the real USDC
 *                                       at USDC (must be the vault's asset). On Base
 *                                       mainnet point this at a real Moonwell 4626
 *                                       USDC vault (factory 0xe770BD40…b794c938a).
 *   2. USDC set, MOONWELL_VAULT unset-> use the real USDC at USDC, but deploy our
 *                                       MockMoonwellVault ERC4626 vault wrapping it.
 *                                       (Used for the Base Sepolia demo: real Circle
 *                                       USDC, reliable Moonwell-shaped mock vault —
 *                                       Moonwell's real 4626 USDC vault is mainnet-only.)
 *   3. neither set                   -> deploy MockUSDC + MockMoonwellVault (local).
 *
 * Deposit floor + dispute window default to demo-friendly values. minDeposit is
 * faucet-scale so the whole booking demo fits inside Circle's ~10 USDC/day drip.
 */
export default buildModule("SkinBookModule", (m) => {
  const externalUsdc = process.env.USDC ?? "";
  const externalVault = process.env.MOONWELL_VAULT ?? "";

  const verifier = m.getParameter("verifier", m.getAccount(0));
  const treasury = m.getParameter("treasury", m.getAccount(0));
  const protocolFeeBps = m.getParameter("protocolFeeBps", 500);
  const minDeposit = m.getParameter("minDeposit", USDC(0.5));
  // 1 day default; the demo shortens this via setDisputeWindow if needed.
  const disputeWindow = m.getParameter("disputeWindow", 24 * 3600);

  let usdcAddr: any;
  let vaultAddr: any;

  if (externalVault !== "") {
    usdcAddr = externalUsdc;
    vaultAddr = externalVault;
  } else if (externalUsdc !== "") {
    usdcAddr = externalUsdc;
    vaultAddr = m.contract("MockMoonwellVault", [externalUsdc]);
  } else {
    const usdc = m.contract("MockUSDC");
    usdcAddr = usdc;
    vaultAddr = m.contract("MockMoonwellVault", [usdc]);
  }

  const skinBook = m.contract("SkinBook", [
    usdcAddr,
    vaultAddr,
    verifier,
    treasury,
    protocolFeeBps,
    minDeposit,
    disputeWindow,
  ]);

  return { skinBook };
});
