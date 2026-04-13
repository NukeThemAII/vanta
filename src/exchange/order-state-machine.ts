import { randomUUID } from "node:crypto";

import type { OrderSuccessResponse } from "@nktkas/hyperliquid/api/exchange";
import type { OrderStatusResponse } from "@nktkas/hyperliquid/api/info";
import type { OrderUpdatesEvent, UserFillsEvent } from "@nktkas/hyperliquid/api/subscription";
import type { Logger } from "pino";
import type { Address, Hex } from "viem";

import {
  addDecimalStrings,
  compareDecimalStrings,
  divideDecimalStrings,
  multiplyDecimalStrings
} from "../core/decimal.js";
import { asJsonValue, type JsonValue } from "../core/types.js";
import type { OrderStateRepository } from "../persistence/repositories/order-state-repository.js";
import type { AssetRegistry, AssetKind } from "./asset-registry.js";
import type { FormattedOrderRequest, ExecutionIdentity, OrderLifecycleSource, OrderLifecycleState, OrderReference, OrderStateRecord, OrderStateTransitionRecord } from "./execution-types.js";
import type { NormalizedOrderStatus, OpenOrderStateSnapshot } from "./open-order-mirror.js";

const TERMINAL_STATES = new Set<OrderLifecycleState>(["filled", "canceled", "rejected"]);

export class OrderStateMachine {
  private readonly byOrderKey = new Map<string, OrderStateRecord>();
  private readonly orderKeyByOrderId = new Map<number, string>();
  private readonly orderKeyByClientOrderId = new Map<Hex, string>();

  constructor(
    private readonly repository: OrderStateRepository,
    private readonly logger: Logger
  ) {}

  getByClientOrderId(clientOrderId: Hex): OrderStateRecord | undefined {
    const orderKey = this.orderKeyByClientOrderId.get(clientOrderId);
    if (orderKey !== undefined) {
      return this.byOrderKey.get(orderKey);
    }

    const record = this.repository.getByClientOrderId(clientOrderId);
    if (record !== undefined) {
      this.indexState(record);
    }
    return record;
  }

  getByOrderId(orderId: number): OrderStateRecord | undefined {
    const orderKey = this.orderKeyByOrderId.get(orderId);
    if (orderKey !== undefined) {
      return this.byOrderKey.get(orderKey);
    }

    const record = this.repository.getByOrderId(orderId);
    if (record !== undefined) {
      this.indexState(record);
    }
    return record;
  }

  recordSubmitted(args: {
    readonly actionId: string;
    readonly identity: ExecutionIdentity;
    readonly order: FormattedOrderRequest;
    readonly occurredAt?: string;
  }): OrderStateRecord {
    const occurredAt = args.occurredAt ?? new Date().toISOString();
    const orderKey = deriveOrderKey({ clientOrderId: args.order.clientOrderId });
    const current = this.lookup(orderKey);
    const next = createOrderState({
      orderKey,
      operatorAddress: args.identity.operatorAddress,
      marketSymbol: args.order.marketSymbol,
      assetId: args.order.assetId,
      marketType: args.order.marketType,
      state: "submitted",
      side: args.order.side,
      ...(current?.orderId !== undefined ? { orderId: current.orderId } : {}),
      clientOrderId: args.order.clientOrderId,
      limitPrice: args.order.price,
      originalSize: args.order.size,
      filledSize: current?.filledSize ?? "0",
      ...(current?.averageFillPrice !== undefined ? { averageFillPrice: current.averageFillPrice } : {}),
      lastSource: "execution_submission",
      updatedAt: occurredAt,
      ...(current?.eventTimestampMs !== undefined ? { eventTimestampMs: current.eventTimestampMs } : {}),
      metadata: asJsonValue({
        grouping: args.order.grouping,
        orderType: serializeOrderType(args.order)
      })
    });

    this.persistTransition({
      current,
      next,
      source: "execution_submission",
      actionId: args.actionId,
      occurredAt,
      payload: asJsonValue({
        grouping: args.order.grouping,
        orderType: serializeOrderType(args.order)
      })
    });

    return next;
  }

  recordOrderAcknowledgement(args: {
    readonly actionId: string;
    readonly identity: ExecutionIdentity;
    readonly order: FormattedOrderRequest;
    readonly response: OrderSuccessResponse["response"]["data"]["statuses"][number];
    readonly occurredAt?: string;
  }): OrderStateRecord {
    const occurredAt = args.occurredAt ?? new Date().toISOString();
    const orderKey = deriveOrderKey({ clientOrderId: args.order.clientOrderId });
    const current = this.lookup(orderKey);
    const base = current ?? buildPlaceholderState(args.identity.operatorAddress, args.order, occurredAt);

    if (typeof args.response === "string") {
      return this.upsert({
        current,
        next: createOrderState({
          ...base,
          state: base.state,
          lastSource: "exchange_ack",
          updatedAt: occurredAt,
          metadata: asJsonValue({
            responseStatus: args.response
          })
        }),
        source: "exchange_ack",
        actionId: args.actionId,
        occurredAt,
        payload: asJsonValue({
          responseStatus: args.response
        })
      });
    }

    if ("error" in args.response) {
      const errorMessage = String(args.response.error);

      return this.upsert({
        current,
        next: createOrderState({
          ...base,
          state: "rejected",
          lastSource: "exchange_ack",
          updatedAt: occurredAt,
          rejectionReason: errorMessage,
          metadata: asJsonValue({
            exchangeError: errorMessage
          })
        }),
        source: "exchange_ack",
        actionId: args.actionId,
        occurredAt,
        payload: asJsonValue({
          exchangeError: errorMessage
        })
      });
    }

    if ("resting" in args.response) {
      return this.upsert({
        current,
        next: createOrderState({
          ...base,
          state: "resting",
          orderId: args.response.resting.oid,
          clientOrderId: args.response.resting.cloid ?? args.order.clientOrderId,
          lastSource: "exchange_ack",
          updatedAt: occurredAt,
          metadata: asJsonValue({
            acknowledgement: "resting"
          })
        }),
        source: "exchange_ack",
        actionId: args.actionId,
        occurredAt,
        payload: asJsonValue({
          acknowledgement: args.response.resting
        })
      });
    }

    return this.upsert({
      current,
      next: createOrderState({
        ...base,
        state: "filled",
        orderId: args.response.filled.oid,
        clientOrderId: args.response.filled.cloid ?? args.order.clientOrderId,
        filledSize: args.response.filled.totalSz,
        averageFillPrice: args.response.filled.avgPx,
        lastSource: "exchange_ack",
        updatedAt: occurredAt,
        metadata: asJsonValue({
          acknowledgement: "filled"
        })
      }),
      source: "exchange_ack",
      actionId: args.actionId,
      occurredAt,
      payload: asJsonValue({
        acknowledgement: args.response.filled
      })
    });
  }

  recordCancelRequested(args: {
    readonly actionId: string;
    readonly identity: ExecutionIdentity;
    readonly marketSymbol: string;
    readonly assetId: number;
    readonly reference: OrderReference;
    readonly occurredAt?: string;
  }): OrderStateRecord {
    return this.recordTransientIntent({
      ...args,
      nextState: "cancel_requested"
    });
  }

  recordModifyRequested(args: {
    readonly actionId: string;
    readonly identity: ExecutionIdentity;
    readonly order: FormattedOrderRequest;
    readonly reference: OrderReference;
    readonly occurredAt?: string;
  }): OrderStateRecord {
    return this.recordTransientIntent({
      actionId: args.actionId,
      identity: args.identity,
      marketSymbol: args.order.marketSymbol,
      assetId: args.order.assetId,
      reference: args.reference,
      ...(args.occurredAt !== undefined ? { occurredAt: args.occurredAt } : {}),
      nextState: "modify_requested",
      metadata: asJsonValue(serializeOrderType(args.order))
    });
  }

  markNeedsReconciliation(args: {
    readonly actionId?: string;
    readonly operatorAddress: Address;
    readonly marketSymbol: string;
    readonly assetId: number;
    readonly reference: OrderReference;
    readonly occurredAt?: string;
    readonly reason: string;
  }): OrderStateRecord {
    const occurredAt = args.occurredAt ?? new Date().toISOString();
    const orderKey = this.resolveOrderKey(args.reference);
    const current = this.lookup(orderKey);
    const next = createOrderState({
      ...(current ?? {
        orderKey,
        operatorAddress: args.operatorAddress,
        marketSymbol: args.marketSymbol,
        assetId: args.assetId,
        marketType: "perp" as AssetKind,
        filledSize: "0"
      }),
      state: "needs_reconciliation",
      lastSource: "reconciliation",
      updatedAt: occurredAt,
      rejectionReason: args.reason
    });

    return this.upsert({
      current,
      next,
      source: "reconciliation",
      ...(args.actionId !== undefined ? { actionId: args.actionId } : {}),
      occurredAt,
      payload: asJsonValue({
        reason: args.reason
      })
    });
  }

  applyOpenOrderSnapshot(snapshot: OpenOrderStateSnapshot): void {
    const presentKeys = new Set<string>();

    for (const order of snapshot.orders) {
      const orderKey = deriveOrderKey({
        ...(order.clientOrderId !== null ? { clientOrderId: order.clientOrderId } : {}),
        orderId: order.orderId
      });
      presentKeys.add(orderKey);

      const current = this.lookup(orderKey);
      const next = createOrderState({
        orderKey,
        operatorAddress: snapshot.operatorAddress,
        marketSymbol: order.marketSymbol,
        assetId: order.assetId,
        marketType: order.marketType,
        state: mapNormalizedStatus(order.status),
        side: order.side,
        orderId: order.orderId,
        ...(order.clientOrderId !== null ? { clientOrderId: order.clientOrderId } : {}),
        limitPrice: order.limitPrice,
        originalSize: order.originalSize,
        filledSize: current?.filledSize ?? "0",
        ...(current?.averageFillPrice !== undefined ? { averageFillPrice: current.averageFillPrice } : {}),
        lastSource: "open_orders_snapshot",
        updatedAt: snapshot.syncedAt,
        eventTimestampMs: order.statusTimestampMs,
        metadata: asJsonValue({
          triggerPrice: order.triggerPrice,
          timeInForce: order.timeInForce
        }),
        ...(current?.rejectionReason !== undefined ? { rejectionReason: current.rejectionReason } : {})
      });

      this.persistTransition({
        current,
        next,
        source: "open_orders_snapshot",
        occurredAt: snapshot.syncedAt,
        eventTimestampMs: order.statusTimestampMs,
        payload: asJsonValue({
          orderId: order.orderId,
          clientOrderId: order.clientOrderId,
          status: order.status
        })
      });
    }

    for (const current of this.byOrderKey.values()) {
      if (current.operatorAddress !== snapshot.operatorAddress || TERMINAL_STATES.has(current.state)) {
        continue;
      }

      if (!presentKeys.has(current.orderKey)) {
        this.persistTransition({
          current,
          next: createOrderState({
            ...current,
            state: "needs_reconciliation",
            lastSource: "open_orders_snapshot",
            updatedAt: snapshot.syncedAt,
            rejectionReason: "Order missing from authoritative open-order snapshot"
          }),
          source: "open_orders_snapshot",
          occurredAt: snapshot.syncedAt,
          payload: asJsonValue({
            reason: "Order missing from authoritative open-order snapshot"
          })
        });
      }
    }
  }

  applyOrderUpdates(args: {
    readonly operatorAddress: Address;
    readonly registry: AssetRegistry;
    readonly updates: OrderUpdatesEvent;
    readonly occurredAt?: string;
  }): void {
    const occurredAt = args.occurredAt ?? new Date().toISOString();

    for (const update of args.updates) {
      const asset = args.registry.requireBySymbol(update.order.coin);
      const clientOrderId = update.order.cloid ?? undefined;
      const orderKey = deriveOrderKey({
        ...(clientOrderId !== undefined ? { clientOrderId } : {}),
        orderId: update.order.oid
      });
      const current = this.lookup(orderKey);
      const next = createOrderState({
        orderKey,
        operatorAddress: args.operatorAddress,
        marketSymbol: update.order.coin,
        assetId: asset.assetId,
        marketType: asset.kind,
        state: mapNormalizedStatus(update.status),
        side: update.order.side === "B" ? "buy" : "sell",
        orderId: update.order.oid,
        ...(clientOrderId !== undefined ? { clientOrderId } : {}),
        limitPrice: update.order.limitPx,
        originalSize: update.order.origSz,
        filledSize: current?.filledSize ?? "0",
        ...(current?.averageFillPrice !== undefined ? { averageFillPrice: current.averageFillPrice } : {}),
        lastSource: "order_update",
        updatedAt: occurredAt,
        eventTimestampMs: update.statusTimestamp,
        ...(isRejectedStatus(update.status)
          ? { rejectionReason: update.status }
          : current?.rejectionReason !== undefined
            ? { rejectionReason: current.rejectionReason }
            : {})
      });

      this.persistTransition({
        current,
        next,
        source: "order_update",
        occurredAt,
        eventTimestampMs: update.statusTimestamp,
        payload: asJsonValue({
          status: update.status,
          orderId: update.order.oid,
          clientOrderId: update.order.cloid ?? null
        })
      });
    }
  }

  applyUserFills(args: {
    readonly operatorAddress: Address;
    readonly registry: AssetRegistry;
    readonly fills: UserFillsEvent;
    readonly occurredAt?: string;
  }): void {
    const occurredAt = args.occurredAt ?? new Date().toISOString();

    for (const fill of args.fills.fills) {
      const asset = args.registry.requireBySymbol(fill.coin);
      const clientOrderId = fill.cloid ?? undefined;
      const orderKey = deriveOrderKey({
        ...(clientOrderId !== undefined ? { clientOrderId } : {}),
        orderId: fill.oid
      });
      const current = this.lookup(orderKey);
      const previousFilled = current?.filledSize ?? "0";
      const filledSize = addDecimalStrings(previousFilled, fill.sz);
      const averageFillPrice =
        current?.averageFillPrice !== undefined && compareDecimalStrings(previousFilled, "0") === 1
          ? divideDecimalStrings(
              addDecimalStrings(
                multiplyDecimalStrings(current.averageFillPrice, previousFilled),
                multiplyDecimalStrings(fill.px, fill.sz)
              ),
              filledSize
            )
          : fill.px;
      const nextState =
        current?.originalSize !== undefined && compareDecimalStrings(filledSize, current.originalSize) >= 0
          ? "filled"
          : "partially_filled";

      const next = createOrderState({
        orderKey,
        operatorAddress: args.operatorAddress,
        marketSymbol: fill.coin,
        assetId: asset.assetId,
        marketType: asset.kind,
        state: nextState,
        side: fill.side === "B" ? "buy" : "sell",
        orderId: fill.oid,
        ...(clientOrderId !== undefined
          ? { clientOrderId }
          : current?.clientOrderId !== undefined
            ? { clientOrderId: current.clientOrderId }
            : {}),
        ...(current?.limitPrice !== undefined ? { limitPrice: current.limitPrice } : {}),
        ...(current?.originalSize !== undefined ? { originalSize: current.originalSize } : {}),
        filledSize,
        averageFillPrice,
        lastSource: "user_fill",
        updatedAt: occurredAt,
        eventTimestampMs: fill.time,
        metadata: asJsonValue({
          fee: fill.fee,
          feeToken: fill.feeToken ?? null,
          crossed: fill.crossed
        }),
        ...(current?.rejectionReason !== undefined ? { rejectionReason: current.rejectionReason } : {})
      });

      this.persistTransition({
        current,
        next,
        source: "user_fill",
        occurredAt,
        eventTimestampMs: fill.time,
        payload: asJsonValue({
          orderId: fill.oid,
          clientOrderId: fill.cloid ?? null,
          fillSize: fill.sz,
          fillPrice: fill.px,
          isSnapshot: args.fills.isSnapshot === true
        })
      });
    }
  }

  applyOrderStatus(args: {
    readonly operatorAddress: Address;
    readonly registry: AssetRegistry;
    readonly response: OrderStatusResponse;
    readonly occurredAt?: string;
  }): OrderStateRecord | undefined {
    if (args.response.status === "unknownOid") {
      return undefined;
    }

    const occurredAt = args.occurredAt ?? new Date().toISOString();
    const statusOrder = args.response.order.order;
    const asset = args.registry.requireBySymbol(statusOrder.coin);
    const clientOrderId = statusOrder.cloid ?? undefined;
    const orderKey = deriveOrderKey({
      ...(clientOrderId !== undefined ? { clientOrderId } : {}),
      orderId: statusOrder.oid
    });
    const current = this.lookup(orderKey);
    const next = createOrderState({
      orderKey,
      operatorAddress: args.operatorAddress,
      marketSymbol: statusOrder.coin,
      assetId: asset.assetId,
      marketType: asset.kind,
      state: mapNormalizedStatus(args.response.order.status),
      side: statusOrder.side === "B" ? "buy" : "sell",
      orderId: statusOrder.oid,
      ...(clientOrderId !== undefined
        ? { clientOrderId }
        : current?.clientOrderId !== undefined
          ? { clientOrderId: current.clientOrderId }
          : {}),
      limitPrice: statusOrder.limitPx,
      originalSize: statusOrder.origSz,
      filledSize: current?.filledSize ?? "0",
      ...(current?.averageFillPrice !== undefined ? { averageFillPrice: current.averageFillPrice } : {}),
      lastSource: "order_status",
      updatedAt: occurredAt,
      eventTimestampMs: args.response.order.statusTimestamp,
      ...(isRejectedStatus(args.response.order.status)
        ? { rejectionReason: args.response.order.status }
        : current?.rejectionReason !== undefined
          ? { rejectionReason: current.rejectionReason }
          : {})
    });

    return this.upsert({
      current,
      next,
      source: "order_status",
      occurredAt,
      eventTimestampMs: args.response.order.statusTimestamp,
      payload: asJsonValue({
        status: args.response.order.status,
        orderId: statusOrder.oid,
        clientOrderId: statusOrder.cloid ?? null
      })
    });
  }

  private recordTransientIntent(args: {
    readonly actionId: string;
    readonly identity: ExecutionIdentity;
    readonly marketSymbol: string;
    readonly assetId: number;
    readonly reference: OrderReference;
    readonly occurredAt?: string;
    readonly nextState: "cancel_requested" | "modify_requested";
    readonly metadata?: JsonValue;
  }): OrderStateRecord {
    const occurredAt = args.occurredAt ?? new Date().toISOString();
    const orderKey = this.resolveOrderKey(args.reference);
    const current = this.lookup(orderKey);
    const next = createOrderState({
      ...(current ?? {
        orderKey,
        operatorAddress: args.identity.operatorAddress,
        marketSymbol: args.marketSymbol,
        assetId: args.assetId,
        marketType: "perp" as AssetKind,
        filledSize: "0"
      }),
      state: args.nextState,
      lastSource: "execution_submission",
      updatedAt: occurredAt,
      ...(args.metadata !== undefined ? { metadata: args.metadata } : {})
    });

    return this.upsert({
      current,
      next,
      source: "execution_submission",
      actionId: args.actionId,
      occurredAt,
      payload: asJsonValue({
        intent: args.nextState
      })
    });
  }

  private lookup(orderKey: string): OrderStateRecord | undefined {
    const inMemory = this.byOrderKey.get(orderKey);
    if (inMemory !== undefined) {
      return inMemory;
    }

    const persisted = this.repository.getByOrderKey(orderKey);
    if (persisted !== undefined) {
      this.indexState(persisted);
    }
    return persisted;
  }

  private resolveOrderKey(reference: OrderReference): string {
    if ("clientOrderId" in reference) {
      return deriveOrderKey({ clientOrderId: reference.clientOrderId });
    }

    return deriveOrderKey({ orderId: reference.orderId });
  }

  private upsert(args: {
    readonly current: OrderStateRecord | undefined;
    readonly next: OrderStateRecord;
    readonly source: OrderLifecycleSource;
    readonly occurredAt: string;
    readonly actionId?: string;
    readonly eventTimestampMs?: number | null;
    readonly payload?: JsonValue;
  }): OrderStateRecord {
    this.persistTransition(args);
    return args.next;
  }

  private persistTransition(args: {
    readonly current: OrderStateRecord | undefined;
    readonly next: OrderStateRecord;
    readonly source: OrderLifecycleSource;
    readonly occurredAt: string;
    readonly actionId?: string;
    readonly eventTimestampMs?: number | null;
    readonly payload?: JsonValue;
  }): void {
    const transition: OrderStateTransitionRecord = {
      transitionId: randomUUID(),
      orderKey: args.next.orderKey,
      operatorAddress: args.next.operatorAddress,
      marketSymbol: args.next.marketSymbol,
      assetId: args.next.assetId,
      occurredAt: args.occurredAt,
      source: args.source,
      toState: args.next.state,
      ...(args.current !== undefined ? { fromState: args.current.state } : {}),
      ...(args.actionId !== undefined ? { actionId: args.actionId } : {}),
      ...(args.next.orderId !== undefined ? { orderId: args.next.orderId } : {}),
      ...(args.next.clientOrderId !== undefined ? { clientOrderId: args.next.clientOrderId } : {}),
      ...(args.eventTimestampMs !== undefined ? { eventTimestampMs: args.eventTimestampMs } : {}),
      ...(args.payload !== undefined ? { payload: args.payload } : {})
    };

    this.repository.upsertState(args.next);
    this.repository.insertTransition(transition);
    this.indexState(args.next);
    this.logger.info(
      {
        orderKey: args.next.orderKey,
        fromState: args.current?.state ?? null,
        toState: args.next.state,
        source: args.source,
        orderId: args.next.orderId ?? null,
        clientOrderId: args.next.clientOrderId ?? null
      },
      "Order state transitioned"
    );
  }

  private indexState(record: OrderStateRecord): void {
    this.byOrderKey.set(record.orderKey, record);

    if (record.orderId !== undefined) {
      this.orderKeyByOrderId.set(record.orderId, record.orderKey);
    }

    if (record.clientOrderId !== undefined) {
      this.orderKeyByClientOrderId.set(record.clientOrderId, record.orderKey);
    }
  }
}

interface OrderStateSeed {
  readonly orderKey: string;
  readonly operatorAddress: Address;
  readonly marketSymbol: string;
  readonly assetId: number;
  readonly marketType: AssetKind;
  readonly state: OrderLifecycleState;
  readonly side?: "buy" | "sell";
  readonly orderId?: number;
  readonly clientOrderId?: Hex;
  readonly limitPrice?: string;
  readonly originalSize?: string;
  readonly filledSize: string;
  readonly averageFillPrice?: string;
  readonly lastSource: OrderLifecycleSource;
  readonly updatedAt: string;
  readonly eventTimestampMs?: number | null;
  readonly rejectionReason?: string;
  readonly metadata?: JsonValue;
}

function createOrderState(seed: OrderStateSeed): OrderStateRecord {
  return {
    orderKey: seed.orderKey,
    operatorAddress: seed.operatorAddress,
    marketSymbol: seed.marketSymbol,
    assetId: seed.assetId,
    marketType: seed.marketType,
    state: seed.state,
    filledSize: seed.filledSize,
    lastSource: seed.lastSource,
    updatedAt: seed.updatedAt,
    ...(seed.side !== undefined ? { side: seed.side } : {}),
    ...(seed.orderId !== undefined ? { orderId: seed.orderId } : {}),
    ...(seed.clientOrderId !== undefined ? { clientOrderId: seed.clientOrderId } : {}),
    ...(seed.limitPrice !== undefined ? { limitPrice: seed.limitPrice } : {}),
    ...(seed.originalSize !== undefined ? { originalSize: seed.originalSize } : {}),
    ...(seed.averageFillPrice !== undefined ? { averageFillPrice: seed.averageFillPrice } : {}),
    ...(seed.eventTimestampMs !== undefined ? { eventTimestampMs: seed.eventTimestampMs } : {}),
    ...(seed.rejectionReason !== undefined ? { rejectionReason: seed.rejectionReason } : {}),
    ...(seed.metadata !== undefined ? { metadata: seed.metadata } : {})
  };
}

function buildPlaceholderState(
  operatorAddress: Address,
  order: FormattedOrderRequest,
  updatedAt: string
): OrderStateRecord {
  return createOrderState({
    orderKey: deriveOrderKey({ clientOrderId: order.clientOrderId }),
    operatorAddress,
    marketSymbol: order.marketSymbol,
    assetId: order.assetId,
    marketType: order.marketType,
    state: "submitted",
    side: order.side,
    clientOrderId: order.clientOrderId,
    limitPrice: order.price,
    originalSize: order.size,
    filledSize: "0",
    lastSource: "execution_submission",
    updatedAt
  });
}

function deriveOrderKey(input: {
  readonly clientOrderId?: Hex;
  readonly orderId?: number;
}): string {
  if (input.clientOrderId !== undefined) {
    return `cloid:${input.clientOrderId}`;
  }

  if (input.orderId !== undefined) {
    return `oid:${input.orderId}`;
  }

  throw new Error("Order key requires either clientOrderId or orderId");
}

function serializeOrderType(order: FormattedOrderRequest): JsonValue {
  return order.orderType.kind === "limit"
    ? {
        kind: "limit",
        timeInForce: order.orderType.timeInForce
      }
    : {
        kind: "trigger",
        isMarket: order.orderType.isMarket,
        triggerPrice: order.orderType.triggerPrice,
        triggerKind: order.orderType.triggerKind
      };
}

function mapNormalizedStatus(status: NormalizedOrderStatus): OrderLifecycleState {
  if (status === "open" || status === "triggered") {
    return "resting";
  }

  if (status === "filled") {
    return "filled";
  }

  if (isCanceledStatus(status)) {
    return "canceled";
  }

  return "rejected";
}

function isCanceledStatus(status: NormalizedOrderStatus): boolean {
  return status === "canceled" || status.endsWith("Canceled");
}

function isRejectedStatus(status: NormalizedOrderStatus): boolean {
  return status === "rejected" || status.endsWith("Rejected");
}
