// Rewrites offchain/.env with the correct SkinBook variable names, copying the
// deployer key from the root .env into KEEPER_PRIVATE_KEY. Never prints secrets.
import { readFileSync, writeFileSync } from "node:fs";
import { Wallet } from "ethers";

const root = readFileSync(new URL("../.env", import.meta.url), "utf8");
const get = (src, key) => {
  const m = src.match(new RegExp(`^${key}=(.*)$`, "m"));
  return m ? m[1].trim() : "";
};

const deployerKey = get(root, "DEPLOYER_PRIVATE_KEY");
if (!deployerKey || !deployerKey.startsWith("0x")) {
  throw new Error("DEPLOYER_PRIVATE_KEY missing from root .env");
}
const addr = new Wallet(deployerKey).address; // public address only

const SKINBOOK_ADDR = "0x60420945473eaa950CAd60902457F4481FB9dd25";

const out = `# SkinBook off-chain stack — live Base Sepolia.
RPC_URL=https://sepolia.base.org
SKINBOOK_ADDR=${SKINBOOK_ADDR}
CHAIN_ID=84532

# x402 reservation desk. X402_ENABLED=false runs the booking-fee paywall in
# self-contained demo mode (full 402 handshake, no funds move).
X402_ENABLED=false
X402_NETWORK=base-sepolia
X402_FACILITATOR_URL=https://x402.org/facilitator
BOOKING_FEE_USD=0.05

# Keeper / arbiter — settles uncontested no-shows (anyone can) and resolves
# disputed no-shows (must equal SkinBook.verifier()). Here it is the deployer,
# which is also owner + verifier + treasury on the live deployment.
KEEPER_PRIVATE_KEY=${deployerKey}
`;

writeFileSync(new URL("../offchain/.env", import.meta.url), out, "utf8");
console.log("Wrote offchain/.env");
console.log("  SKINBOOK_ADDR     =", SKINBOOK_ADDR);
console.log("  KEEPER address    =", addr, "(should match on-chain verifier)");
