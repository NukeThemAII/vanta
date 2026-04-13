import { describe, expect, it } from "vitest";

import { CloidService } from "../../../src/exchange/cloid-service.js";

describe("CloidService", () => {
  it("creates deterministic Hyperliquid-safe cloids from stable context", () => {
    const service = new CloidService();
    const context = {
      marketSymbol: "BTC",
      side: "buy",
      price: "123.45",
      size: "0.01"
    } as const;

    expect(service.createDeterministic(context)).toBe(service.createDeterministic(context));
  });

  it("normalizes valid cloids and rejects invalid client ids", () => {
    const service = new CloidService();

    expect(service.normalize("0xAABBCCDDEEFF00112233445566778899")).toBe(
      "0xaabbccddeeff00112233445566778899"
    );
    expect(() => service.normalize("order-btc-1")).toThrow("16-byte 0x-prefixed hex");
  });
});
