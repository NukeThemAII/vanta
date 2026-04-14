import type { RecentTradesResponse } from "@nktkas/hyperliquid/api/info";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";

import { CandleStore } from "../../../src/marketdata/candle-store.js";
import { SqliteDatabase } from "../../../src/persistence/db.js";
import { CandleRepository } from "../../../src/persistence/repositories/candle-repository.js";

describe("CandleStore", () => {
  const databases: SqliteDatabase[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) {
      database.close();
    }
  });

  it("aggregates trades across intervals and resumes open buckets from persisted bars", () => {
    const db = trackDatabase(databases);
    const repository = new CandleRepository(db.connection);
    const firstStore = createStore(repository);
    const initialTrades = [
      makeTrade({ time: "2026-04-14T12:00:10.000Z", tid: 1, px: "68000", sz: "0.1" }),
      makeTrade({ time: "2026-04-14T12:00:20.000Z", tid: 2, px: "68100", sz: "0.2" })
    ] satisfies RecentTradesResponse;

    firstStore.ingestTrades({
      market: "BTC",
      trades: initialTrades,
      receivedAt: "2026-04-14T12:00:21.000Z",
      bootId: "boot-1"
    });

    const restartedStore = createStore(repository);
    restartedStore.ingestTrades({
      market: "BTC",
      trades: [makeTrade({ time: "2026-04-14T12:04:05.000Z", tid: 3, px: "67950", sz: "0.05" })],
      receivedAt: "2026-04-14T12:04:06.000Z",
      bootId: "boot-2"
    });

    const fiveMinuteBar = repository.get({
      network: "testnet",
      market: "BTC",
      interval: "5m",
      openTimeMs: Date.parse("2026-04-14T12:00:00.000Z")
    });
    const fifteenMinuteBar = repository.get({
      network: "testnet",
      market: "BTC",
      interval: "15m",
      openTimeMs: Date.parse("2026-04-14T12:00:00.000Z")
    });
    const recentOneMinuteBars = repository.listRecent({
      network: "testnet",
      market: "BTC",
      interval: "1m",
      limit: 5
    });

    expect(recentOneMinuteBars).toHaveLength(2);
    expect(recentOneMinuteBars[0]).toMatchObject({
      openTimeMs: Date.parse("2026-04-14T12:04:00.000Z"),
      openPrice: "67950",
      highPrice: "67950",
      lowPrice: "67950",
      closePrice: "67950",
      baseVolume: "0.05",
      quoteVolume: "3397.5",
      tradeCount: 1
    });
    expect(recentOneMinuteBars[1]).toMatchObject({
      openTimeMs: Date.parse("2026-04-14T12:00:00.000Z"),
      openPrice: "68000",
      highPrice: "68100",
      lowPrice: "68000",
      closePrice: "68100",
      baseVolume: "0.3",
      quoteVolume: "20420",
      tradeCount: 2
    });
    expect(fiveMinuteBar).toMatchObject({
      openPrice: "68000",
      highPrice: "68100",
      lowPrice: "67950",
      closePrice: "67950",
      baseVolume: "0.35",
      quoteVolume: "23817.5",
      tradeCount: 3,
      updatedAt: "2026-04-14T12:04:06.000Z"
    });
    expect(fifteenMinuteBar).toMatchObject({
      openPrice: "68000",
      highPrice: "68100",
      lowPrice: "67950",
      closePrice: "67950",
      baseVolume: "0.35",
      quoteVolume: "23817.5",
      tradeCount: 3
    });
  });

  it("suppresses duplicate trade batches so candle volume is not double-counted", () => {
    const db = trackDatabase(databases);
    const repository = new CandleRepository(db.connection);
    const store = createStore(repository);
    const trades = [
      makeTrade({ time: "2026-04-14T12:00:10.000Z", tid: 1, px: "68000", sz: "0.1" }),
      makeTrade({ time: "2026-04-14T12:00:20.000Z", tid: 2, px: "68100", sz: "0.2" })
    ] satisfies RecentTradesResponse;

    const firstUpdate = store.ingestTrades({
      market: "BTC",
      trades,
      receivedAt: "2026-04-14T12:00:21.000Z"
    });
    const duplicateUpdate = store.ingestTrades({
      market: "BTC",
      trades,
      receivedAt: "2026-04-14T12:00:22.000Z"
    });

    const oneMinuteBar = repository.get({
      network: "testnet",
      market: "BTC",
      interval: "1m",
      openTimeMs: Date.parse("2026-04-14T12:00:00.000Z")
    });

    expect(firstUpdate).toHaveLength(3);
    expect(duplicateUpdate).toEqual([]);
    expect(oneMinuteBar).toMatchObject({
      baseVolume: "0.3",
      quoteVolume: "20420",
      tradeCount: 2,
      updatedAt: "2026-04-14T12:00:21.000Z"
    });
    expect(store.getStats()).toMatchObject({
      cachedBarCount: 3,
      cachedTradeFingerprintCount: 2
    });
  });
});

function createStore(repository: CandleRepository): CandleStore {
  return new CandleStore({
    network: "testnet",
    repository,
    logger: pino({ level: "silent" })
  });
}

function trackDatabase(databases: SqliteDatabase[]): SqliteDatabase {
  const database = new SqliteDatabase(":memory:");
  databases.push(database);
  return database;
}

function makeTrade(args: {
  readonly time: string;
  readonly tid: number;
  readonly px: string;
  readonly sz: string;
}): RecentTradesResponse[number] {
  return {
    coin: "BTC",
    side: "B",
    px: args.px,
    sz: args.sz,
    time: Date.parse(args.time),
    hash: `0x${String(args.tid).padStart(64, "a")}`,
    tid: args.tid,
    users: [
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222"
    ]
  };
}
