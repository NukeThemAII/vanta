import { z } from "zod";

export const FOUNDATION_MARKETS = ["BTC", "ETH"] as const;

export type FoundationMarket = (typeof FOUNDATION_MARKETS)[number];

export const FoundationMarketSchema = z.enum(FOUNDATION_MARKETS);

export function deduplicateMarkets(markets: readonly FoundationMarket[]): FoundationMarket[] {
  return [...new Set(markets)];
}
