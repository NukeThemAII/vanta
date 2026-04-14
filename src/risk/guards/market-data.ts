import type { MarketDataMarketHealth } from "../../marketdata/health.js";

interface MarketDataFreshnessArgs {
  readonly marketHealth: MarketDataMarketHealth | undefined;
}

interface MarketDataFreshnessOutcome {
  readonly ok: boolean;
  readonly message: string;
}

export function evaluateMarketDataFreshness(args: MarketDataFreshnessArgs): MarketDataFreshnessOutcome {
  if (args.marketHealth === undefined) {
    return {
      ok: false,
      message: "Market-data health is unavailable for the requested market"
    };
  }

  if (args.marketHealth.status !== "healthy") {
    return {
      ok: false,
      message: `Market-data health is degraded for ${args.marketHealth.market}: ${args.marketHealth.issues.join(", ")}`
    };
  }

  return {
    ok: true,
    message: `Market-data health is fresh for ${args.marketHealth.market}`
  };
}
