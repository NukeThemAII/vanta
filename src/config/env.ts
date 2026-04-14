import * as dotenv from "dotenv";
import { resolve as resolvePath } from "node:path";

import { getAddress, isAddress, type Address, type Hex } from "viem";
import { z, type ZodError } from "zod";

import { ConfigurationError } from "../core/errors.js";
import type { AppConfig, AppEnvironment, LogLevel, NetworkName } from "../core/types.js";
import { deduplicateMarkets, FOUNDATION_MARKETS, FoundationMarketSchema } from "./markets.js";
import { resolveNetworkConfig } from "./networks.js";
import { DEFAULT_RETENTION_CONFIG } from "./retention.js";
import { DEFAULT_RISK_CONFIG } from "./risk.js";

const APP_ENV_SCHEMA = z.enum(["development", "test", "production"]);
const NETWORK_SCHEMA = z.enum(["testnet", "mainnet"]);
const LOG_LEVEL_SCHEMA = z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);

const ADDRESS_SCHEMA = z
  .string()
  .refine((value) => isAddress(value), "must be a valid EVM address")
  .transform((value): Address => getAddress(value));

const PRIVATE_KEY_SCHEMA = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, "must be a 0x-prefixed 32-byte hex private key")
  .transform((value): Hex => value.toLowerCase() as Hex);

const blankToUndefined = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

const splitCsv = (value: unknown): unknown => {
  const normalized = blankToUndefined(value);

  if (normalized === undefined) {
    return FOUNDATION_MARKETS;
  }

  if (Array.isArray(normalized)) {
    return normalized;
  }

  if (typeof normalized !== "string") {
    return normalized;
  }

  return normalized
    .split(",")
    .map((part) => part.trim().toUpperCase())
    .filter((part) => part.length > 0);
};

const booleanish = (defaultValue: boolean) =>
  z.preprocess(
    (value) => {
      const normalized = blankToUndefined(value);
      if (normalized === undefined) {
        return defaultValue;
      }
      if (typeof normalized === "boolean") {
        return normalized;
      }
      if (typeof normalized === "string") {
        const lowered = normalized.toLowerCase();
        if (lowered === "true") {
          return true;
        }
        if (lowered === "false") {
          return false;
        }
      }
      return normalized;
    },
    z.boolean()
  );

const positiveInteger = (defaultValue: number) =>
  z.preprocess(
    (value) => {
      const normalized = blankToUndefined(value);
      if (normalized === undefined) {
        return defaultValue;
      }
      if (typeof normalized === "number") {
        return normalized;
      }
      if (typeof normalized === "string") {
        return Number(normalized);
      }
      return normalized;
    },
    z.number().int().positive()
  );

const nonNegativeInteger = (defaultValue: number) =>
  z.preprocess(
    (value) => {
      const normalized = blankToUndefined(value);
      if (normalized === undefined) {
        return defaultValue;
      }
      if (typeof normalized === "number") {
        return normalized;
      }
      if (typeof normalized === "string") {
        return Number(normalized);
      }
      return normalized;
    },
    z.number().int().min(0)
  );

const positiveNumber = (defaultValue: number, upperBound?: number) =>
  z.preprocess(
    (value) => {
      const normalized = blankToUndefined(value);
      if (normalized === undefined) {
        return defaultValue;
      }
      if (typeof normalized === "number") {
        return normalized;
      }
      if (typeof normalized === "string") {
        return Number(normalized);
      }
      return normalized;
    },
    upperBound === undefined
      ? z.number().positive()
      : z.number().positive().max(upperBound)
  );

const positiveDecimalString = (defaultValue: string) =>
  z.preprocess(
    (value) => {
      const normalized = blankToUndefined(value);
      return normalized === undefined ? defaultValue : normalized;
    },
    z
      .string()
      .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, "must be a positive decimal string")
      .refine((value) => Number(value) > 0, "must be greater than zero")
  );

const ENV_SCHEMA = z.object({
  VANTA_APP_ENV: z.preprocess(blankToUndefined, APP_ENV_SCHEMA.default("development")),
  VANTA_NETWORK: z.preprocess(blankToUndefined, NETWORK_SCHEMA.default("testnet")),
  VANTA_LOG_LEVEL: z.preprocess(blankToUndefined, LOG_LEVEL_SCHEMA.default("info")),
  VANTA_SQLITE_PATH: z.preprocess(blankToUndefined, z.string().default("./data/vanta.sqlite")),
  VANTA_MARKETS: z.preprocess(
    splitCsv,
    z.array(FoundationMarketSchema).min(1).transform((markets) => deduplicateMarkets(markets))
  ),
  VANTA_OPERATOR_ADDRESS: z.preprocess(blankToUndefined, ADDRESS_SCHEMA.optional()),
  VANTA_API_WALLET_PRIVATE_KEY: z.preprocess(blankToUndefined, PRIVATE_KEY_SCHEMA.optional()),
  VANTA_VAULT_ADDRESS: z.preprocess(blankToUndefined, ADDRESS_SCHEMA.optional()),
  VANTA_BOOTSTRAP_USER_STATE: booleanish(true),
  VANTA_RISK_MAX_ORDER_NOTIONAL_USD: positiveDecimalString(DEFAULT_RISK_CONFIG.maxOrderNotionalUsd),
  VANTA_RISK_MAX_OPEN_ORDERS: positiveInteger(DEFAULT_RISK_CONFIG.maxOpenOrders),
  VANTA_RISK_MAX_CONCURRENT_POSITIONS: positiveInteger(DEFAULT_RISK_CONFIG.maxConcurrentPositions),
  VANTA_RISK_MAX_PRICE_DEVIATION_BPS: positiveInteger(DEFAULT_RISK_CONFIG.maxPriceDeviationBps),
  VANTA_RISK_MARKET_DATA_MAX_MID_AGE_MS: positiveInteger(DEFAULT_RISK_CONFIG.marketDataMaxMidAgeMs),
  VANTA_RISK_MARKET_DATA_MAX_TRADE_AGE_MS: positiveInteger(DEFAULT_RISK_CONFIG.marketDataMaxTradeAgeMs),
  VANTA_RISK_USER_STATE_MAX_SYNC_WAIT_MS: positiveInteger(DEFAULT_RISK_CONFIG.userStateMaxSyncWaitMs),
  VANTA_RISK_MAX_LEVERAGE_FRACTION_OF_EXCHANGE_MAX: positiveNumber(
    DEFAULT_RISK_CONFIG.maxLeverageFractionOfExchangeMax,
    1
  ),
  VANTA_RISK_DEFAULT_FRACTION_OF_ACCOUNT: positiveDecimalString(DEFAULT_RISK_CONFIG.defaultRiskFractionOfAccount),
  VANTA_RISK_MAX_DAILY_REALIZED_DRAWDOWN_USD: positiveDecimalString(DEFAULT_RISK_CONFIG.maxDailyRealizedDrawdownUsd),
  VANTA_RISK_MAX_WEEKLY_REALIZED_DRAWDOWN_USD: positiveDecimalString(DEFAULT_RISK_CONFIG.maxWeeklyRealizedDrawdownUsd),
  VANTA_RISK_CONSECUTIVE_LOSS_COOLDOWN_COUNT: positiveInteger(DEFAULT_RISK_CONFIG.consecutiveLossCooldownCount),
  VANTA_RISK_CONSECUTIVE_LOSS_COOLDOWN_MINUTES: positiveInteger(DEFAULT_RISK_CONFIG.consecutiveLossCooldownMinutes),
  VANTA_RISK_MAX_ABSOLUTE_FUNDING_RATE: positiveDecimalString(DEFAULT_RISK_CONFIG.maxAbsoluteFundingRate),
  VANTA_RISK_MIN_RATE_LIMIT_SURPLUS: nonNegativeInteger(DEFAULT_RISK_CONFIG.minRateLimitSurplus),
  VANTA_RISK_ENFORCE_STOP_LOSS_FOR_ENTRIES: booleanish(DEFAULT_RISK_CONFIG.enforceStopLossForEntries),
  VANTA_RETENTION_MARKET_EVENTS_DAYS: positiveInteger(DEFAULT_RETENTION_CONFIG.marketEventsDays),
  VANTA_RETENTION_RUNTIME_STATE_DAYS: positiveInteger(DEFAULT_RETENTION_CONFIG.runtimeStateDays),
  VANTA_RETENTION_EXECUTION_AUDIT_DAYS: positiveInteger(DEFAULT_RETENTION_CONFIG.executionAuditDays)
});

type ParsedEnvironment = z.infer<typeof ENV_SCHEMA>;

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length === 0 ? "env" : issue.path.join(".");
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

function buildAppConfig(parsed: ParsedEnvironment): AppConfig {
  const network = resolveNetworkConfig(parsed.VANTA_NETWORK as NetworkName);

  return {
    appEnv: parsed.VANTA_APP_ENV as AppEnvironment,
    network,
    logLevel: parsed.VANTA_LOG_LEVEL as LogLevel,
    sqlitePath: resolvePath(process.cwd(), parsed.VANTA_SQLITE_PATH),
    risk: {
      maxOrderNotionalUsd: parsed.VANTA_RISK_MAX_ORDER_NOTIONAL_USD,
      maxOpenOrders: parsed.VANTA_RISK_MAX_OPEN_ORDERS,
      maxConcurrentPositions: parsed.VANTA_RISK_MAX_CONCURRENT_POSITIONS,
      maxPriceDeviationBps: parsed.VANTA_RISK_MAX_PRICE_DEVIATION_BPS,
      marketDataMaxMidAgeMs: parsed.VANTA_RISK_MARKET_DATA_MAX_MID_AGE_MS,
      marketDataMaxTradeAgeMs: parsed.VANTA_RISK_MARKET_DATA_MAX_TRADE_AGE_MS,
      userStateMaxSyncWaitMs: parsed.VANTA_RISK_USER_STATE_MAX_SYNC_WAIT_MS,
      maxLeverageFractionOfExchangeMax: parsed.VANTA_RISK_MAX_LEVERAGE_FRACTION_OF_EXCHANGE_MAX,
      defaultRiskFractionOfAccount: parsed.VANTA_RISK_DEFAULT_FRACTION_OF_ACCOUNT,
      maxDailyRealizedDrawdownUsd: parsed.VANTA_RISK_MAX_DAILY_REALIZED_DRAWDOWN_USD,
      maxWeeklyRealizedDrawdownUsd: parsed.VANTA_RISK_MAX_WEEKLY_REALIZED_DRAWDOWN_USD,
      consecutiveLossCooldownCount: parsed.VANTA_RISK_CONSECUTIVE_LOSS_COOLDOWN_COUNT,
      consecutiveLossCooldownMinutes: parsed.VANTA_RISK_CONSECUTIVE_LOSS_COOLDOWN_MINUTES,
      maxAbsoluteFundingRate: parsed.VANTA_RISK_MAX_ABSOLUTE_FUNDING_RATE,
      minRateLimitSurplus: parsed.VANTA_RISK_MIN_RATE_LIMIT_SURPLUS,
      enforceStopLossForEntries: parsed.VANTA_RISK_ENFORCE_STOP_LOSS_FOR_ENTRIES
    },
    retention: {
      marketEventsDays: parsed.VANTA_RETENTION_MARKET_EVENTS_DAYS,
      runtimeStateDays: parsed.VANTA_RETENTION_RUNTIME_STATE_DAYS,
      executionAuditDays: parsed.VANTA_RETENTION_EXECUTION_AUDIT_DAYS
    },
    watchedMarkets: parsed.VANTA_MARKETS,
    ...(parsed.VANTA_OPERATOR_ADDRESS !== undefined
      ? { operatorAddress: parsed.VANTA_OPERATOR_ADDRESS }
      : {}),
    ...(parsed.VANTA_API_WALLET_PRIVATE_KEY !== undefined
      ? {
          apiWallet: {
            privateKey: parsed.VANTA_API_WALLET_PRIVATE_KEY
          }
        }
      : {}),
    ...(parsed.VANTA_VAULT_ADDRESS !== undefined
      ? { executionVaultAddress: parsed.VANTA_VAULT_ADDRESS }
      : {}),
    bootstrapUserState: parsed.VANTA_BOOTSTRAP_USER_STATE
  };
}

export function parseAppConfig(input: NodeJS.ProcessEnv): AppConfig {
  const result = ENV_SCHEMA.safeParse(input);

  if (!result.success) {
    throw new ConfigurationError(`Invalid environment configuration: ${formatZodError(result.error)}`);
  }

  return buildAppConfig(result.data);
}

export function loadAppConfig(): AppConfig {
  dotenv.config({ quiet: true });
  return parseAppConfig(process.env);
}
