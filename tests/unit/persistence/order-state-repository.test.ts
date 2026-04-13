import { describe, expect, it } from "vitest";

import { SqliteDatabase } from "../../../src/persistence/db.js";
import { OrderStateRepository } from "../../../src/persistence/repositories/order-state-repository.js";

describe("OrderStateRepository", () => {
  it("lists only non-terminal active orders for the requested operator", () => {
    const database = new SqliteDatabase(":memory:");
    const repository = new OrderStateRepository(database.connection);

    repository.upsertState({
      orderKey: "cloid:active-1",
      operatorAddress: "0x1111111111111111111111111111111111111111",
      marketSymbol: "BTC",
      assetId: 0,
      marketType: "perp",
      state: "resting",
      side: "buy",
      clientOrderId: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      limitPrice: "100",
      originalSize: "0.1",
      filledSize: "0",
      lastSource: "exchange_ack",
      updatedAt: "2026-04-13T10:00:00.000Z"
    });
    repository.upsertState({
      orderKey: "cloid:done-1",
      operatorAddress: "0x1111111111111111111111111111111111111111",
      marketSymbol: "ETH",
      assetId: 1,
      marketType: "perp",
      state: "filled",
      side: "sell",
      clientOrderId: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      limitPrice: "200",
      originalSize: "0.2",
      filledSize: "0.2",
      lastSource: "user_fill",
      updatedAt: "2026-04-13T10:01:00.000Z"
    });
    repository.upsertState({
      orderKey: "cloid:other-operator",
      operatorAddress: "0x2222222222222222222222222222222222222222",
      marketSymbol: "SOL",
      assetId: 2,
      marketType: "perp",
      state: "resting",
      side: "buy",
      clientOrderId: "0xcccccccccccccccccccccccccccccccc",
      limitPrice: "50",
      originalSize: "1",
      filledSize: "0",
      lastSource: "exchange_ack",
      updatedAt: "2026-04-13T10:02:00.000Z"
    });

    const active = repository.listActiveOrders("0x1111111111111111111111111111111111111111");

    expect(active).toHaveLength(1);
    expect(active[0]?.marketSymbol).toBe("BTC");
    expect(active[0]?.state).toBe("resting");

    database.close();
  });
});
