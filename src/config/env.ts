import * as dotenv from "dotenv";
import { resolve as resolvePath } from "node:path";

import { getAddress, isAddress, type Address, type Hex } from "viem";
import { z, type ZodError } from "zod";

import { ConfigurationError } from "../core/errors.js";
import type { AppConfig, AppEnvironment, LogLevel, NetworkName } from "../core/types.js";
import { deduplicateMarkets, FOUNDATION_MARKETS, FoundationMarketSchema } from "./markets.js";
import { resolveNetworkConfig } from "./networks.js";

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
  VANTA_BOOTSTRAP_USER_STATE: booleanish(true)
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
