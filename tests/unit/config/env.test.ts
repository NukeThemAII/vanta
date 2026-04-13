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
    expect(config.risk.maxOrderNotionalUsd).toBe("500");
    expect(config.risk.maxDailyRealizedDrawdownUsd).toBe("50");
    expect(config.risk.enforceStopLossForEntries).toBe(false);
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

  it("parses configurable risk settings", () => {
    const config = parseAppConfig({
      VANTA_OPERATOR_ADDRESS: "0x1111111111111111111111111111111111111111",
      VANTA_RISK_MAX_ORDER_NOTIONAL_USD: "1250",
      VANTA_RISK_MAX_OPEN_ORDERS: "12",
      VANTA_RISK_MAX_CONCURRENT_POSITIONS: "5",
      VANTA_RISK_MAX_PRICE_DEVIATION_BPS: "90",
      VANTA_RISK_MAX_LEVERAGE_FRACTION_OF_EXCHANGE_MAX: "0.25",
      VANTA_RISK_DEFAULT_FRACTION_OF_ACCOUNT: "0.01",
      VANTA_RISK_MAX_DAILY_REALIZED_DRAWDOWN_USD: "25",
      VANTA_RISK_MAX_WEEKLY_REALIZED_DRAWDOWN_USD: "80",
      VANTA_RISK_CONSECUTIVE_LOSS_COOLDOWN_COUNT: "4",
      VANTA_RISK_CONSECUTIVE_LOSS_COOLDOWN_MINUTES: "45",
      VANTA_RISK_MAX_ABSOLUTE_FUNDING_RATE: "0.0005",
      VANTA_RISK_MIN_RATE_LIMIT_SURPLUS: "10",
      VANTA_RISK_ENFORCE_STOP_LOSS_FOR_ENTRIES: "true"
    });

    expect(config.risk).toEqual({
      maxOrderNotionalUsd: "1250",
      maxOpenOrders: 12,
      maxConcurrentPositions: 5,
      maxPriceDeviationBps: 90,
      maxLeverageFractionOfExchangeMax: 0.25,
      defaultRiskFractionOfAccount: "0.01",
      maxDailyRealizedDrawdownUsd: "25",
      maxWeeklyRealizedDrawdownUsd: "80",
      consecutiveLossCooldownCount: 4,
      consecutiveLossCooldownMinutes: 45,
      maxAbsoluteFundingRate: "0.0005",
      minRateLimitSurplus: 10,
      enforceStopLossForEntries: true
    });
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
