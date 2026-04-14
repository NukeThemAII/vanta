import { FOUNDATION_MARKETS, type FoundationMarket } from "../config/markets.js";
import { bootstrapFoundationApp } from "../app/bootstrap.js";
import { ConfigurationError } from "../core/errors.js";
import { installRuntimePolyfills } from "../core/runtime.js";
import {
  SUPPORTED_CANDLE_INTERVALS,
  type CandleInterval
} from "../marketdata/candle-store.js";

async function main(): Promise<void> {
  let app: ReturnType<typeof bootstrapFoundationApp> | undefined;

  try {
    installRuntimePolyfills();
    const args = parseArgs(process.argv.slice(2));
    app = bootstrapFoundationApp();

    const candles = app.candleRepository.listRecent({
      network: app.config.network.name,
      market: args.market,
      interval: args.interval,
      limit: args.limit
    });

    console.log(
      JSON.stringify(
        {
          network: app.config.network.name,
          market: args.market,
          interval: args.interval,
          candleCount: candles.length,
          candles
        },
        null,
        2
      )
    );
  } catch (error) {
    const failure = error instanceof Error ? error : new Error("Unknown candle-state inspection failure");

    if (app !== undefined) {
      app.logger.error({ err: failure }, "Show-candles CLI failed");
    } else {
      console.error(failure);
    }

    process.exitCode = failure instanceof ConfigurationError ? 1 : 1;
  } finally {
    if (app !== undefined) {
      await app.exchangeClient.close();
      app.database.close();
    }
  }
}

await main();

function parseArgs(argv: readonly string[]): {
  readonly market: FoundationMarket;
  readonly interval: CandleInterval;
  readonly limit: number;
} {
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--") {
      continue;
    }

    if (!arg?.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new ConfigurationError(`Missing value for --${key}`);
    }

    values.set(key, value);
    index += 1;
  }

  const market = (values.get("market") ?? "BTC").toUpperCase();
  const interval = (values.get("interval") ?? "1m") as CandleInterval;
  const limit = Number(values.get("limit") ?? "20");

  if (!FOUNDATION_MARKETS.includes(market as FoundationMarket)) {
    throw new ConfigurationError(`Unsupported market ${market}. Expected one of ${FOUNDATION_MARKETS.join(", ")}.`);
  }

  if (!SUPPORTED_CANDLE_INTERVALS.includes(interval)) {
    throw new ConfigurationError(`Unsupported interval ${interval}. Expected one of ${SUPPORTED_CANDLE_INTERVALS.join(", ")}.`);
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new ConfigurationError("Candle limit must be a positive integer");
  }

  return {
    market: market as FoundationMarket,
    interval,
    limit
  };
}
