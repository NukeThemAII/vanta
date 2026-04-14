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
    expect(config.risk.marketDataMaxMidAgeMs).toBe(45_000);
    expect(config.risk.userStateMaxSyncWaitMs).toBe(30_000);
    expect(config.risk.enforceStopLossForEntries).toBe(false);
    expect(config.retention.marketEventsDays).toBe(7);
    expect(config.retention.candleBarsDays).toBe(365);
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
      VANTA_RISK_MARKET_DATA_MAX_MID_AGE_MS: "15000",
      VANTA_RISK_MARKET_DATA_MAX_TRADE_AGE_MS: "60000",
      VANTA_RISK_USER_STATE_MAX_SYNC_WAIT_MS: "12000",
      VANTA_RISK_MAX_LEVERAGE_FRACTION_OF_EXCHANGE_MAX: "0.25",
      VANTA_RISK_DEFAULT_FRACTION_OF_ACCOUNT: "0.01",
      VANTA_RISK_MAX_DAILY_REALIZED_DRAWDOWN_USD: "25",
      VANTA_RISK_MAX_WEEKLY_REALIZED_DRAWDOWN_USD: "80",
      VANTA_RISK_CONSECUTIVE_LOSS_COOLDOWN_COUNT: "4",
      VANTA_RISK_CONSECUTIVE_LOSS_COOLDOWN_MINUTES: "45",
      VANTA_RISK_MAX_ABSOLUTE_FUNDING_RATE: "0.0005",
      VANTA_RISK_MIN_RATE_LIMIT_SURPLUS: "10",
      VANTA_RISK_ENFORCE_STOP_LOSS_FOR_ENTRIES: "true",
      VANTA_RETENTION_MARKET_EVENTS_DAYS: "3",
      VANTA_RETENTION_CANDLE_BARS_DAYS: "180",
      VANTA_RETENTION_RUNTIME_STATE_DAYS: "14",
      VANTA_RETENTION_EXECUTION_AUDIT_DAYS: "120"
    });

    expect(config.risk).toEqual({
      maxOrderNotionalUsd: "1250",
      maxOpenOrders: 12,
      maxConcurrentPositions: 5,
      maxPriceDeviationBps: 90,
      marketDataMaxMidAgeMs: 15_000,
      marketDataMaxTradeAgeMs: 60_000,
      userStateMaxSyncWaitMs: 12_000,
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
    expect(config.retention).toEqual({
      marketEventsDays: 3,
      candleBarsDays: 180,
      runtimeStateDays: 14,
      executionAuditDays: 120
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
