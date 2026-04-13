import type { FrontendOpenOrdersResponse } from "@nktkas/hyperliquid/api/info";
import type { OrderUpdatesEvent, OpenOrdersEvent } from "@nktkas/hyperliquid/api/subscription";
import type { Address, Hex } from "viem";

import type { NetworkName } from "../core/types.js";
import type { AssetRegistry, AssetKind } from "./asset-registry.js";
import type { ExchangeSnapshotSource } from "../portfolio/account-mirror.js";

export type OrderSide = "buy" | "sell";
export type NormalizedOrderStatus =
  | "open"
  | "filled"
  | "canceled"
  | "triggered"
  | "rejected"
  | "marginCanceled"
  | "vaultWithdrawalCanceled"
  | "openInterestCapCanceled"
  | "selfTradeCanceled"
  | "reduceOnlyCanceled"
  | "siblingFilledCanceled"
  | "delistedCanceled"
  | "liquidatedCanceled"
  | "scheduledCancel"
  | "tickRejected"
  | "minTradeNtlRejected"
  | "perpMarginRejected"
  | "reduceOnlyRejected"
  | "badAloPxRejected"
  | "iocCancelRejected"
  | "badTriggerPxRejected"
  | "marketOrderNoLiquidityRejected"
  | "positionIncreaseAtOpenInterestCapRejected"
  | "positionFlipAtOpenInterestCapRejected"
  | "tooAggressiveAtOpenInterestCapRejected"
  | "openInterestIncreaseRejected"
  | "insufficientSpotBalanceRejected"
  | "oracleRejected"
  | "perpMaxPositionRejected";

export interface NormalizedOpenOrder {
  readonly assetId: number;
  readonly marketSymbol: string;
  readonly marketType: AssetKind;
  readonly orderId: number;
  readonly clientOrderId: Hex | null;
  readonly side: OrderSide;
  readonly limitPrice: string;
  readonly size: string;
  readonly originalSize: string;
  readonly reduceOnly: boolean;
  readonly orderType: string;
  readonly timeInForce: string | null;
  readonly isTrigger: boolean;
  readonly triggerPrice: string | null;
  readonly triggerCondition: string | null;
  readonly isPositionTpsl: boolean;
  readonly placedTimestampMs: number;
  readonly status: NormalizedOrderStatus;
  readonly statusTimestampMs: number;
}

export interface OpenOrderStateSnapshot {
  readonly operatorAddress: Address;
  readonly network: NetworkName;
  readonly source: ExchangeSnapshotSource;
  readonly syncedAt: string;
  readonly orders: readonly NormalizedOpenOrder[];
}

export interface NormalizeOpenOrderSnapshotArgs {
  readonly operatorAddress: Address;
  readonly network: NetworkName;
  readonly source: ExchangeSnapshotSource;
  readonly syncedAt: string;
  readonly registry: AssetRegistry;
  readonly openOrders: FrontendOpenOrdersResponse;
}

export class OpenOrderMirror {
  private current: OpenOrderStateSnapshot | undefined;
  private readonly byOrderId = new Map<number, NormalizedOpenOrder>();

  getSnapshot(): OpenOrderStateSnapshot | undefined {
    return this.current;
  }

  replaceSnapshot(snapshot: OpenOrderStateSnapshot): void {
    this.current = snapshot;
    this.resetIndex(snapshot.orders);
  }

  applyOpenOrdersSnapshot(args: {
    readonly syncedAt: string;
    readonly registry: AssetRegistry;
    readonly openOrdersEvent: OpenOrdersEvent;
  }): void {
    if (this.current === undefined) {
      return;
    }

    const orders = normalizeFrontendOpenOrders(args.registry, args.openOrdersEvent.orders);
    this.current = {
      ...this.current,
      source: "websocket_stream",
      syncedAt: args.syncedAt,
      orders
    };
    this.resetIndex(orders);
  }

  applyOrderUpdates(args: {
    readonly orderUpdates: OrderUpdatesEvent;
    readonly registry: AssetRegistry;
    readonly syncedAt: string;
  }): void {
    if (this.current === undefined) {
      return;
    }

    const next = new Map(this.byOrderId);

    for (const update of args.orderUpdates) {
      const normalized = normalizeOrderUpdate(args.registry, update);

      if (normalized.status === "open" || normalized.status === "triggered") {
        next.set(normalized.orderId, normalized);
        continue;
      }

      next.delete(normalized.orderId);
    }

    const orders = [...next.values()].sort((left, right) => left.placedTimestampMs - right.placedTimestampMs);

    this.current = {
      ...this.current,
      source: "websocket_stream",
      syncedAt: args.syncedAt,
      orders
    };
    this.resetIndex(orders);
  }

  private resetIndex(orders: readonly NormalizedOpenOrder[]): void {
    this.byOrderId.clear();
    for (const order of orders) {
      this.byOrderId.set(order.orderId, order);
    }
  }
}

export function normalizeOpenOrderSnapshot(args: NormalizeOpenOrderSnapshotArgs): OpenOrderStateSnapshot {
  return {
    operatorAddress: args.operatorAddress,
    network: args.network,
    source: args.source,
    syncedAt: args.syncedAt,
    orders: normalizeFrontendOpenOrders(args.registry, args.openOrders)
  };
}

export function normalizeFrontendOpenOrders(
  registry: AssetRegistry,
  orders: FrontendOpenOrdersResponse
): readonly NormalizedOpenOrder[] {
  const normalizedOrders: NormalizedOpenOrder[] = orders.map((order) => {
      const asset = registry.requireBySymbol(order.coin);

      return {
        assetId: asset.assetId,
        marketSymbol: order.coin,
        marketType: asset.kind,
        orderId: order.oid,
        clientOrderId: order.cloid ?? null,
        side: normalizeSide(order.side),
        limitPrice: order.limitPx,
        size: order.sz,
        originalSize: order.origSz,
        reduceOnly: order.reduceOnly,
        orderType: order.orderType,
        timeInForce: order.tif,
        isTrigger: order.isTrigger,
        triggerPrice: order.triggerPx === "" ? null : order.triggerPx,
        triggerCondition: order.triggerCondition === "" ? null : order.triggerCondition,
        isPositionTpsl: order.isPositionTpsl,
        placedTimestampMs: order.timestamp,
        status: "open",
        statusTimestampMs: order.timestamp
      };
    });

  return normalizedOrders.sort((left, right) => left.placedTimestampMs - right.placedTimestampMs);
}

export function normalizeOrderUpdate(
  registry: AssetRegistry,
  update: OrderUpdatesEvent[number]
): NormalizedOpenOrder {
  const asset = registry.requireBySymbol(update.order.coin);

  return {
    assetId: asset.assetId,
    marketSymbol: update.order.coin,
    marketType: asset.kind,
    orderId: update.order.oid,
    clientOrderId: update.order.cloid ?? null,
    side: normalizeSide(update.order.side),
    limitPrice: update.order.limitPx,
    size: update.order.sz,
    originalSize: update.order.origSz,
    reduceOnly: update.order.reduceOnly === true,
    orderType: "Unknown",
    timeInForce: null,
    isTrigger: false,
    triggerPrice: null,
    triggerCondition: null,
    isPositionTpsl: false,
    placedTimestampMs: update.order.timestamp,
    status: update.status,
    statusTimestampMs: update.statusTimestamp
  };
}

function normalizeSide(side: "A" | "B"): OrderSide {
  return side === "B" ? "buy" : "sell";
}
