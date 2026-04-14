import { describe, expect, it } from "vitest";

import { SqliteDatabase } from "../../../src/persistence/db.js";
import { UserEventRepository } from "../../../src/persistence/repositories/user-event-repository.js";

describe("UserEventRepository", () => {
  it("returns latest received times grouped by user event type", () => {
    const db = new SqliteDatabase(":memory:");
    const repository = new UserEventRepository(db.connection);

    repository.insert({
      receivedAt: "2026-04-13T16:00:01.000Z",
      operatorAddress: "0x1111111111111111111111111111111111111111",
      eventType: "open_orders_snapshot",
      isSnapshot: true,
      payload: {}
    });
    repository.insert({
      receivedAt: "2026-04-13T16:00:03.000Z",
      operatorAddress: "0x1111111111111111111111111111111111111111",
      eventType: "open_orders_snapshot",
      isSnapshot: true,
      payload: {}
    });
    repository.insert({
      receivedAt: "2026-04-13T16:00:02.000Z",
      operatorAddress: "0x1111111111111111111111111111111111111111",
      eventType: "perp_account_snapshot",
      isSnapshot: true,
      payload: {}
    });

    const latestTimes = repository.getLatestTimes("0x1111111111111111111111111111111111111111");

    expect(latestTimes).toEqual({
      open_orders_snapshot: "2026-04-13T16:00:03.000Z",
      perp_account_snapshot: "2026-04-13T16:00:02.000Z"
    });

    db.close();
  });
});
