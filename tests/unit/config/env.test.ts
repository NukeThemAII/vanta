import { describe, expect, it } from "vitest";

import { parseAppConfig } from "../../../src/config/env.js";

describe("parseAppConfig", () => {
  it("loads defaults and testnet network metadata", () => {
    const config = parseAppConfig({
      VANTA_OPERATOR_ADDRESS: "0x1111111111111111111111111111111111111111"
    });

    expect(config.appEnv).toBe("development");
    expect(config.network.name).toBe("testnet");
    expect(config.network.isTestnet).toBe(true);
    expect(config.network.wsUrl).toContain("testnet");
    expect(config.watchedMarkets).toEqual(["BTC", "ETH"]);
  });

  it("normalizes CSV market input and optional api wallet config", () => {
    const config = parseAppConfig({
      VANTA_NETWORK: "mainnet",
      VANTA_MARKETS: "eth,btc,ETH",
      VANTA_OPERATOR_ADDRESS: "0x1111111111111111111111111111111111111111",
      VANTA_API_WALLET_PRIVATE_KEY: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    });

    expect(config.network.name).toBe("mainnet");
    expect(config.watchedMarkets).toEqual(["ETH", "BTC"]);
    expect(config.apiWallet?.privateKey).toBe(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );
  });

  it("rejects unsupported watched markets", () => {
    expect(() =>
      parseAppConfig({
        VANTA_MARKETS: "BTC,SOL",
        VANTA_OPERATOR_ADDRESS: "0x1111111111111111111111111111111111111111"
      })
    ).toThrowError(/Invalid environment configuration/);
  });
});
