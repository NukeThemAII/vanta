import type {
  MetaAndAssetCtxsResponse,
  SpotMetaAndAssetCtxsResponse
} from "@nktkas/hyperliquid/api/info";
import type { Address, Hex } from "viem";

import { BootstrapError } from "../core/errors.js";
import type { NetworkName } from "../core/types.js";

export type AssetKind = "perp" | "spot";

export interface PrecisionConstraints {
  readonly sizeDecimals: number;
  readonly priceMaxDecimals: number;
  readonly maxSignificantFigures: 5;
}

export interface PerpAssetRecord {
  readonly kind: "perp";
  readonly assetId: number;
  readonly symbol: string;
  readonly name: string;
  readonly maxLeverage: number;
  readonly marginTableId: number;
  readonly onlyIsolated: boolean;
  readonly marginMode: string | null;
  readonly precision: PrecisionConstraints;
  readonly context: {
    readonly markPrice: string;
    readonly midPrice: string | null;
    readonly oraclePrice: string;
    readonly fundingRate: string;
    readonly openInterest: string;
    readonly dayNotionalVolume: string;
    readonly dayBaseVolume: string;
  };
}

export interface SpotTokenRecord {
  readonly tokenIndex: number;
  readonly symbol: string;
  readonly fullName: string | null;
  readonly tokenId: Hex;
  readonly sizeDecimals: number;
  readonly weiDecimals: number;
  readonly isCanonical: boolean;
  readonly evmContractAddress: Address | null;
  readonly evmExtraWeiDecimals: number | null;
  readonly deployerTradingFeeShare: string;
}

export interface SpotAssetRecord {
  readonly kind: "spot";
  readonly assetId: number;
  readonly symbol: string;
  readonly name: string;
  readonly pairIndex: number;
  readonly baseTokenIndex: number;
  readonly quoteTokenIndex: number;
  readonly baseSymbol: string;
  readonly quoteSymbol: string;
  readonly isCanonical: boolean;
  readonly precision: PrecisionConstraints;
  readonly context: {
    readonly markPrice: string;
    readonly midPrice: string | null;
    readonly prevDayPrice: string;
    readonly circulatingSupply: string;
    readonly dayNotionalVolume: string;
    readonly dayBaseVolume: string;
  };
}

export interface AssetRegistrySnapshot {
  readonly createdAt: string;
  readonly network: NetworkName;
  readonly perps: readonly PerpAssetRecord[];
  readonly spots: readonly SpotAssetRecord[];
  readonly spotTokens: readonly SpotTokenRecord[];
}

export type AssetRegistryEntry = PerpAssetRecord | SpotAssetRecord;

export interface BuildAssetRegistryArgs {
  readonly createdAt?: string;
  readonly network: NetworkName;
  readonly perpMetaAndAssetCtxs: MetaAndAssetCtxsResponse;
  readonly spotMetaAndAssetCtxs: SpotMetaAndAssetCtxsResponse;
}

export class AssetRegistry {
  private readonly byAssetId = new Map<number, AssetRegistryEntry>();
  private readonly bySymbol = new Map<string, AssetRegistryEntry>();
  private readonly spotTokensByIndex = new Map<number, SpotTokenRecord>();

  constructor(private readonly snapshot: AssetRegistrySnapshot) {
    for (const token of snapshot.spotTokens) {
      if (this.spotTokensByIndex.has(token.tokenIndex)) {
        throw new BootstrapError(`Duplicate spot token index in registry: ${token.tokenIndex}`);
      }

      this.spotTokensByIndex.set(token.tokenIndex, token);
    }

    for (const entry of [...snapshot.perps, ...snapshot.spots]) {
      if (this.byAssetId.has(entry.assetId)) {
        throw new BootstrapError(`Duplicate asset id in registry: ${entry.assetId}`);
      }

      if (this.bySymbol.has(entry.symbol)) {
        throw new BootstrapError(`Duplicate asset symbol in registry: ${entry.symbol}`);
      }

      this.byAssetId.set(entry.assetId, entry);
      this.bySymbol.set(entry.symbol, entry);
    }
  }

  static build(args: BuildAssetRegistryArgs): AssetRegistry {
    return new AssetRegistry(buildAssetRegistrySnapshot(args));
  }

  getSnapshot(): AssetRegistrySnapshot {
    return this.snapshot;
  }

  listEntries(): readonly AssetRegistryEntry[] {
    return [...this.snapshot.perps, ...this.snapshot.spots];
  }

  listPerps(): readonly PerpAssetRecord[] {
    return this.snapshot.perps;
  }

  listSpots(): readonly SpotAssetRecord[] {
    return this.snapshot.spots;
  }

  getByAssetId(assetId: number): AssetRegistryEntry | undefined {
    return this.byAssetId.get(assetId);
  }

  getBySymbol(symbol: string): AssetRegistryEntry | undefined {
    return this.bySymbol.get(symbol);
  }

  getPerpBySymbol(symbol: string): PerpAssetRecord | undefined {
    const entry = this.bySymbol.get(symbol);
    return entry?.kind === "perp" ? entry : undefined;
  }

  getSpotBySymbol(symbol: string): SpotAssetRecord | undefined {
    const entry = this.bySymbol.get(symbol);
    return entry?.kind === "spot" ? entry : undefined;
  }

  getSpotToken(tokenIndex: number): SpotTokenRecord | undefined {
    return this.spotTokensByIndex.get(tokenIndex);
  }

  requireBySymbol(symbol: string): AssetRegistryEntry {
    const entry = this.getBySymbol(symbol);

    if (entry === undefined) {
      throw new BootstrapError(`Unknown asset symbol in registry lookup: ${symbol}`);
    }

    return entry;
  }

  requirePerpBySymbol(symbol: string): PerpAssetRecord {
    const entry = this.getPerpBySymbol(symbol);

    if (entry === undefined) {
      throw new BootstrapError(`Unknown perp asset symbol in registry lookup: ${symbol}`);
    }

    return entry;
  }
}

export function buildAssetRegistrySnapshot(args: BuildAssetRegistryArgs): AssetRegistrySnapshot {
  const createdAt = args.createdAt ?? new Date().toISOString();
  const [perpMeta, perpAssetCtxs] = args.perpMetaAndAssetCtxs;
  const [spotMeta, spotAssetCtxs] = args.spotMetaAndAssetCtxs;

  const spotTokens: SpotTokenRecord[] = spotMeta.tokens.map((token) => ({
    tokenIndex: token.index,
    symbol: token.name,
    fullName: token.fullName,
    tokenId: token.tokenId,
    sizeDecimals: token.szDecimals,
    weiDecimals: token.weiDecimals,
    isCanonical: token.isCanonical,
    evmContractAddress: token.evmContract?.address ?? null,
    evmExtraWeiDecimals: token.evmContract?.evm_extra_wei_decimals ?? null,
    deployerTradingFeeShare: token.deployerTradingFeeShare
  }));

  const spotTokensByIndex = new Map(spotTokens.map((token) => [token.tokenIndex, token] as const));

  const perps: PerpAssetRecord[] = perpMeta.universe.map((market, assetId) => {
    const assetContext = perpAssetCtxs[assetId];

    if (assetContext === undefined) {
      throw new BootstrapError(`Missing perp asset context for ${market.name}`);
    }

    return {
      kind: "perp",
      assetId,
      symbol: market.name,
      name: market.name,
      maxLeverage: market.maxLeverage,
      marginTableId: market.marginTableId,
      onlyIsolated: market.onlyIsolated === true,
      marginMode: market.marginMode ?? null,
      precision: {
        sizeDecimals: market.szDecimals,
        priceMaxDecimals: computePriceMaxDecimals("perp", market.szDecimals),
        maxSignificantFigures: 5
      },
      context: {
        markPrice: assetContext.markPx,
        midPrice: assetContext.midPx,
        oraclePrice: assetContext.oraclePx,
        fundingRate: assetContext.funding,
        openInterest: assetContext.openInterest,
        dayNotionalVolume: assetContext.dayNtlVlm,
        dayBaseVolume: assetContext.dayBaseVlm
      }
    };
  });

  const spots: SpotAssetRecord[] = spotMeta.universe.map((pair, index) => {
    const assetContext = spotAssetCtxs[index];

    if (assetContext === undefined) {
      throw new BootstrapError(`Missing spot asset context for ${pair.name}`);
    }

    const baseTokenIndex = pair.tokens[0];
    const quoteTokenIndex = pair.tokens[1];

    if (baseTokenIndex === undefined || quoteTokenIndex === undefined) {
      throw new BootstrapError(`Spot pair ${pair.name} does not expose both base and quote token indices`);
    }

    const baseToken = baseTokenIndex === undefined ? undefined : spotTokensByIndex.get(baseTokenIndex);
    const quoteToken = quoteTokenIndex === undefined ? undefined : spotTokensByIndex.get(quoteTokenIndex);

    if (baseToken === undefined || quoteToken === undefined) {
      throw new BootstrapError(`Incomplete token metadata for spot pair ${pair.name}`);
    }

    return {
      kind: "spot",
      assetId: 10000 + pair.index,
      symbol: pair.name,
      name: pair.name,
      pairIndex: pair.index,
      baseTokenIndex,
      quoteTokenIndex,
      baseSymbol: baseToken.symbol,
      quoteSymbol: quoteToken.symbol,
      isCanonical: pair.isCanonical,
      precision: {
        // Inference: spot pair sizes are denominated in the base token and `spotMeta` exposes szDecimals on tokens.
        sizeDecimals: baseToken.sizeDecimals,
        priceMaxDecimals: computePriceMaxDecimals("spot", baseToken.sizeDecimals),
        maxSignificantFigures: 5
      },
      context: {
        markPrice: assetContext.markPx,
        midPrice: assetContext.midPx,
        prevDayPrice: assetContext.prevDayPx,
        circulatingSupply: assetContext.circulatingSupply,
        dayNotionalVolume: assetContext.dayNtlVlm,
        dayBaseVolume: assetContext.dayBaseVlm
      }
    };
  });

  return {
    createdAt,
    network: args.network,
    perps,
    spots,
    spotTokens
  };
}

function computePriceMaxDecimals(kind: AssetKind, sizeDecimals: number): number {
  const maxDecimals = kind === "perp" ? 6 : 8;
  return Math.max(0, maxDecimals - sizeDecimals);
}
