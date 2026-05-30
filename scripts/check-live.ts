import { ethers } from "hardhat";

const fromUsdc = (v: bigint) => Number(v) / 1e6;

/**
 * Read-only health check of the live SkinBook. Prints config, roles, balances,
 * and current businesses/bookings so we can size the on-chain lifecycle demo.
 * Prints PUBLIC addresses only — never private keys.
 */
async function main() {
  const addr = process.env.SKINBOOK_ADDR;
  if (!addr) throw new Error("Set SKINBOOK_ADDR");

  const [deployer] = await ethers.getSigners();
  const sb = await ethers.getContractAt("SkinBook", addr, deployer);

  const [usdcAddr, vaultAddr, verifier, treasury, owner, feeBps, minDeposit, disputeWindow, bizCount, bookingCount] =
    await Promise.all([
      sb.usdc(),
      sb.vault(),
      sb.verifier(),
      sb.treasury(),
      sb.owner(),
      sb.protocolFeeBps(),
      sb.minDeposit(),
      sb.disputeWindow(),
      sb.businessCount(),
      sb.bookingCount(),
    ]);

  const usdc = await ethers.getContractAt("MockUSDC", usdcAddr, deployer);
  const [bal, allowance] = await Promise.all([
    usdc.balanceOf(deployer.address),
    usdc.allowance(deployer.address, addr),
  ]);

  console.log("=== SkinBook live config ===");
  console.log("SkinBook      :", addr);
  console.log("USDC          :", usdcAddr);
  console.log("Vault         :", vaultAddr);
  console.log("owner         :", owner);
  console.log("verifier      :", verifier);
  console.log("treasury      :", treasury);
  console.log("protocolFeeBps:", Number(feeBps));
  console.log("minDeposit    :", fromUsdc(minDeposit), "USDC");
  console.log("disputeWindow :", Number(disputeWindow), "s");
  console.log("businessCount :", Number(bizCount));
  console.log("bookingCount  :", Number(bookingCount));
  console.log("");
  console.log("=== Signer (deployer) ===");
  console.log("address       :", deployer.address);
  console.log("is owner?     :", owner.toLowerCase() === deployer.address.toLowerCase());
  console.log("is verifier?  :", verifier.toLowerCase() === deployer.address.toLowerCase());
  console.log("USDC balance  :", fromUsdc(bal), "USDC");
  console.log("ETH balance   :", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
  console.log("allowance->sb :", fromUsdc(allowance), "USDC");

  console.log("\n=== Bookings ===");
  const STATUS = ["None", "Booked", "Refunded", "NoShowClaimed", "Disputed", "Slashed"];
  for (let id = 1; id <= Number(bookingCount); id++) {
    const bk = await sb.bookings(id);
    const val = await sb.bookingValue(id);
    console.log(
      `#${id} biz=${Number(bk.businessId)} status=${STATUS[Number(bk.status)]} slot=${new Date(
        Number(bk.slotTime) * 1000
      ).toISOString()} value=${fromUsdc(val)} USDC`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
