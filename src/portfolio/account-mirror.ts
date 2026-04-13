import type {
  ClearinghouseStateResponse,
  SpotClearinghouseStateResponse,
  UserRateLimitResponse
} from "@nktkas/hyperliquid/api/info";
import type { Address } from "viem";

import type { NetworkName } from "../core/types.js";
import type { AssetRegistry } from "../exchange/asset-registry.js";

export type ExchangeSnapshotSource = "rest_reconciliation" | "websocket_stream";
export type MirrorStaleness = "fresh" | "stale";

export interface MarginSummarySnapshot {
  readonly accountValue: string;
  readonly totalNotionalPosition: string;
  readonly totalRawUsd: string;
  readonly totalMarginUsed: string;
}

export interface UserRateLimitSnapshot {
  readonly cumulativeVolume: string;
  readonly requestsUsed: number;
  readonly requestsCap: number;
  readonly requestsSurplus: number;
}

export interface PositionSnapshot {
  readonly assetId: number;
  readonly marketSymbol: string;
  readonly size: string;
  readonly direction: "long" | "short";
  readonly entryPrice: string;
  readonly positionValue: string;
  readonly unrealizedPnl: string;
  readonly returnOnEquity: string;
  readonly liquidationPrice: string | null;
  readonly marginUsed: string;
  readonly leverageType: "cross" | "isolated";
  readonly leverageValue: number;
  readonly leverageRawUsd: string | null;
  readonly maxLeverage: number;
  readonly cumulativeFunding: {
    readonly allTime: string;
    readonly sinceOpen: string;
    readonly sinceChange: string;
  };
}

export interface SpotBalanceSnapshot {
  readonly tokenIndex: number;
  readonly coin: string;
  readonly total: string;
  readonly hold: string;
  readonly entryNotional: string;
}

export interface AccountMirrorSnapshot {
  readonly operatorAddress: Address;
  readonly network: NetworkName;
  readonly source: ExchangeSnapshotSource;
  readonly syncedAt: string;
  readonly exchangeTimestampMs: number | null;
  readonly staleness: MirrorStaleness;
  readonly marginModeAssumption: "cross-only-mvp";
  readonly marginSummary: MarginSummarySnapshot;
  readonly crossMarginSummary: MarginSummarySnapshot;
  readonly crossMaintenanceMarginUsed: string;
  readonly withdrawable: string;
  readonly positions: readonly PositionSnapshot[];
  readonly spotBalances: readonly SpotBalanceSnapshot[];
  readonly rateLimit?: UserRateLimitSnapshot;
}

export interface NormalizeAccountSnapshotArgs {
  readonly operatorAddress: Address;
  readonly network: NetworkName;
  readonly source: ExchangeSnapshotSource;
  readonly syncedAt: string;
  readonly registry: AssetRegistry;
  readonly clearinghouseState: ClearinghouseStateResponse;
  readonly spotState: SpotClearinghouseStateResponse;
  readonly userRateLimit?: UserRateLimitResponse;
}

export interface ApplyPerpStateArgs {
  readonly syncedAt: string;
  readonly registry: AssetRegistry;
  readonly clearinghouseState: ClearinghouseStateResponse;
}

export interface ApplySpotStateArgs {
  readonly syncedAt: string;
  readonly spotState: SpotClearinghouseStateResponse;
}

export class AccountStateMirror {
  private current: AccountMirrorSnapshot | undefined;

  getSnapshot(): AccountMirrorSnapshot | undefined {
    return this.current;
  }

  replace(snapshot: AccountMirrorSnapshot): void {
    this.current = snapshot;
  }

  applyPerpState(args: ApplyPerpStateArgs): void {
    if (this.current === undefined) {
      return;
    }

    this.current = {
      ...this.current,
      source: "websocket_stream",
      syncedAt: args.syncedAt,
      exchangeTimestampMs: args.clearinghouseState.time,
      staleness: "fresh",
      marginSummary: normalizeMarginSummary(args.clearinghouseState.marginSummary),
      crossMarginSummary: normalizeMarginSummary(args.clearinghouseState.crossMarginSummary),
      crossMaintenanceMarginUsed: args.clearinghouseState.crossMaintenanceMarginUsed,
      withdrawable: args.clearinghouseState.withdrawable,
      positions: normalizePositions(args.registry, args.clearinghouseState)
    };
  }

  applySpotState(args: ApplySpotStateArgs): void {
    if (this.current === undefined) {
      return;
    }

    this.current = {
      ...this.current,
      source: "websocket_stream",
      syncedAt: args.syncedAt,
      staleness: "fresh",
      spotBalances: normalizeSpotBalances(args.spotState)
    };
  }

  markStale(): void {
    if (this.current === undefined) {
      return;
    }

    this.current = {
      ...this.current,
      staleness: "stale"
    };
  }
}

export function normalizeAccountSnapshot(args: NormalizeAccountSnapshotArgs): AccountMirrorSnapshot {
  return {
    operatorAddress: args.operatorAddress,
    network: args.network,
    source: args.source,
    syncedAt: args.syncedAt,
    exchangeTimestampMs: args.clearinghouseState.time,
    staleness: "fresh",
    marginModeAssumption: "cross-only-mvp",
    marginSummary: normalizeMarginSummary(args.clearinghouseState.marginSummary),
    crossMarginSummary: normalizeMarginSummary(args.clearinghouseState.crossMarginSummary),
    crossMaintenanceMarginUsed: args.clearinghouseState.crossMaintenanceMarginUsed,
    withdrawable: args.clearinghouseState.withdrawable,
    positions: normalizePositions(args.registry, args.clearinghouseState),
    spotBalances: normalizeSpotBalances(args.spotState),
    ...(args.userRateLimit !== undefined ? { rateLimit: normalizeUserRateLimit(args.userRateLimit) } : {})
  };
}

export function normalizePositions(
  registry: AssetRegistry,
  clearinghouseState: ClearinghouseStateResponse
): readonly PositionSnapshot[] {
  return clearinghouseState.assetPositions.map(({ position }) => {
    const asset = registry.requirePerpBySymbol(position.coin);
    const direction = position.szi.startsWith("-") ? "short" : "long";

    return {
      assetId: asset.assetId,
      marketSymbol: position.coin,
      size: position.szi,
      direction,
      entryPrice: position.entryPx,
      positionValue: position.positionValue,
      unrealizedPnl: position.unrealizedPnl,
      returnOnEquity: position.returnOnEquity,
      liquidationPrice: position.liquidationPx,
      marginUsed: position.marginUsed,
      leverageType: position.leverage.type,
      leverageValue: position.leverage.value,
      leverageRawUsd: "rawUsd" in position.leverage ? position.leverage.rawUsd : null,
      maxLeverage: position.maxLeverage,
      cumulativeFunding: {
        allTime: position.cumFunding.allTime,
        sinceOpen: position.cumFunding.sinceOpen,
        sinceChange: position.cumFunding.sinceChange
      }
    };
  });
}

export function normalizeSpotBalances(
  spotState: SpotClearinghouseStateResponse
): readonly SpotBalanceSnapshot[] {
  return spotState.balances.map((balance) => ({
    tokenIndex: balance.token,
    coin: balance.coin,
    total: balance.total,
    hold: balance.hold,
    entryNotional: balance.entryNtl
  }));
}

export function normalizeMarginSummary(
  summary: ClearinghouseStateResponse["marginSummary"]
): MarginSummarySnapshot {
  return {
    accountValue: summary.accountValue,
    totalNotionalPosition: summary.totalNtlPos,
    totalRawUsd: summary.totalRawUsd,
    totalMarginUsed: summary.totalMarginUsed
  };
}

export function normalizeUserRateLimit(rateLimit: UserRateLimitResponse): UserRateLimitSnapshot {
  return {
    cumulativeVolume: rateLimit.cumVlm,
    requestsUsed: rateLimit.nRequestsUsed,
    requestsCap: rateLimit.nRequestsCap,
    requestsSurplus: rateLimit.nRequestsSurplus
  };
}
