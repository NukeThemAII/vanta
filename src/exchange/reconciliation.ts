import type { AssetRegistrySnapshot, PerpAssetRecord, SpotAssetRecord, SpotTokenRecord } from "./asset-registry.js";
import { asJsonValue } from "../core/types.js";
import type { AccountMirrorSnapshot } from "../portfolio/account-mirror.js";
import type { OpenOrderStateSnapshot } from "./open-order-mirror.js";
import type { RuntimeTrustState } from "../core/trust-state.js";
import type { JsonValue } from "../core/types.js";
import type { OrderStateRecord } from "./execution-types.js";

export type ReconciliationTrigger = "startup" | "manual" | "ws_reconnect" | "uncertainty";
export type ReconciliationIssueSeverity = "info" | "warn" | "error";

export interface ReconciliationIssue {
  readonly severity: ReconciliationIssueSeverity;
  readonly issueType: string;
  readonly entityType: "asset" | "position" | "balance" | "order" | "account" | "system";
  readonly entityKey: string;
  readonly message: string;
  readonly localValue?: JsonValue;
  readonly exchangeValue?: JsonValue;
}

export interface ReconciliationSummary {
  readonly issueCount: number;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
}

export function diffAssetRegistry(
  previousSnapshot: AssetRegistrySnapshot | undefined,
  currentSnapshot: AssetRegistrySnapshot
): readonly ReconciliationIssue[] {
  if (previousSnapshot === undefined) {
    return [];
  }

  return diffKeyedCollections(
    previousSnapshot.perps.map(toComparablePerpAssetRecord),
    currentSnapshot.perps.map(toComparablePerpAssetRecord),
    (entry) => `${entry.kind}:${entry.assetId}`,
    "asset",
    "asset_registry_perp"
  ).concat(
    diffKeyedCollections(
      previousSnapshot.spots.map(toComparableSpotAssetRecord),
      currentSnapshot.spots.map(toComparableSpotAssetRecord),
      (entry) => `${entry.kind}:${entry.assetId}`,
      "asset",
      "asset_registry_spot"
    ),
    diffKeyedCollections(
      previousSnapshot.spotTokens.map(toComparableSpotTokenRecord),
      currentSnapshot.spotTokens.map(toComparableSpotTokenRecord),
      (token) => `spot_token:${token.tokenIndex}`,
      "asset",
      "asset_registry_spot_token"
    )
  );
}

export function diffAccountSnapshots(
  previousSnapshot: AccountMirrorSnapshot | undefined,
  currentSnapshot: AccountMirrorSnapshot
): readonly ReconciliationIssue[] {
  if (previousSnapshot === undefined) {
    return [];
  }

  const issues: ReconciliationIssue[] = [];

  if (previousSnapshot.marginModeAssumption !== currentSnapshot.marginModeAssumption) {
    issues.push({
      severity: "warn",
      issueType: "account_margin_mode_changed",
      entityType: "account",
      entityKey: currentSnapshot.operatorAddress,
      message: "Account margin-mode assumption changed between snapshots",
      localValue: previousSnapshot.marginModeAssumption,
      exchangeValue: currentSnapshot.marginModeAssumption
    });
  }

  issues.push(
    ...diffKeyedCollections(
      previousSnapshot.positions,
      currentSnapshot.positions,
      (position) => position.marketSymbol,
      "position",
      "position",
      {
        addedSeverity: "error",
        removedSeverity: "error",
        changedSeverity: "error"
      }
    )
  );

  issues.push(
    ...diffKeyedCollections(
      previousSnapshot.spotBalances,
      currentSnapshot.spotBalances,
      (balance) => `${balance.tokenIndex}:${balance.coin}`,
      "balance",
      "balance"
    )
  );

  return issues;
}

export function diffOpenOrderSnapshots(
  previousSnapshot: OpenOrderStateSnapshot | undefined,
  currentSnapshot: OpenOrderStateSnapshot
): readonly ReconciliationIssue[] {
  if (previousSnapshot === undefined) {
    return [];
  }

  return diffKeyedCollections(
    previousSnapshot.orders,
    currentSnapshot.orders,
    (order) => `${order.orderId}:${order.clientOrderId ?? "no-cloid"}`,
    "order",
    "open_order"
  );
}

export function diffActiveOrderStatesAgainstOpenOrders(
  localActiveStates: readonly OrderStateRecord[],
  currentSnapshot: OpenOrderStateSnapshot
): readonly ReconciliationIssue[] {
  const issues: ReconciliationIssue[] = [];

  for (const localState of localActiveStates) {
    const exchangeOrder = currentSnapshot.orders.find((order) => matchesOpenOrder(localState, order));

    if (exchangeOrder === undefined) {
      issues.push({
        severity: "error",
        issueType: "local_active_order_missing_on_exchange",
        entityType: "order",
        entityKey: localState.orderKey,
        message: "Local non-terminal order state is missing from the exchange open-order snapshot",
        localValue: asJsonValue(localState)
      });
      continue;
    }

    const localComparable = {
      marketSymbol: localState.marketSymbol,
      assetId: localState.assetId,
      side: localState.side ?? null,
      limitPrice: localState.limitPrice ?? null,
      originalSize: localState.originalSize ?? null
    };
    const exchangeComparable = {
      marketSymbol: exchangeOrder.marketSymbol,
      assetId: exchangeOrder.assetId,
      side: exchangeOrder.side,
      limitPrice: exchangeOrder.limitPrice,
      originalSize: exchangeOrder.originalSize
    };

    if (JSON.stringify(localComparable) !== JSON.stringify(exchangeComparable)) {
      issues.push({
        severity: "warn",
        issueType: "local_active_order_changed_vs_exchange",
        entityType: "order",
        entityKey: localState.orderKey,
        message: "Local non-terminal order details differ from the exchange open-order snapshot",
        localValue: asJsonValue(localComparable),
        exchangeValue: asJsonValue(exchangeComparable)
      });
    }
  }

  for (const exchangeOrder of currentSnapshot.orders) {
    const localState = localActiveStates.find((state) => matchesOpenOrder(state, exchangeOrder));

    if (localState === undefined) {
      issues.push({
        severity: "error",
        issueType: "exchange_open_order_missing_locally",
        entityType: "order",
        entityKey: deriveOpenOrderKey(exchangeOrder.orderId, exchangeOrder.clientOrderId),
        message: "Exchange open order is missing from local non-terminal order state records",
        exchangeValue: asJsonValue(exchangeOrder)
      });
    }
  }

  return issues;
}

export function summarizeReconciliationIssues(
  issues: readonly ReconciliationIssue[]
): ReconciliationSummary {
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;

  for (const issue of issues) {
    if (issue.severity === "error") {
      errorCount += 1;
      continue;
    }

    if (issue.severity === "warn") {
      warningCount += 1;
      continue;
    }

    infoCount += 1;
  }

  return {
    issueCount: issues.length,
    errorCount,
    warningCount,
    infoCount
  };
}

export function determineTrustStateAfterReconciliation(args: {
  readonly operatorConfigured: boolean;
  readonly issues: readonly ReconciliationIssue[];
}): RuntimeTrustState {
  if (!args.operatorConfigured) {
    return "degraded";
  }

  const hasErrors = args.issues.some((issue) => issue.severity === "error");
  return hasErrors ? "untrusted" : "trusted";
}

function diffKeyedCollections<T>(
  previousItems: readonly T[],
  currentItems: readonly T[],
  keySelector: (item: T) => string,
  entityType: ReconciliationIssue["entityType"],
  issuePrefix: string,
  severityOverrides?: {
    readonly addedSeverity?: ReconciliationIssueSeverity;
    readonly removedSeverity?: ReconciliationIssueSeverity;
    readonly changedSeverity?: ReconciliationIssueSeverity;
  }
): ReconciliationIssue[] {
  const previousByKey = new Map(previousItems.map((item) => [keySelector(item), item] as const));
  const currentByKey = new Map(currentItems.map((item) => [keySelector(item), item] as const));
  const keys = new Set([...previousByKey.keys(), ...currentByKey.keys()]);
  const issues: ReconciliationIssue[] = [];

  for (const key of keys) {
    const previous = previousByKey.get(key);
    const current = currentByKey.get(key);

    if (previous === undefined && current !== undefined) {
      issues.push({
        severity: severityOverrides?.addedSeverity ?? "warn",
        issueType: `${issuePrefix}_added`,
        entityType,
        entityKey: key,
        message: `${entityType} was added relative to the previous persisted snapshot`,
        exchangeValue: asJsonValue(current)
      });
      continue;
    }

    if (previous !== undefined && current === undefined) {
      issues.push({
        severity: severityOverrides?.removedSeverity ?? "warn",
        issueType: `${issuePrefix}_removed`,
        entityType,
        entityKey: key,
        message: `${entityType} was removed relative to the previous persisted snapshot`,
        localValue: asJsonValue(previous)
      });
      continue;
    }

    if (previous !== undefined && current !== undefined && JSON.stringify(previous) !== JSON.stringify(current)) {
      issues.push({
        severity: severityOverrides?.changedSeverity ?? "warn",
        issueType: `${issuePrefix}_changed`,
        entityType,
        entityKey: key,
        message: `${entityType} changed relative to the previous persisted snapshot`,
        localValue: asJsonValue(previous),
        exchangeValue: asJsonValue(current)
      });
    }
  }

  return issues;
}

function matchesOpenOrder(
  state: Pick<OrderStateRecord, "orderId" | "clientOrderId">,
  order: OpenOrderStateSnapshot["orders"][number]
): boolean {
  return (
    (state.orderId !== undefined && state.orderId === order.orderId)
    || (
      state.clientOrderId !== undefined
      && order.clientOrderId !== null
      && state.clientOrderId === order.clientOrderId
    )
  );
}

function deriveOpenOrderKey(orderId: number, clientOrderId: string | null): string {
  if (clientOrderId !== null) {
    return `cloid:${clientOrderId}`;
  }

  return `oid:${orderId}`;
}

function toComparablePerpAssetRecord(record: PerpAssetRecord) {
  return {
    kind: record.kind,
    assetId: record.assetId,
    symbol: record.symbol,
    name: record.name,
    maxLeverage: record.maxLeverage,
    marginTableId: record.marginTableId,
    onlyIsolated: record.onlyIsolated,
    marginMode: record.marginMode,
    precision: record.precision
  };
}

function toComparableSpotAssetRecord(record: SpotAssetRecord) {
  return {
    kind: record.kind,
    assetId: record.assetId,
    symbol: record.symbol,
    name: record.name,
    pairIndex: record.pairIndex,
    baseTokenIndex: record.baseTokenIndex,
    quoteTokenIndex: record.quoteTokenIndex,
    baseSymbol: record.baseSymbol,
    quoteSymbol: record.quoteSymbol,
    isCanonical: record.isCanonical,
    precision: record.precision
  };
}

function toComparableSpotTokenRecord(record: SpotTokenRecord) {
  return {
    tokenIndex: record.tokenIndex,
    symbol: record.symbol,
    fullName: record.fullName,
    tokenId: record.tokenId,
    sizeDecimals: record.sizeDecimals,
    weiDecimals: record.weiDecimals,
    isCanonical: record.isCanonical,
    evmContractAddress: record.evmContractAddress,
    evmExtraWeiDecimals: record.evmExtraWeiDecimals,
    deployerTradingFeeShare: record.deployerTradingFeeShare
  };
}
