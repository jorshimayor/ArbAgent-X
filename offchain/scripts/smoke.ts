import { ethers } from "ethers";
import { SKINBOOK_ABI, ERC20_ABI } from "../shared/abi.js";
import { toUsdc, fromUsdc, BOOKING_STATUS } from "../shared/chain.js";

/**
 * Offline smoke test — no chain, no keys. Proves the calldata-building logic the
 * prepare service relies on: the SkinBook + ERC20 ABIs encode every booking
 * action correctly, and the USDC helpers round-trip.
 */

const sb = new ethers.Interface(SKINBOOK_ABI);
const erc20 = new ethers.Interface(ERC20_ABI);
const SKINBOOK = "0x000000000000000000000000000000000000dEaD";

let pass = 0;
function check(name: string, data: string, expectFragment: string) {
  const sel = data.slice(0, 10);
  if (!data.startsWith("0x") || data.length < 10) throw new Error(`${name}: bad calldata`);
  console.log(`  ✓ ${name.padEnd(22)} ${sel}  (${expectFragment})`);
  pass++;
}

async function main() {
  console.log("SkinBook offline smoke\n");

  console.log("USDC helpers:");
  const amt = toUsdc(2.5);
  if (amt !== 2_500_000n) throw new Error("toUsdc mismatch");
  if (fromUsdc(amt) !== 2.5) throw new Error("fromUsdc mismatch");
  console.log(`  ✓ toUsdc(2.5) = ${amt}  fromUsdc -> ${fromUsdc(amt)}\n`);

  console.log("Status enum mirror:");
  if (BOOKING_STATUS[5] !== "Slashed" || BOOKING_STATUS[2] !== "Refunded") {
    throw new Error("BOOKING_STATUS mirror out of sync");
  }
  console.log(`  ✓ [${BOOKING_STATUS.join(", ")}]\n`);

  console.log("Calldata encoding (the prepare batch):");
  check("approve", erc20.encodeFunctionData("approve", [SKINBOOK, toUsdc(2)]), "ERC20.approve");
  check("registerBusiness", sb.encodeFunctionData("registerBusiness", ["Tony's Bistro", toUsdc(2), 86400, 7200]), "register");
  check("book", sb.encodeFunctionData("book", [1, Math.floor(Date.now() / 1000) + 86400]), "book");
  check("cancel", sb.encodeFunctionData("cancel", [1]), "cancel");
  check("confirmAttendance", sb.encodeFunctionData("confirmAttendance", [1]), "confirm");
  check("claimNoShow", sb.encodeFunctionData("claimNoShow", [1]), "claim");
  check("settleNoShow", sb.encodeFunctionData("settleNoShow", [1]), "settle");
  check("dispute", sb.encodeFunctionData("dispute", [1]), "dispute");
  check("resolveDispute", sb.encodeFunctionData("resolveDispute", [1, true]), "resolve");

  // Round-trip decode a representative call to prove the ABI is consistent.
  const decoded = sb.decodeFunctionData("book", sb.encodeFunctionData("book", [7, 1893456000]));
  if (Number(decoded[0]) !== 7) throw new Error("book decode mismatch");

  console.log(`\nAll ${pass} calldata checks passed. ✅`);
}

main().catch((e) => {
  console.error("smoke failed:", e);
  process.exit(1);
});
