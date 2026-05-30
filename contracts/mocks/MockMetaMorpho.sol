// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Minimal MetaMorpho-shaped ERC4626 USDC vault for deterministic tests.
/// @dev Real MetaMorpho vaults are ERC4626. ProofStake only depends on the
///      ERC4626 surface (deposit / redeem / convertToAssets), so this mock is a
///      faithful stand-in. Yield is simulated by `simulateYield`, which donates
///      underlying to the vault and lifts every share's redeemable value.
contract MockMetaMorpho is ERC4626 {
    constructor(IERC20 asset_) ERC20("Mock MetaMorpho USDC", "mmUSDC") ERC4626(asset_) {}

    /// @notice Donate `amount` of underlying to the vault to simulate accrued
    ///         interest. Pulls from caller, who must have approved this vault.
    function simulateYield(uint256 amount) external {
        IERC20(asset()).transferFrom(msg.sender, address(this), amount);
    }
}
