import type { UserFillsResponse } from "@nktkas/hyperliquid/api/info";
import type { UserFillsEvent } from "@nktkas/hyperliquid/api/subscription";
import type { Address, Hex } from "viem";

import { normalizeDecimalString } from "../core/decimal.js";
import type { NetworkName } from "../core/types.js";
import type { AssetKind, AssetRegistry } from "../exchange/asset-registry.js";

export interface FillRecord {
  readonly fillKey: string;
  readonly operatorAddress: Address;
  readonly network: NetworkName;
  readonly recordedAt: string;
  readonly exchangeTimestampMs: number;
  readonly marketSymbol: string;
  readonly assetId: number;
  readonly marketType: AssetKind;
  readonly orderId: number;
  readonly transactionId: number;
  readonly side: "buy" | "sell";
  readonly price: string;
  readonly size: string;
  readonly startPosition: string;
  readonly direction: string;
  readonly closedPnl: string;
  readonly fee: string;
  readonly builderFee?: string;
  readonly feeToken: string;
  readonly hash: Hex;
  readonly crossed: boolean;
  readonly isSnapshot: boolean;
  readonly clientOrderId?: Hex;
}

export function normalizeUserFills(args: {
  readonly operatorAddress: Address;
  readonly network: NetworkName;
  readonly registry: AssetRegistry;
  readonly fills: UserFillsResponse | UserFillsEvent["fills"];
  readonly isSnapshot: boolean;
  readonly recordedAt: string;
}): readonly FillRecord[] {
  return args.fills.map((fill) => {
    const asset = args.registry.requireBySymbol(fill.coin);

    return {
      fillKey: deriveFillKey(args.operatorAddress, fill.tid),
      operatorAddress: args.operatorAddress,
      network: args.network,
      recordedAt: args.recordedAt,
      exchangeTimestampMs: fill.time,
      marketSymbol: fill.coin,
      assetId: asset.assetId,
      marketType: asset.kind,
      orderId: fill.oid,
      transactionId: fill.tid,
      side: fill.side === "B" ? "buy" : "sell",
      price: normalizeDecimalString(fill.px),
      size: normalizeDecimalString(fill.sz),
      startPosition: normalizeDecimalString(fill.startPosition),
      direction: fill.dir,
      closedPnl: normalizeDecimalString(fill.closedPnl),
      fee: normalizeDecimalString(fill.fee),
      ...(fill.builderFee !== undefined ? { builderFee: normalizeDecimalString(fill.builderFee) } : {}),
      feeToken: fill.feeToken,
      hash: fill.hash,
      crossed: fill.crossed,
      isSnapshot: args.isSnapshot,
      ...(fill.cloid !== undefined ? { clientOrderId: fill.cloid } : {})
    };
  });
}

export function deriveFillKey(operatorAddress: Address, transactionId: number): string {
  return `${operatorAddress}:${transactionId}`;
}
