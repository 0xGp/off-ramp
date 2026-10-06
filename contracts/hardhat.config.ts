import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

// Secrets are resolved through `npx hardhat keystore set <NAME>` (encrypted) or
// environment variables. Never commit them.
export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      // One bytecode for Arc (Osaka baseline) and Base; cancun avoids newer opcodes.
      default: {
        version: "0.8.34",
        settings: { evmVersion: "cancun" },
      },
      production: {
        version: "0.8.34",
        settings: {
          evmVersion: "cancun",
          optimizer: { enabled: true, runs: 200 },
        },
      },
    },
  },
  networks: {
    arcMainnet: {
      type: "http",
      chainType: "generic",
      chainId: 5042,
      url: configVariable("ARC_MAINNET_RPC_URL"),
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
    },
    arcTestnet: {
      type: "http",
      chainType: "generic",
      chainId: 5042002,
      url: configVariable("ARC_TESTNET_RPC_URL"),
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
    },
    baseSepolia: {
      type: "http",
      chainType: "op",
      chainId: 84532,
      url: configVariable("BASE_SEPOLIA_RPC_URL"),
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
    },
  },
});
