import type { AllMidsEvent, TradesEvent } from "@nktkas/hyperliquid/api/subscription";

import type { FoundationMarket } from "../config/markets.js";
import type { NormalizedMarketEvent } from "../core/types.js";

export function normalizeAllMidsEvent(
  event: AllMidsEvent,
  markets: readonly FoundationMarket[],
  receivedAt = new Date()
): NormalizedMarketEvent[] {
  const recordedAt = receivedAt.toISOString();

  return markets.flatMap((market) => {
    const midPrice = event.mids[market];

    if (midPrice === undefined) {
      return [];
    }

    return [
      {
        receivedAt: recordedAt,
        exchangeTimestampMs: null,
        market,
        channel: "mid",
        payload: {
          market,
          midPrice,
          dex: event.dex ?? null
        }
      }
    ];
  });
}

export function normalizeTradesEvent(
  market: FoundationMarket,
  trades: TradesEvent,
  receivedAt = new Date()
): NormalizedMarketEvent {
  return {
    receivedAt: receivedAt.toISOString(),
    exchangeTimestampMs: trades.at(-1)?.time ?? null,
    market,
    channel: "trade",
    payload: {
      market,
      tradeCount: trades.length,
      trades
    }
  };
}
