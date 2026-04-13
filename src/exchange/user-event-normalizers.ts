import type {
  ClearinghouseStateEvent,
  OpenOrdersEvent,
  OrderUpdatesEvent,
  SpotStateEvent,
  UserEventsEvent,
  UserFillsEvent
} from "@nktkas/hyperliquid/api/subscription";
import type { Address } from "viem";

import { asJsonValue, type JsonValue } from "../core/types.js";

export interface NormalizedUserEventRecord {
  readonly receivedAt: string;
  readonly operatorAddress: Address;
  readonly eventType:
    | "perp_account_snapshot"
    | "spot_balance_snapshot"
    | "open_orders_snapshot"
    | "order_update"
    | "user_fills"
    | "user_event";
  readonly entityKey: string | null;
  readonly market: string | null;
  readonly eventTimestampMs: number | null;
  readonly isSnapshot: boolean;
  readonly payload: JsonValue;
}

export function normalizeClearinghouseStateEvent(
  operatorAddress: Address,
  event: ClearinghouseStateEvent,
  receivedAt = new Date()
): NormalizedUserEventRecord {
  return {
    receivedAt: receivedAt.toISOString(),
    operatorAddress,
    eventType: "perp_account_snapshot",
    entityKey: operatorAddress,
    market: null,
    eventTimestampMs: event.clearinghouseState.time,
    isSnapshot: false,
    payload: {
      dex: event.dex,
      clearinghouseState: event.clearinghouseState
    }
  };
}

export function normalizeSpotStateEvent(
  operatorAddress: Address,
  event: SpotStateEvent,
  receivedAt = new Date()
): NormalizedUserEventRecord {
  return {
    receivedAt: receivedAt.toISOString(),
    operatorAddress,
    eventType: "spot_balance_snapshot",
    entityKey: operatorAddress,
    market: null,
    eventTimestampMs: null,
    isSnapshot: false,
    payload: {
      spotState: event.spotState
    }
  };
}

export function normalizeOpenOrdersEvent(
  operatorAddress: Address,
  event: OpenOrdersEvent,
  receivedAt = new Date()
): NormalizedUserEventRecord {
  return {
    receivedAt: receivedAt.toISOString(),
    operatorAddress,
    eventType: "open_orders_snapshot",
    entityKey: operatorAddress,
    market: null,
    eventTimestampMs: event.orders.reduce<number | null>((latest, order) => {
      if (latest === null || order.timestamp > latest) {
        return order.timestamp;
      }

      return latest;
    }, null),
    isSnapshot: false,
    payload: asJsonValue({
      dex: event.dex,
      orders: event.orders
    })
  };
}

export function normalizeOrderUpdatesEvent(
  operatorAddress: Address,
  event: OrderUpdatesEvent,
  receivedAt = new Date()
): readonly NormalizedUserEventRecord[] {
  return event.map((update) => ({
    receivedAt: receivedAt.toISOString(),
    operatorAddress,
    eventType: "order_update",
    entityKey: String(update.order.oid),
    market: update.order.coin,
    eventTimestampMs: update.statusTimestamp,
    isSnapshot: false,
    payload: asJsonValue(update)
  }));
}

export function normalizeUserFillsEvent(
  operatorAddress: Address,
  event: UserFillsEvent,
  receivedAt = new Date()
): readonly NormalizedUserEventRecord[] {
  return event.fills.map((fill) => ({
    receivedAt: receivedAt.toISOString(),
    operatorAddress,
    eventType: "user_fills",
    entityKey: String(fill.oid),
    market: fill.coin,
    eventTimestampMs: fill.time,
    isSnapshot: event.isSnapshot === true,
    payload: asJsonValue(fill)
  }));
}

export function normalizeUserEventsEvent(
  operatorAddress: Address,
  event: UserEventsEvent,
  receivedAt = new Date()
): NormalizedUserEventRecord {
  return {
    receivedAt: receivedAt.toISOString(),
    operatorAddress,
    eventType: "user_event",
    entityKey: operatorAddress,
    market: inferMarket(event),
    eventTimestampMs: inferEventTimestamp(event),
    isSnapshot: false,
    payload: asJsonValue(event)
  };
}

function inferMarket(event: UserEventsEvent): string | null {
  if ("funding" in event) {
    return event.funding.coin;
  }

  if ("fills" in event) {
    return event.fills[0]?.coin ?? null;
  }

  if ("nonUserCancel" in event) {
    return event.nonUserCancel[0]?.coin ?? null;
  }

  if ("twapHistory" in event) {
    return event.twapHistory[0]?.state.coin ?? null;
  }

  if ("twapSliceFills" in event) {
    return event.twapSliceFills[0]?.fill.coin ?? null;
  }

  return null;
}

function inferEventTimestamp(event: UserEventsEvent): number | null {
  if ("fills" in event) {
    return event.fills.at(-1)?.time ?? null;
  }

  if ("funding" in event) {
    return null;
  }

  if ("liquidation" in event) {
    return null;
  }

  if ("nonUserCancel" in event) {
    return null;
  }

  if ("twapHistory" in event) {
    return event.twapHistory.at(-1)?.time ?? null;
  }

  return event.twapSliceFills.at(-1)?.fill.time ?? null;
}
