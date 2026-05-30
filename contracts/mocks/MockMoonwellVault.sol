// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Minimal Moonwell-shaped ERC4626 USDC vault for deterministic tests.
/// @dev Moonwell exposes real ERC4626 vaults on Base (e.g. the ERC20 4626
///      factory at 0xe770BD40b6976Efbbb095174395DD2cb794c938a and per-asset
///      vaults like mUSDC). Those live on Base *mainnet*; Base Sepolia has only
///      partial Moonwell test deployments, so for the testnet demo we stand in
///      with this Moonwell-interface-compatible mock. ProofStake only depends on
///      the ERC4626 surface (deposit / redeem / convertToAssets), so swapping
///      this for a real Moonwell 4626 vault on mainnet is a one-line address
///      change. Yield is simulated by `simulateYield`, which donates underlying
///      to the vault and lifts every share's redeemable value.
contract MockMoonwellVault is ERC4626 {
    constructor(IERC20 asset_) ERC20("Mock Moonwell USDC Vault", "mwUSDC") ERC4626(asset_) {}

    /// @notice Donate `amount` of underlying to the vault to simulate accrued
    ///         Moonwell supply interest. Pulls from caller, who must have
    ///         approved this vault.
    function simulateYield(uint256 amount) external {
        IERC20(asset()).transferFrom(msg.sender, address(this), amount);
    }
}
