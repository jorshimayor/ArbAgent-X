import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const {
  BASE_SEPOLIA_RPC = "https://sepolia.base.org",
  DEPLOYER_PRIVATE_KEY = "",
  BASESCAN_API_KEY = "",
} = process.env;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {},
    baseSepolia: {
      url: BASE_SEPOLIA_RPC,
      chainId: 84532,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
  },
  // hardhat-verify 2.1.x has Base Sepolia (84532) built in and talks to the
  // Etherscan API V2 unified endpoint, so a single apiKey string is all it needs.
  // (The old V1 https://api-sepolia.basescan.org/api endpoint is deprecated.)
  etherscan: {
    apiKey: BASESCAN_API_KEY,
  },
};

export default config;
