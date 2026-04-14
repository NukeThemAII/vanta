import type { RecentTradesResponse } from "@nktkas/hyperliquid/api/info";
import type { Logger } from "pino";

import type { FoundationMarket } from "../config/markets.js";
import {
  addDecimalStrings,
  compareDecimalStrings,
  multiplyDecimalStrings,
  normalizeDecimalString
} from "../core/decimal.js";
import type { NetworkName } from "../core/types.js";
import type { CandleRepository } from "../persistence/repositories/candle-repository.js";

export const SUPPORTED_CANDLE_INTERVALS = ["1m", "5m", "15m"] as const;

export type CandleInterval = (typeof SUPPORTED_CANDLE_INTERVALS)[number];

export interface CandleBar {
  readonly network: NetworkName;
  readonly market: FoundationMarket;
  readonly interval: CandleInterval;
  readonly openTimeMs: number;
  readonly closeTimeMs: number;
  readonly openPrice: string;
  readonly highPrice: string;
  readonly lowPrice: string;
  readonly closePrice: string;
  readonly baseVolume: string;
  readonly quoteVolume: string;
  readonly tradeCount: number;
  readonly firstTradeTimeMs: number;
  readonly lastTradeTimeMs: number;
  readonly updatedAt: string;
}

interface CandleStoreOptions {
  readonly network: NetworkName;
  readonly repository: CandleRepository;
  readonly logger: Logger;
  readonly intervals?: readonly CandleInterval[];
}

const INTERVAL_MS: Record<CandleInterval, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000
};

const CACHE_EVICTION_WINDOW_MS = 24 * 60 * 60 * 1000;

export class CandleStore {
  private readonly bars = new Map<string, CandleBar>();
  private readonly seenTrades = new Map<string, number>();
  private readonly intervals: readonly CandleInterval[];

  constructor(private readonly options: CandleStoreOptions) {
    this.intervals = options.intervals ?? SUPPORTED_CANDLE_INTERVALS;
  }

  ingestTrades(args: {
    readonly market: FoundationMarket;
    readonly trades: RecentTradesResponse;
    readonly receivedAt?: string;
    readonly bootId?: string;
  }): readonly CandleBar[] {
    if (args.trades.length === 0) {
      return [];
    }

    const receivedAt = args.receivedAt ?? new Date().toISOString();
    const orderedTrades = [...args.trades].sort((left, right) => left.time - right.time || left.tid - right.tid);
    const freshTrades = orderedTrades.filter((trade) => {
      const tradeKey = toTradeKey(args.market, trade);

      if (this.seenTrades.has(tradeKey)) {
        return false;
      }

      this.seenTrades.set(tradeKey, trade.time);
      return true;
    });

    if (freshTrades.length === 0) {
      this.evictOldEntries(orderedTrades.at(-1)?.time ?? Date.now());
      this.options.logger.debug(
        {
          market: args.market,
          tradeCount: orderedTrades.length,
          duplicateTradeCount: orderedTrades.length
        },
        "Skipped duplicate trade batch for candle recording"
      );
      return [];
    }

    const updatedBars: CandleBar[] = [];

    for (const interval of this.intervals) {
      const intervalUpdates = new Map<number, CandleBar>();

      for (const trade of freshTrades) {
        const openTimeMs = toBucketStartMs(trade.time, interval);
        const key = toBarKey(this.options.network, args.market, interval, openTimeMs);
        const current =
          intervalUpdates.get(openTimeMs)
          ?? this.bars.get(key)
          ?? this.options.repository.get({
            network: this.options.network,
            market: args.market,
            interval,
            openTimeMs
          });

        const next = current === undefined
          ? createCandleBar({
              network: this.options.network,
              market: args.market,
              interval,
              trade,
              updatedAt: receivedAt
            })
          : applyTradeToBar(current, trade, receivedAt);

        intervalUpdates.set(openTimeMs, next);
        this.bars.set(key, next);
      }

      updatedBars.push(...intervalUpdates.values());
    }

    this.options.repository.upsertMany(updatedBars, args.bootId);
    this.evictOldEntries(freshTrades.at(-1)?.time ?? Date.now());

    this.options.logger.debug(
      {
        market: args.market,
        tradeCount: freshTrades.length,
        duplicateTradeCount: orderedTrades.length - freshTrades.length,
        updatedBarCount: updatedBars.length
      },
      "Recorded candle bars from trade batch"
    );

    return updatedBars;
  }

  getStats(): {
    readonly cachedBarCount: number;
    readonly cachedTradeFingerprintCount: number;
    readonly intervals: readonly CandleInterval[];
  } {
    return {
      cachedBarCount: this.bars.size,
      cachedTradeFingerprintCount: this.seenTrades.size,
      intervals: [...this.intervals]
    };
  }

  private evictOldEntries(referenceTimeMs: number): void {
    const threshold = referenceTimeMs - CACHE_EVICTION_WINDOW_MS;

    for (const [key, bar] of this.bars.entries()) {
      if (bar.openTimeMs < threshold) {
        this.bars.delete(key);
      }
    }

    for (const [key, tradeTimeMs] of this.seenTrades.entries()) {
      if (tradeTimeMs < threshold) {
        this.seenTrades.delete(key);
      }
    }
  }
}

function createCandleBar(args: {
  readonly network: NetworkName;
  readonly market: FoundationMarket;
  readonly interval: CandleInterval;
  readonly trade: RecentTradesResponse[number];
  readonly updatedAt: string;
}): CandleBar {
  const price = normalizeDecimalString(args.trade.px);
  const size = normalizeDecimalString(args.trade.sz);

  return {
    network: args.network,
    market: args.market,
    interval: args.interval,
    openTimeMs: toBucketStartMs(args.trade.time, args.interval),
    closeTimeMs: toBucketEndMs(args.trade.time, args.interval),
    openPrice: price,
    highPrice: price,
    lowPrice: price,
    closePrice: price,
    baseVolume: size,
    quoteVolume: multiplyDecimalStrings(price, size),
    tradeCount: 1,
    firstTradeTimeMs: args.trade.time,
    lastTradeTimeMs: args.trade.time,
    updatedAt: args.updatedAt
  };
}

function applyTradeToBar(
  bar: CandleBar,
  trade: RecentTradesResponse[number],
  updatedAt: string
): CandleBar {
  const price = normalizeDecimalString(trade.px);
  const size = normalizeDecimalString(trade.sz);

  const isEarlierTrade = trade.time < bar.firstTradeTimeMs;
  const isLaterTrade = trade.time >= bar.lastTradeTimeMs;

  return {
    ...bar,
    openPrice: isEarlierTrade ? price : bar.openPrice,
    highPrice: compareDecimalStrings(price, bar.highPrice) === 1 ? price : bar.highPrice,
    lowPrice: compareDecimalStrings(price, bar.lowPrice) === -1 ? price : bar.lowPrice,
    closePrice: isLaterTrade ? price : bar.closePrice,
    baseVolume: addDecimalStrings(bar.baseVolume, size),
    quoteVolume: addDecimalStrings(bar.quoteVolume, multiplyDecimalStrings(price, size)),
    tradeCount: bar.tradeCount + 1,
    firstTradeTimeMs: Math.min(bar.firstTradeTimeMs, trade.time),
    lastTradeTimeMs: Math.max(bar.lastTradeTimeMs, trade.time),
    updatedAt
  };
}

function toBucketStartMs(timestampMs: number, interval: CandleInterval): number {
  const intervalMs = INTERVAL_MS[interval];
  return Math.floor(timestampMs / intervalMs) * intervalMs;
}

function toBucketEndMs(timestampMs: number, interval: CandleInterval): number {
  return toBucketStartMs(timestampMs, interval) + INTERVAL_MS[interval] - 1;
}

function toBarKey(
  network: NetworkName,
  market: FoundationMarket,
  interval: CandleInterval,
  openTimeMs: number
): string {
  return `${network}:${market}:${interval}:${openTimeMs}`;
}

function toTradeKey(
  market: FoundationMarket,
  trade: RecentTradesResponse[number]
): string {
  return `${market}:${trade.time}:${trade.tid}`;
}
