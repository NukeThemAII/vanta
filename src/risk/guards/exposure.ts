import { formatSize } from "@nktkas/hyperliquid/utils";

import {
  absDecimalString,
  compareDecimalStrings,
  divideDecimalStrings,
  minDecimalStrings,
  multiplyDecimalStrings,
  normalizeDecimalString,
  subtractDecimalStrings
} from "../../core/decimal.js";
import type { RiskConfig } from "../../core/types.js";
import type { PerpAssetRecord } from "../../exchange/asset-registry.js";
import type {
  EntryRiskRequest,
  ExecutionOrderSide,
  FormattedOrderRequest,
  OrderStateRecord
} from "../../exchange/execution-types.js";
import type { AccountMirrorSnapshot } from "../../portfolio/account-mirror.js";

export interface ExposureGuardResult {
  readonly ok: boolean;
  readonly message: string;
  readonly requestedNotionalUsd?: string;
}

export interface StopSizingGuardResult {
  readonly ok: boolean;
  readonly decision: "approved" | "adjusted" | "rejected";
  readonly message: string;
  readonly approvedSize: string;
  readonly requestedSize: string;
  readonly maxSize?: string;
  readonly stopLossPrice?: string;
  readonly riskBudgetUsd?: string;
}

export function evaluateOpenOrderLimit(args: {
  readonly activeOrders: readonly OrderStateRecord[];
  readonly maxOpenOrders: number;
}): ExposureGuardResult {
  if (args.activeOrders.length >= args.maxOpenOrders) {
    return {
      ok: false,
      message: `Active order count ${args.activeOrders.length} exceeds configured limit ${args.maxOpenOrders}`
    };
  }

  return {
    ok: true,
    message: "Active order count is within the configured limit"
  };
}

export function evaluateConcurrentPositionLimit(args: {
  readonly accountSnapshot: AccountMirrorSnapshot;
  readonly maxConcurrentPositions: number;
  readonly marketSymbol: string;
  readonly reduceOnly: boolean;
}): ExposureGuardResult {
  if (args.reduceOnly) {
    return {
      ok: true,
      message: "Reduce-only order skipped by concurrent-position guard"
    };
  }

  const activePositionCount = args.accountSnapshot.positions.filter((position) =>
    compareDecimalStrings(position.size, "0") !== 0
  ).length;
  const hasExistingPosition = args.accountSnapshot.positions.some((position) =>
    position.marketSymbol === args.marketSymbol && compareDecimalStrings(position.size, "0") !== 0
  );

  if (!hasExistingPosition && activePositionCount >= args.maxConcurrentPositions) {
    return {
      ok: false,
      message: `Concurrent position count ${activePositionCount} exceeds configured limit ${args.maxConcurrentPositions}`
    };
  }

  return {
    ok: true,
    message: "Concurrent position count is within the configured limit"
  };
}

export function evaluateMaxOrderNotional(args: {
  readonly order: FormattedOrderRequest;
  readonly maxOrderNotionalUsd: string;
}): ExposureGuardResult {
  if (args.order.reduceOnly) {
    return {
      ok: true,
      message: "Reduce-only order skipped by max-notional guard",
      requestedNotionalUsd: multiplyDecimalStrings(args.order.price, args.order.size)
    };
  }

  const requestedNotionalUsd = multiplyDecimalStrings(args.order.price, args.order.size);
  if (compareDecimalStrings(requestedNotionalUsd, args.maxOrderNotionalUsd) === 1) {
    return {
      ok: false,
      message: `Order notional ${requestedNotionalUsd} exceeds configured limit ${args.maxOrderNotionalUsd}`,
      requestedNotionalUsd
    };
  }

  return {
    ok: true,
    message: "Order notional is within the configured limit",
    requestedNotionalUsd
  };
}

export function evaluateStopBasedSizing(args: {
  readonly order: FormattedOrderRequest;
  readonly riskConfig: RiskConfig;
  readonly accountSnapshot: AccountMirrorSnapshot;
  readonly asset: PerpAssetRecord;
  readonly riskRequest?: EntryRiskRequest;
}): StopSizingGuardResult {
  if (args.order.reduceOnly) {
    return {
      ok: true,
      decision: "approved",
      message: "Reduce-only order skipped by stop-based sizing guard",
      approvedSize: args.order.size,
      requestedSize: args.order.size
    };
  }

  const stopLossPrice = normalizeOptionalDecimal(args.riskRequest?.stopLossPrice);
  if (stopLossPrice === undefined) {
    if (args.riskConfig.enforceStopLossForEntries) {
      return {
        ok: false,
        decision: "rejected",
        message: "Configured risk policy requires a stop-loss price for new exposure",
        approvedSize: args.order.size,
        requestedSize: args.order.size
      };
    }

    return {
      ok: true,
      decision: "approved",
      message: "No stop-loss sizing requested for this order",
      approvedSize: args.order.size,
      requestedSize: args.order.size
    };
  }

  const stopDistance = resolveStopDistance(args.order.side, args.order.price, stopLossPrice);
  if (compareDecimalStrings(stopDistance, "0") !== 1) {
    return {
      ok: false,
      decision: "rejected",
      message: "Stop-loss price does not define a valid risk distance for the requested side",
      approvedSize: args.order.size,
      requestedSize: args.order.size,
      stopLossPrice
    };
  }

  const riskBudgetUsd = resolveRiskBudgetUsd(
    args.accountSnapshot.marginSummary.accountValue,
    args.riskConfig.defaultRiskFractionOfAccount,
    args.riskRequest
  );
  const rawMaxSize = divideDecimalStrings(riskBudgetUsd, stopDistance, args.asset.precision.sizeDecimals + 6);
  const formattedMaxSize = formatSize(rawMaxSize, args.asset.precision.sizeDecimals);

  if (compareDecimalStrings(formattedMaxSize, "0") !== 1) {
    return {
      ok: false,
      decision: "rejected",
      message: "Stop-based size rounds down to zero for the configured risk budget",
      approvedSize: args.order.size,
      requestedSize: args.order.size,
      maxSize: formattedMaxSize,
      stopLossPrice,
      riskBudgetUsd
    };
  }

  if (compareDecimalStrings(args.order.size, formattedMaxSize) !== 1) {
    return {
      ok: true,
      decision: "approved",
      message: "Order size is within the configured stop-based risk budget",
      approvedSize: args.order.size,
      requestedSize: args.order.size,
      maxSize: formattedMaxSize,
      stopLossPrice,
      riskBudgetUsd
    };
  }

  if (args.riskRequest?.sizingMode === "cap") {
    return {
      ok: true,
      decision: "adjusted",
      message: `Order size capped to ${formattedMaxSize} by the stop-based risk budget`,
      approvedSize: minDecimalStrings(args.order.size, formattedMaxSize),
      requestedSize: args.order.size,
      maxSize: formattedMaxSize,
      stopLossPrice,
      riskBudgetUsd
    };
  }

  return {
    ok: false,
    decision: "rejected",
    message: `Order size ${args.order.size} exceeds stop-based risk budget max ${formattedMaxSize}`,
    approvedSize: args.order.size,
    requestedSize: args.order.size,
    maxSize: formattedMaxSize,
    stopLossPrice,
    riskBudgetUsd
  };
}

function resolveRiskBudgetUsd(
  accountValue: string,
  defaultRiskFractionOfAccount: string,
  riskRequest: EntryRiskRequest | undefined
): string {
  const explicitRiskUsd = normalizeOptionalDecimal(riskRequest?.maxRiskUsd);
  if (explicitRiskUsd !== undefined) {
    return explicitRiskUsd;
  }

  const riskFraction = normalizeOptionalDecimal(riskRequest?.maxRiskFractionOfAccount)
    ?? normalizeDecimalString(defaultRiskFractionOfAccount);

  return multiplyDecimalStrings(accountValue, riskFraction);
}

function resolveStopDistance(
  side: ExecutionOrderSide,
  entryPrice: string,
  stopLossPrice: string
): string {
  const rawDistance =
    side === "buy"
      ? subtractDecimalStrings(entryPrice, stopLossPrice)
      : subtractDecimalStrings(stopLossPrice, entryPrice);

  return absDecimalString(rawDistance);
}

function normalizeOptionalDecimal(value: EntryRiskRequest["stopLossPrice"]): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return normalizeDecimalString(String(value));
}
