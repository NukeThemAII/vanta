import {
  MAINNET_API_URL,
  MAINNET_API_WS_URL,
  MAINNET_RPC_URL,
  MAINNET_RPC_WS_URL,
  TESTNET_API_URL,
  TESTNET_API_WS_URL,
  TESTNET_RPC_URL,
  TESTNET_RPC_WS_URL
} from "@nktkas/hyperliquid";

import type { NetworkConfig, NetworkName } from "../core/types.js";

export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  mainnet: {
    name: "mainnet",
    isTestnet: false,
    apiUrl: MAINNET_API_URL,
    wsUrl: MAINNET_API_WS_URL,
    rpcUrl: MAINNET_RPC_URL,
    rpcWsUrl: MAINNET_RPC_WS_URL,
    signatureChain: "Mainnet",
    signatureChainId: "0xa4b1",
    hyperEvmChainId: 999
  },
  testnet: {
    name: "testnet",
    isTestnet: true,
    apiUrl: TESTNET_API_URL,
    wsUrl: TESTNET_API_WS_URL,
    rpcUrl: TESTNET_RPC_URL,
    rpcWsUrl: TESTNET_RPC_WS_URL,
    signatureChain: "Testnet",
    signatureChainId: "0x66eee",
    hyperEvmChainId: 998
  }
};

export function resolveNetworkConfig(networkName: NetworkName): NetworkConfig {
  return NETWORKS[networkName];
}
