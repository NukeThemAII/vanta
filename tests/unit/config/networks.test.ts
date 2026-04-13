import { describe, expect, it } from "vitest";

import { NETWORKS, resolveNetworkConfig } from "../../../src/config/networks.js";

describe("resolveNetworkConfig", () => {
  it("returns the testnet configuration", () => {
    const network = resolveNetworkConfig("testnet");

    expect(network).toEqual(NETWORKS.testnet);
    expect(network.apiUrl).toContain("testnet");
    expect(network.wsUrl).toContain("testnet");
    expect(network.signatureChain).toBe("Testnet");
    expect(network.hyperEvmChainId).toBe(998);
  });

  it("returns the mainnet configuration", () => {
    const network = resolveNetworkConfig("mainnet");

    expect(network.apiUrl).toContain("hyperliquid.xyz");
    expect(network.wsUrl).toContain("/ws");
    expect(network.signatureChain).toBe("Mainnet");
    expect(network.hyperEvmChainId).toBe(999);
  });
});
