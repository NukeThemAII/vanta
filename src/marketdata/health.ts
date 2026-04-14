import type { FoundationMarket } from "../config/markets.js";
import type { MarketEventChannel, NormalizedMarketEvent } from "../core/types.js";

export type MarketDataChannelHealthStatus = "healthy" | "stale" | "missing";
export type MarketDataHealthStatus = "healthy" | "degraded";

export interface MarketDataHealthThresholds {
  readonly maxMidAgeMs: number;
  readonly maxTradeAgeMs: number;
}

export interface MarketDataChannelTiming {
  readonly receivedAt: string;
  readonly exchangeTimestampMs: number | null;
}

export interface MarketDataChannelHealth {
  readonly status: MarketDataChannelHealthStatus;
  readonly receivedAt: string | null;
  readonly exchangeTimestampMs: number | null;
  readonly ageMs: number | null;
}

export interface MarketDataMarketHealth {
  readonly market: FoundationMarket;
  readonly status: MarketDataChannelHealthStatus | "degraded";
  readonly issues: readonly string[];
  readonly channels: {
    readonly mid: MarketDataChannelHealth;
    readonly trade: MarketDataChannelHealth;
  };
}

export interface MarketDataHealthSnapshot {
  readonly checkedAt: string;
  readonly status: MarketDataHealthStatus;
  readonly thresholds: MarketDataHealthThresholds;
  readonly markets: readonly MarketDataMarketHealth[];
}

export type LatestMarketEventTimes = Partial<
  Record<FoundationMarket, Partial<Record<MarketEventChannel, MarketDataChannelTiming>>>
>;

export class MarketDataHealthMonitor {
  private readonly latestTimes = new Map<FoundationMarket, Map<MarketEventChannel, MarketDataChannelTiming>>();

  record(event: NormalizedMarketEvent): void {
    const perMarket = this.latestTimes.get(event.market) ?? new Map<MarketEventChannel, MarketDataChannelTiming>();

    perMarket.set(event.channel, {
      receivedAt: event.receivedAt,
      exchangeTimestampMs: event.exchangeTimestampMs
    });

    this.latestTimes.set(event.market, perMarket);
  }

  getLatestTimes(): LatestMarketEventTimes {
    const result: LatestMarketEventTimes = {};

    for (const [market, channels] of this.latestTimes.entries()) {
      result[market] = {};

      for (const [channel, timing] of channels.entries()) {
        result[market]![channel] = timing;
      }
    }

    return result;
  }

  getSnapshot(
    markets: readonly FoundationMarket[],
    thresholds: MarketDataHealthThresholds,
    now = new Date()
  ): MarketDataHealthSnapshot {
    return deriveMarketDataHealth({
      markets,
      latestTimes: this.getLatestTimes(),
      thresholds,
      now
    });
  }
}

export function deriveMarketDataHealth(args: {
  readonly markets: readonly FoundationMarket[];
  readonly latestTimes: LatestMarketEventTimes;
  readonly thresholds: MarketDataHealthThresholds;
  readonly now?: Date;
}): MarketDataHealthSnapshot {
  const now = args.now ?? new Date();
  const checkedAt = now.toISOString();
  const nowMs = now.getTime();
  let degraded = false;

  const markets = args.markets.map((market) => {
    const timings = args.latestTimes[market];
    const mid = buildChannelHealth(timings?.mid, args.thresholds.maxMidAgeMs, nowMs);
    const trade = buildChannelHealth(timings?.trade, args.thresholds.maxTradeAgeMs, nowMs);
    const issues = [
      ...(mid.status === "healthy" ? [] : [`mid_${mid.status}`]),
      ...(trade.status === "healthy" ? [] : [`trade_${trade.status}`])
    ];

    if (issues.length > 0) {
      degraded = true;
    }

    return {
      market,
      status: issues.length === 0 ? "healthy" : "degraded",
      issues,
      channels: {
        mid,
        trade
      }
    } satisfies MarketDataMarketHealth;
  });

  return {
    checkedAt,
    status: degraded ? "degraded" : "healthy",
    thresholds: args.thresholds,
    markets
  };
}

function buildChannelHealth(
  timing: MarketDataChannelTiming | undefined,
  maxAgeMs: number,
  nowMs: number
): MarketDataChannelHealth {
  if (timing === undefined) {
    return {
      status: "missing",
      receivedAt: null,
      exchangeTimestampMs: null,
      ageMs: null
    };
  }

  const receivedAtMs = Date.parse(timing.receivedAt);
  const ageMs = Number.isNaN(receivedAtMs) ? null : Math.max(0, nowMs - receivedAtMs);

  return {
    status: ageMs !== null && ageMs <= maxAgeMs ? "healthy" : "stale",
    receivedAt: timing.receivedAt,
    exchangeTimestampMs: timing.exchangeTimestampMs,
    ageMs
  };
}
