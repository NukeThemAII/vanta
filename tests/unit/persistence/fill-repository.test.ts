import { describe, expect, it } from "vitest";

import { SqliteDatabase } from "../../../src/persistence/db.js";
import { FillRepository } from "../../../src/persistence/repositories/fill-repository.js";
import type { FillRecord } from "../../../src/portfolio/fills.js";

describe("FillRepository", () => {
  it("upserts fills and computes realized pnl windows plus consecutive loss streak", () => {
    const db = new SqliteDatabase(":memory:");
    const repository = new FillRepository(db.connection);
    const now = Date.now();

    repository.upsertMany([
      makeFillRecord({
        transactionId: 1,
        marketSymbol: "BTC",
        closedPnl: "-10",
        exchangeTimestampMs: now - 3_000
      }),
      makeFillRecord({
        transactionId: 2,
        marketSymbol: "BTC",
        closedPnl: "-5",
        exchangeTimestampMs: now - 2_000
      }),
      makeFillRecord({
        transactionId: 3,
        marketSymbol: "BTC",
        closedPnl: "7",
        exchangeTimestampMs: now - 1_000
      })
    ]);

    expect(repository.listRecent("0x1111111111111111111111111111111111111111", 2)).toHaveLength(2);
    expect(repository.sumClosedPnlSince("0x1111111111111111111111111111111111111111", now - 10_000)).toBe("-8");
    expect(
      repository.getConsecutiveLossStreak({
        operatorAddress: "0x1111111111111111111111111111111111111111",
        marketSymbol: "BTC",
        limit: 3
      }).count
    ).toBe(0);

    repository.upsert(
      makeFillRecord({
        transactionId: 4,
        marketSymbol: "BTC",
        closedPnl: "-2",
        exchangeTimestampMs: now
      })
    );

    const streak = repository.getConsecutiveLossStreak({
      operatorAddress: "0x1111111111111111111111111111111111111111",
      marketSymbol: "BTC",
      limit: 4
    });

    expect(streak.count).toBe(1);
    expect(streak.lastLossTimestampMs).toBe(now);

    db.close();
  });
});

function makeFillRecord(args: {
  readonly transactionId: number;
  readonly marketSymbol: string;
  readonly closedPnl: string;
  readonly exchangeTimestampMs: number;
}): FillRecord {
  return {
    fillKey: `0x1111111111111111111111111111111111111111:${args.transactionId}`,
    operatorAddress: "0x1111111111111111111111111111111111111111",
    network: "testnet",
    recordedAt: new Date(args.exchangeTimestampMs).toISOString(),
    exchangeTimestampMs: args.exchangeTimestampMs,
    marketSymbol: args.marketSymbol,
    assetId: 0,
    marketType: "perp",
    orderId: args.transactionId,
    transactionId: args.transactionId,
    side: "buy",
    price: "68000",
    size: "0.001",
    startPosition: "0",
    direction: "Close Long",
    closedPnl: args.closedPnl,
    fee: "0.1",
    feeToken: "USDC",
    hash: `0x${String(args.transactionId).padStart(64, "a")}`,
    crossed: false,
    isSnapshot: true
  };
}
