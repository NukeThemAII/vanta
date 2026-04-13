import type {
  ClearinghouseStateResponse,
  FrontendOpenOrdersResponse,
  MetaAndAssetCtxsResponse,
  UserRateLimitResponse
} from "@nktkas/hyperliquid/api/info";
import type { Address, Hex } from "viem";

import type { FoundationMarket } from "../config/markets.js";

export const APP_NAME = "vanta-hl";

export type AppEnvironment = "development" | "test" | "production";
export type NetworkName = "testnet" | "mainnet";
export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
export type BootLifecycleStatus = "starting" | "ready" | "stopped" | "failed";
export type AppEventSeverity = "info" | "warn" | "error";
export type MarketEventChannel = "mid" | "trade";

export interface NetworkConfig {
  readonly name: NetworkName;
  readonly isTestnet: boolean;
  readonly apiUrl: string;
  readonly wsUrl: string;
  readonly rpcUrl: string;
  readonly rpcWsUrl: string;
  readonly signatureChain: "Mainnet" | "Testnet";
  readonly signatureChainId: Hex;
  readonly hyperEvmChainId: 998 | 999;
}

export interface ApiWalletConfig {
  readonly privateKey: Hex;
}

export interface AppConfig {
  readonly appEnv: AppEnvironment;
  readonly network: NetworkConfig;
  readonly logLevel: LogLevel;
  readonly sqlitePath: string;
  readonly watchedMarkets: readonly FoundationMarket[];
  readonly operatorAddress?: Address;
  readonly apiWallet?: ApiWalletConfig;
  readonly executionVaultAddress?: Address;
  readonly bootstrapUserState: boolean;
}

export type JsonPrimitive = string | number | boolean | null;

export type JsonArray = JsonValue[] | readonly JsonValue[];

export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export function asJsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

export interface BootMarketSnapshot {
  readonly market: FoundationMarket;
  readonly assetId: number;
  readonly sizeDecimals: number;
  readonly maxLeverage: number;
  readonly marginTableId: number;
  readonly markPrice: string;
  readonly midPrice: string | null;
  readonly oraclePrice: string;
  readonly fundingRate: string;
  readonly openInterest: string;
}

export interface AccountBootstrapSnapshot {
  readonly operatorAddress: Address;
  readonly clearinghouseState: ClearinghouseStateResponse;
  readonly openOrders: FrontendOpenOrdersResponse;
  readonly userRateLimit: UserRateLimitResponse;
}

export interface BootstrapSnapshot {
  readonly fetchedAt: string;
  readonly metaAndAssetCtxs: MetaAndAssetCtxsResponse;
  readonly watchedMarkets: readonly BootMarketSnapshot[];
  readonly allMids: Record<string, string>;
  readonly account?: AccountBootstrapSnapshot;
}

export interface AppBootRecordInput {
  readonly bootId: string;
  readonly startedAt: string;
  readonly appEnv: AppEnvironment;
  readonly network: NetworkName;
  readonly markets: readonly FoundationMarket[];
  readonly operatorAddress?: Address;
}

export interface AppBootStatusUpdate {
  readonly bootId: string;
  readonly completedAt: string;
  readonly status: Exclude<BootLifecycleStatus, "starting">;
  readonly bootstrapSummary?: JsonValue;
  readonly errorMessage?: string;
  readonly stopReason?: string;
}

export interface AppEventRecordInput {
  readonly bootId: string;
  readonly eventTime: string;
  readonly eventType: string;
  readonly severity: AppEventSeverity;
  readonly component: string;
  readonly message: string;
  readonly payload?: JsonValue;
}

export interface MarketEventRecordInput {
  readonly bootId: string;
  readonly receivedAt: string;
  readonly exchangeTimestampMs: number | null;
  readonly market: FoundationMarket;
  readonly channel: MarketEventChannel;
  readonly payload: JsonValue;
}

export interface NormalizedMarketEvent {
  readonly receivedAt: string;
  readonly exchangeTimestampMs: number | null;
  readonly market: FoundationMarket;
  readonly channel: MarketEventChannel;
  readonly payload: JsonValue;
}
