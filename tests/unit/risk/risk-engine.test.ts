import pino from "pino";
import { describe, expect, it } from "vitest";

import { DEFAULT_RISK_CONFIG } from "../../../src/config/risk.js";
import { resolveNetworkConfig } from "../../../src/config/networks.js";
import { RiskCheckError } from "../../../src/core/errors.js";
import type { AppConfig } from "../../../src/core/types.js";
import { CloidService } from "../../../src/exchange/cloid-service.js";
import type { ExecutionIdentity, OrderStateRecord } from "../../../src/exchange/execution-types.js";
import { HyperliquidOrderFormatter } from "../../../src/exchange/order-formatter.js";
import { SignerRegistry } from "../../../src/exchange/signer-registry.js";
import { SqliteDatabase } from "../../../src/persistence/db.js";
import { OrderStateRepository } from "../../../src/persistence/repositories/order-state-repository.js";
import { RiskEventRepository } from "../../../src/persistence/repositories/risk-event-repository.js";
import type { AccountMirrorSnapshot } from "../../../src/portfolio/account-mirror.js";
import { makeTestRegistry } from "../../fixtures/hyperliquid-fixtures.js";
import { RiskEngine } from "../../../src/risk/risk-engine.js";
import { RuntimeStateRepository } from "../../../src/persistence/repositories/runtime-state-repository.js";
import { RuntimeTrustController } from "../../../src/services/runtime-trust-controller.js";

describe("RiskEngine", () => {
  it("rejects new write-side exposure when the mirrored account state is stale", () => {
    const fixture = buildFixture({
      accountSnapshot: makeAccountSnapshot({ staleness: "stale" })
    });

    const place = fixture.formatter.formatPlaceOrder({
      marketSymbol: "BTC",
      side: "buy",
      price: "68000",
      size: "0.001",
      timeInForce: "Alo"
    });

    expect(() =>
      fixture.riskEngine.evaluatePlaceOrder({
        identity: fixture.identity,
        request: {
          marketSymbol: "BTC",
          side: "buy",
          price: "68000",
          size: "0.001",
          timeInForce: "Alo"
        },
        order: place.order,
        correlationId: place.correlationId
      })
    ).toThrow(RiskCheckError);
    expect(fixture.riskEvents.listRecent(1)[0]?.decision).toBe("rejected");

    fixture.db.close();
  });

  it("caps entry size when stop-based sizing is enabled in cap mode", () => {
    const fixture = buildFixture();

    const request = {
      marketSymbol: "BTC",
      side: "buy" as const,
      price: "68000",
      size: "0.01",
      timeInForce: "Alo" as const,
      risk: {
        stopLossPrice: "67000",
        sizingMode: "cap" as const
      }
    };
    const place = fixture.formatter.formatPlaceOrder(request);
    const approved = fixture.riskEngine.evaluatePlaceOrder({
      identity: fixture.identity,
      request,
      order: place.order,
      correlationId: place.correlationId
    });

    expect(approved.size).toBe("0.005");
    expect(fixture.riskEvents.listRecent(1)[0]?.decision).toBe("adjusted");

    fixture.db.close();
  });

  it("rejects exposure that exceeds the configured max notional", () => {
    const fixture = buildFixture();
    const request = {
      marketSymbol: "BTC",
      side: "buy" as const,
      price: "68000",
      size: "0.01",
      timeInForce: "Alo" as const
    };
    const place = fixture.formatter.formatPlaceOrder(request);

    expect(() =>
      fixture.riskEngine.evaluatePlaceOrder({
        identity: fixture.identity,
        request,
        order: place.order,
        correlationId: place.correlationId
      })
    ).toThrow("exceeds configured limit");
    expect(fixture.riskEvents.listRecent(1)[0]?.message).toContain("exceeds configured limit");

    fixture.db.close();
  });

  it("rejects new orders when active open-order count is already at the configured limit", () => {
    const fixture = buildFixture();
    for (let index = 0; index < DEFAULT_RISK_CONFIG.maxOpenOrders; index += 1) {
      fixture.orderStates.upsertState(makeActiveOrderRecord(index));
    }

    const request = {
      marketSymbol: "BTC",
      side: "buy" as const,
      price: "68000",
      size: "0.001",
      timeInForce: "Alo" as const
    };
    const place = fixture.formatter.formatPlaceOrder(request);

    expect(() =>
      fixture.riskEngine.evaluatePlaceOrder({
        identity: fixture.identity,
        request,
        order: place.order,
        correlationId: place.correlationId
      })
    ).toThrow("Active order count");
    expect(fixture.riskEvents.listRecent(1)[0]?.decision).toBe("rejected");

    fixture.db.close();
  });

  it("rejects aggressive buy prices that exceed the configured deviation guard", () => {
    const fixture = buildFixture();
    const request = {
      marketSymbol: "BTC",
      side: "buy" as const,
      price: "70000",
      size: "0.001",
      timeInForce: "Gtc" as const
    };
    const place = fixture.formatter.formatPlaceOrder(request);

    expect(() =>
      fixture.riskEngine.evaluatePlaceOrder({
        identity: fixture.identity,
        request,
        order: place.order,
        correlationId: place.correlationId
      })
    ).toThrow("max aggressive deviation");
    expect(fixture.riskEvents.listRecent(1)[0]?.decision).toBe("rejected");

    fixture.db.close();
  });

  it("rejects leverage updates above the capped exchange max", () => {
    const fixture = buildFixture();
    const leverage = fixture.formatter.formatUpdateLeverage({
      marketSymbol: "BTC",
      leverage: 11,
      isCross: true
    });

    expect(() =>
      fixture.riskEngine.evaluateLeverageUpdate({
        identity: fixture.identity,
        leverage
      })
    ).toThrow("exceeds capped limit");
    expect(fixture.riskEvents.listRecent(1)[0]?.message).toContain("capped limit");

    fixture.db.close();
  });
});

function buildFixture(args?: {
  readonly accountSnapshot?: AccountMirrorSnapshot;
  readonly config?: AppConfig;
}): {
  readonly db: SqliteDatabase;
  readonly identity: ExecutionIdentity;
  readonly formatter: HyperliquidOrderFormatter;
  readonly riskEngine: RiskEngine;
  readonly riskEvents: RiskEventRepository;
  readonly orderStates: OrderStateRepository;
} {
  const config = args?.config ?? makeConfig();
  const db = new SqliteDatabase(":memory:");
  const runtimeTrustController = new RuntimeTrustController(
    new RuntimeStateRepository(db.connection),
    pino({ level: "silent" })
  );
  runtimeTrustController.transition("trusted", "test:trusted");

  const registry = makeTestRegistry();
  const riskEvents = new RiskEventRepository(db.connection);
  const orderStates = new OrderStateRepository(db.connection);

  return {
    db,
    identity: new SignerRegistry(config, pino({ level: "silent" })).requireExecutionIdentity(),
    formatter: new HyperliquidOrderFormatter(() => registry, new CloidService()),
    riskEngine: new RiskEngine({
      config,
      logger: pino({ level: "silent" }),
      runtimeTrustController,
      orderStateRepository: orderStates,
      riskEventRepository: riskEvents,
      getAssetRegistry: () => registry,
      getAccountSnapshot: () => args?.accountSnapshot ?? makeAccountSnapshot()
    }),
    riskEvents,
    orderStates
  };
}

function makeConfig(): AppConfig {
  return {
    appEnv: "test",
    network: resolveNetworkConfig("testnet"),
    logLevel: "silent",
    sqlitePath: ":memory:",
    risk: DEFAULT_RISK_CONFIG,
    watchedMarkets: ["BTC", "ETH"],
    operatorAddress: "0x1111111111111111111111111111111111111111",
    apiWallet: {
      privateKey: `0x${"11".repeat(32)}`
    },
    bootstrapUserState: true
  };
}

function makeAccountSnapshot(
  overrides?: Partial<AccountMirrorSnapshot>
): AccountMirrorSnapshot {
  return {
    operatorAddress: "0x1111111111111111111111111111111111111111",
    network: "testnet",
    source: "rest_reconciliation",
    syncedAt: "2026-04-13T15:00:00.000Z",
    exchangeTimestampMs: 1,
    staleness: "fresh",
    marginModeAssumption: "cross-only-mvp",
    marginSummary: {
      accountValue: "1000",
      totalNotionalPosition: "0",
      totalRawUsd: "1000",
      totalMarginUsed: "0"
    },
    crossMarginSummary: {
      accountValue: "1000",
      totalNotionalPosition: "0",
      totalRawUsd: "1000",
      totalMarginUsed: "0"
    },
    crossMaintenanceMarginUsed: "0",
    withdrawable: "1000",
    positions: [],
    spotBalances: [],
    ...overrides
  };
}

function makeActiveOrderRecord(index: number): OrderStateRecord {
  return {
    orderKey: `cloid:0x${String(index + 1).padStart(32, "a")}`,
    operatorAddress: "0x1111111111111111111111111111111111111111",
    marketSymbol: "BTC",
    assetId: 0,
    marketType: "perp",
    state: "resting",
    side: "buy",
    orderId: index + 1,
    clientOrderId: `0x${String(index + 1).padStart(32, "a")}` as `0x${string}`,
    limitPrice: "68000",
    originalSize: "0.001",
    filledSize: "0",
    lastSource: "exchange_ack",
    updatedAt: `2026-04-13T15:00:${String(index).padStart(2, "0")}.000Z`
  };
}
