import { describe, expect, it } from "vitest";

import { UserStateHealthMonitor } from "../../../src/exchange/user-state-health.js";

describe("UserStateHealthMonitor", () => {
  it("starts in awaiting state until required snapshots arrive", () => {
    const monitor = new UserStateHealthMonitor();

    monitor.beginCycle("startup", "2026-04-13T16:00:00.000Z");

    const snapshot = monitor.getSnapshot(30_000, new Date("2026-04-13T16:00:05.000Z"));

    expect(snapshot.status).toBe("awaiting");
    expect(snapshot.channels.filter((channel) => channel.required && channel.status === "awaiting")).toHaveLength(3);
  });

  it("becomes healthy when all required channels arrive within the cycle", () => {
    const monitor = new UserStateHealthMonitor();

    monitor.beginCycle("startup", "2026-04-13T16:00:00.000Z");
    monitor.record("clearinghouseState", "2026-04-13T16:00:01.000Z");
    monitor.record("spotState", "2026-04-13T16:00:02.000Z");
    monitor.record("openOrders", "2026-04-13T16:00:03.000Z");

    const snapshot = monitor.getSnapshot(30_000, new Date("2026-04-13T16:00:04.000Z"));

    expect(snapshot.status).toBe("healthy");
    expect(snapshot.channels.filter((channel) => channel.required && channel.status === "received")).toHaveLength(3);
  });

  it("degrades when a required channel is still missing after the sync deadline", () => {
    const monitor = new UserStateHealthMonitor();

    monitor.beginCycle("transport_reconnect_pending", "2026-04-13T16:00:00.000Z");
    monitor.record("clearinghouseState", "2026-04-13T16:00:01.000Z");
    monitor.record("spotState", "2026-04-13T16:00:02.000Z");

    const snapshot = monitor.getSnapshot(30_000, new Date("2026-04-13T16:00:31.000Z"));

    expect(snapshot.status).toBe("degraded");
    expect(snapshot.channels.find((channel) => channel.channel === "openOrders")?.status).toBe("missing");
  });
});
