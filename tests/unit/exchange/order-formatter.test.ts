import { formatPrice, formatSize } from "@nktkas/hyperliquid/utils";
import { describe, expect, it } from "vitest";

import { normalizeDecimalString } from "../../../src/core/decimal.js";
import { CloidService } from "../../../src/exchange/cloid-service.js";
import { HyperliquidOrderFormatter } from "../../../src/exchange/order-formatter.js";
import { makeTestRegistry } from "../../fixtures/hyperliquid-fixtures.js";

describe("HyperliquidOrderFormatter", () => {
  it("normalizes place-order requests through the centralized registry and precision rules", () => {
    const registry = makeTestRegistry();
    const cloidService = new CloidService();
    const formatter = new HyperliquidOrderFormatter(() => registry, cloidService);

    const result = formatter.formatPlaceOrder({
      marketSymbol: "btc",
      side: "buy",
      price: "123.4567",
      size: "0.12349",
      timeInForce: "Alo",
      correlationId: "corr-1"
    });

    expect(result.correlationId).toBe("corr-1");
    expect(result.order.assetId).toBe(0);
    expect(result.order.marketType).toBe("perp");
    expect(result.order.price).toBe(formatPrice("123.4567", 3, "perp"));
    expect(result.order.size).toBe(formatSize("0.12349", 3));
    expect(result.order.orderType).toEqual({
      kind: "limit",
      timeInForce: "Alo"
    });
    expect(result.order.clientOrderId).toBe(
      cloidService.createDeterministic({
        marketSymbol: "BTC",
        side: "buy",
        price: normalizeDecimalString("123.4567"),
        size: normalizeDecimalString("0.12349"),
        grouping: "na"
      })
    );
  });

  it("retains normalized cloids on modify requests and rejects spot leverage updates", () => {
    const registry = makeTestRegistry();
    const formatter = new HyperliquidOrderFormatter(() => registry, new CloidService());
    const cloid = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    const result = formatter.formatModifyOrder({
      target: {
        marketSymbol: "BTC",
        clientOrderId: cloid
      },
      next: {
        marketSymbol: "BTC",
        side: "sell",
        price: "124.5",
        size: "0.2",
        timeInForce: "Alo"
      }
    });

    expect(result.modify.target).toEqual({
      marketSymbol: "BTC",
      clientOrderId: cloid
    });
    expect(result.modify.order.clientOrderId).toBe(cloid);
    expect(() =>
      formatter.formatUpdateLeverage({
        marketSymbol: "PURR/USDC",
        leverage: 2,
        isCross: true
      })
    ).toThrow("Unknown perp asset symbol");
  });
});
