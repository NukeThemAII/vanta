import type { OrderSuccessResponse } from "@nktkas/hyperliquid/api/exchange";
import type { UserFillsEvent } from "@nktkas/hyperliquid/api/subscription";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";

import type { ExecutionIdentity, FormattedOrderRequest } from "../../../src/exchange/execution-types.js";
import { OrderStateMachine } from "../../../src/exchange/order-state-machine.js";
import { SqliteDatabase } from "../../../src/persistence/db.js";
import { OrderStateRepository } from "../../../src/persistence/repositories/order-state-repository.js";
import { makeTestRegistry } from "../../fixtures/hyperliquid-fixtures.js";

describe("OrderStateMachine", () => {
  const resources: SqliteDatabase[] = [];

  afterEach(() => {
    for (const resource of resources.splice(0)) {
      resource.close();
    }
  });

  it("tracks submission, acknowledgement, and fills into a terminal filled state", () => {
    const db = new SqliteDatabase(":memory:");
    resources.push(db);
    const repository = new OrderStateRepository(db.connection);
    const machine = new OrderStateMachine(repository, pino({ level: "silent" }));
    const identity = makeIdentity();
    const order = makeOrder();

    machine.recordSubmitted({
      actionId: "action-1",
      identity,
      order,
      occurredAt: "2026-04-08T10:00:00.000Z"
    });
    machine.recordOrderAcknowledgement({
      actionId: "action-1",
      identity,
      order,
      response: {
        resting: {
          oid: 42,
          cloid: order.clientOrderId
        }
      } as OrderSuccessResponse["response"]["data"]["statuses"][number],
      occurredAt: "2026-04-08T10:00:01.000Z"
    });

    const registry = makeTestRegistry();
    machine.applyUserFills({
      operatorAddress: identity.operatorAddress,
      registry,
      fills: {
        isSnapshot: false,
        fills: [
          {
            coin: "BTC",
            px: "100",
            sz: "0.1",
            side: "B",
            time: 1,
            oid: 42,
            cloid: order.clientOrderId,
            fee: "0.01",
            feeToken: "USDC",
            crossed: false
          }
        ]
      } as UserFillsEvent,
      occurredAt: "2026-04-08T10:00:02.000Z"
    });
    machine.applyUserFills({
      operatorAddress: identity.operatorAddress,
      registry,
      fills: {
        isSnapshot: false,
        fills: [
          {
            coin: "BTC",
            px: "110",
            sz: "0.1",
            side: "B",
            time: 2,
            oid: 42,
            cloid: order.clientOrderId,
            fee: "0.01",
            feeToken: "USDC",
            crossed: false
          }
        ]
      } as UserFillsEvent,
      occurredAt: "2026-04-08T10:00:03.000Z"
    });

    const state = machine.getByClientOrderId(order.clientOrderId);
    const transitionCount = db.connection
      .prepare("SELECT COUNT(*) AS count FROM order_state_transitions")
      .get() as { readonly count: number };

    expect(state?.state).toBe("filled");
    expect(state?.orderId).toBe(42);
    expect(state?.filledSize).toBe("0.2");
    expect(state?.averageFillPrice).toBe("105");
    expect(transitionCount.count).toBe(4);
  });

  it("marks missing active orders as needing reconciliation on authoritative snapshots", () => {
    const db = new SqliteDatabase(":memory:");
    resources.push(db);
    const repository = new OrderStateRepository(db.connection);
    const machine = new OrderStateMachine(repository, pino({ level: "silent" }));
    const identity = makeIdentity();
    const order = makeOrder();

    machine.recordSubmitted({
      actionId: "action-2",
      identity,
      order,
      occurredAt: "2026-04-08T11:00:00.000Z"
    });
    machine.recordOrderAcknowledgement({
      actionId: "action-2",
      identity,
      order,
      response: {
        resting: {
          oid: 84,
          cloid: order.clientOrderId
        }
      } as OrderSuccessResponse["response"]["data"]["statuses"][number],
      occurredAt: "2026-04-08T11:00:01.000Z"
    });

    machine.applyOpenOrderSnapshot({
      operatorAddress: identity.operatorAddress,
      network: "testnet",
      source: "rest_reconciliation",
      syncedAt: "2026-04-08T11:00:05.000Z",
      orders: []
    });

    expect(machine.getByClientOrderId(order.clientOrderId)?.state).toBe("needs_reconciliation");
  });
});

function makeIdentity(): ExecutionIdentity {
  return {
    network: "testnet",
    operatorAddress: "0x1111111111111111111111111111111111111111",
    signerAddress: "0x2222222222222222222222222222222222222222",
    signerType: "api_wallet",
    mode: "direct"
  };
}

function makeOrder(): FormattedOrderRequest {
  return {
    marketSymbol: "BTC",
    marketType: "perp",
    assetId: 0,
    side: "buy",
    price: "100",
    size: "0.2",
    reduceOnly: false,
    orderType: {
      kind: "limit",
      timeInForce: "Alo"
    },
    grouping: "na",
    clientOrderId: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  };
}
