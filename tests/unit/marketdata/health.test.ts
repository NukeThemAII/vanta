import { describe, expect, it } from "vitest";

import { MarketDataHealthMonitor, deriveMarketDataHealth } from "../../../src/marketdata/health.js";

describe("MarketDataHealthMonitor", () => {
  it("marks markets healthy when mid and trade channels are fresh", () => {
    const monitor = new MarketDataHealthMonitor();
    const now = new Date("2026-04-13T16:00:00.000Z");

    monitor.record({
      receivedAt: now.toISOString(),
      exchangeTimestampMs: null,
      market: "BTC",
      channel: "mid",
      payload: {
        market: "BTC",
        midPrice: "68000"
      }
    });
    monitor.record({
      receivedAt: now.toISOString(),
      exchangeTimestampMs: now.getTime(),
      market: "BTC",
      channel: "trade",
      payload: {
        market: "BTC",
        tradeCount: 1
      }
    });

    const snapshot = monitor.getSnapshot(
      ["BTC"],
      {
        maxMidAgeMs: 45_000,
        maxTradeAgeMs: 180_000
      },
      now
    );

    expect(snapshot.status).toBe("healthy");
    expect(snapshot.markets[0]?.status).toBe("healthy");
  });

  it("marks markets degraded when a required channel is missing or stale", () => {
    const now = new Date("2026-04-13T16:00:00.000Z");
    const snapshot = deriveMarketDataHealth({
      markets: ["BTC"],
      latestTimes: {
        BTC: {
          mid: {
            receivedAt: "2026-04-13T15:58:00.000Z",
            exchangeTimestampMs: null
          }
        }
      },
      thresholds: {
        maxMidAgeMs: 30_000,
        maxTradeAgeMs: 60_000
      },
      now
    });

    expect(snapshot.status).toBe("degraded");
    expect(snapshot.markets[0]?.issues).toEqual(["mid_stale", "trade_missing"]);
  });
});
