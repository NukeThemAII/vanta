import { bootstrapFoundationApp } from "../app/bootstrap.js";
import { createShutdownSignalListener } from "../app/shutdown.js";
import type { FoundationContainer } from "../app/container.js";
import { multiplyDecimalStrings, normalizeDecimalString } from "../core/decimal.js";
import { ConfigurationError, ExecutionError } from "../core/errors.js";
import { installRuntimePolyfills } from "../core/runtime.js";
import type { ExecutionOrderSide } from "../exchange/execution-types.js";

const DEFAULT_SIZE_BY_MARKET: Readonly<Record<string, string>> = {
  BTC: "0.001",
  ETH: "0.01",
  SOL: "0.1"
};

async function main(): Promise<void> {
  let app: FoundationContainer | undefined;
  let shutdownSignals:
    | ReturnType<typeof createShutdownSignalListener>
    | undefined;
  let stopReason = "smoke_completed";

  try {
    installRuntimePolyfills();
    const args = parseArgs(process.argv.slice(2));

    if (!args.allowWriteActions) {
      throw new ConfigurationError("Refusing write-side smoke run without --allow-write-actions");
    }

    app = bootstrapFoundationApp();
    shutdownSignals = createShutdownSignalListener(app.logger.child({ component: "app.shutdown" }));

    app.signerRegistry.requireExecutionIdentity();
    app.signerRegistry.logExecutionIdentity();

    if (app.config.network.name !== "testnet") {
      throw new ConfigurationError("Phase 3 smoke execution is restricted to testnet");
    }

    await app.foundationService.start();
    void shutdownSignals.waitForSignal().then(async (signal) => {
      stopReason = `signal:${signal}`;
      await app?.foundationService.stop(stopReason);
      process.exitCode = 130;
    });

    if (app.reconciliationService.getCurrentTrustState() !== "trusted") {
      throw new ExecutionError(
        `Smoke execution is blocked because runtime trust is ${app.reconciliationService.getCurrentTrustState()}`
      );
    }

    const registry = app.reconciliationService.getAssetRegistry();
    if (registry === undefined) {
      throw new ExecutionError("Smoke execution requires a loaded asset registry");
    }

    const marketSymbol = args.marketSymbol.toUpperCase();
    const market = registry.requirePerpBySymbol(marketSymbol);
    const side = args.side;
    const size = args.size ?? DEFAULT_SIZE_BY_MARKET[marketSymbol] ?? smallestIncrement(market.precision.sizeDecimals);
    const referencePrice = market.context.midPrice ?? market.context.markPrice ?? market.context.oraclePrice;
    const initialPriceFactor = args.initialPriceFactor ?? defaultInitialFactor(side);
    const modifyPriceFactor = args.skipModify ? undefined : args.modifyPriceFactor ?? defaultModifyFactor(side);
    const initialPrice = multiplyDecimalStrings(referencePrice, initialPriceFactor);
    const modifyPrice =
      modifyPriceFactor !== undefined ? multiplyDecimalStrings(referencePrice, modifyPriceFactor) : undefined;

    app.logger.info(
      {
        marketSymbol,
        side,
        size,
        referencePrice,
        initialPrice,
        modifyPrice: modifyPrice ?? null,
        cancelMode: args.cancelMode,
        setLeverage: args.setLeverage ?? null,
        scheduleCancelMs: args.scheduleCancelMs ?? null
      },
      "Starting testnet execution smoke flow"
    );

    const place = await app.executionEngine.placeOrder(
      {
        marketSymbol,
        side,
        price: initialPrice,
        size,
        timeInForce: "Alo",
        correlationId: `smoke:${marketSymbol}:${Date.now()}`
      },
      app.foundationService.bootId
    );

    await app.executionEngine.refreshOrderStatus({
      clientOrderId: place.clientOrderId
    });

    let state = app.orderStateMachine.getByClientOrderId(place.clientOrderId);
    if (state === undefined || (state.state !== "resting" && state.state !== "submitted")) {
      throw new ExecutionError(
        `Placed smoke order is not resting after acknowledgement; current state is ${state?.state ?? "missing"}`
      );
    }

    let modifyActionId: string | null = null;
    if (modifyPrice !== undefined) {
      const modify = await app.executionEngine.modifyOrder(
        {
          target: {
            marketSymbol,
            clientOrderId: place.clientOrderId
          },
          next: {
            marketSymbol,
            side,
            price: modifyPrice,
            size,
            timeInForce: "Alo"
          }
        },
        app.foundationService.bootId
      );
      modifyActionId = modify.actionId;
    }

    let leverageActionId: string | null = null;
    if (args.setLeverage !== undefined) {
      const leverage = await app.executionEngine.updateLeverage(
        {
          marketSymbol,
          leverage: args.setLeverage,
          isCross: true
        },
        app.foundationService.bootId
      );
      leverageActionId = leverage.actionId;
    }

    let scheduledCancelAt: number | null = null;
    let scheduleCancelActionId: string | null = null;
    if (args.scheduleCancelMs !== undefined) {
      scheduledCancelAt = Date.now() + args.scheduleCancelMs;
      const schedule = await app.executionEngine.scheduleCancel(
        { time: scheduledCancelAt },
        app.foundationService.bootId
      );
      scheduleCancelActionId = schedule.actionId;
    }

    let cancelActionId: string;
    if (args.cancelMode === "order-id") {
      state = app.orderStateMachine.getByClientOrderId(place.clientOrderId);

      if (state?.orderId === undefined) {
        throw new ExecutionError("Cannot cancel by order id because the resting order id is unavailable");
      }

      const cancel = await app.executionEngine.cancelOrder(
        {
          marketSymbol,
          orderId: state.orderId
        },
        app.foundationService.bootId
      );
      cancelActionId = cancel.actionId;
    } else {
      const cancel = await app.executionEngine.cancelOrderByCloid(
        {
          marketSymbol,
          clientOrderId: place.clientOrderId
        },
        app.foundationService.bootId
      );
      cancelActionId = cancel.actionId;
    }

    await app.executionEngine.refreshOrderStatus({
      clientOrderId: place.clientOrderId
    });
    state = app.orderStateMachine.getByClientOrderId(place.clientOrderId);

    let clearScheduleActionId: string | null = null;
    if (scheduledCancelAt !== null) {
      const clearSchedule = await app.executionEngine.scheduleCancel(
        { time: null },
        app.foundationService.bootId
      );
      clearScheduleActionId = clearSchedule.actionId;
    }

    console.log(
      JSON.stringify(
        {
          network: app.config.network.name,
          marketSymbol,
          side,
          size,
          referencePrice,
          initialPrice,
          modifyPrice: modifyPrice ?? null,
          cancelMode: args.cancelMode,
          clientOrderId: place.clientOrderId,
          orderId: state?.orderId ?? null,
          actions: {
            place: place.actionId,
            modify: modifyActionId,
            cancel: cancelActionId,
            leverage: leverageActionId,
            scheduleCancel: scheduleCancelActionId,
            clearSchedule: clearScheduleActionId
          },
          finalOrderState: state?.state ?? null,
          scheduledCancelAt
        },
        null,
        2
      )
    );

    await app.foundationService.stop(stopReason);
  } catch (error) {
    const failure = error instanceof Error ? error : new Error("Unknown execution smoke failure");

    if (app !== undefined) {
      app.logger.error({ err: failure }, "Execution smoke CLI failed");
    } else {
      console.error(failure);
    }

    stopReason = "smoke_failed";
    process.exitCode = 1;

    if (app !== undefined) {
      await app.foundationService.stop(stopReason, failure);
    }
  } finally {
    shutdownSignals?.dispose();
  }
}

interface ParsedArgs {
  readonly allowWriteActions: boolean;
  readonly marketSymbol: string;
  readonly side: ExecutionOrderSide;
  readonly size?: string;
  readonly initialPriceFactor?: string;
  readonly modifyPriceFactor?: string;
  readonly skipModify: boolean;
  readonly cancelMode: "cloid" | "order-id";
  readonly setLeverage?: number;
  readonly scheduleCancelMs?: number;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const values = new Map<string, string | true>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === undefined || !arg.startsWith("--")) {
      throw new ConfigurationError(`Unexpected argument: ${arg ?? "<missing>"}`);
    }

    const name = arg.slice(2);
    const next = argv[index + 1];

    if (next === undefined || next.startsWith("--")) {
      values.set(name, true);
      continue;
    }

    values.set(name, next);
    index += 1;
  }

  const sideRaw = values.get("side");
  const side = sideRaw === undefined || sideRaw === true ? "buy" : normalizeSide(sideRaw);
  const cancelModeRaw = values.get("cancel-mode");
  const cancelMode =
    cancelModeRaw === undefined || cancelModeRaw === true ? "cloid" : normalizeCancelMode(cancelModeRaw);
  const sizeRaw = values.get("size");
  const initialPriceFactorRaw = values.get("initial-price-factor");
  const modifyPriceFactorRaw = values.get("modify-price-factor");
  const setLeverageRaw = values.get("set-leverage");
  const scheduleCancelMsRaw = values.get("schedule-cancel-ms");

  return {
    allowWriteActions: values.get("allow-write-actions") === true,
    marketSymbol: normalizeMarket(values.get("market"), "BTC"),
    side,
    ...(typeof sizeRaw === "string"
      ? { size: normalizeDecimalString(sizeRaw) }
      : {}),
    ...(typeof initialPriceFactorRaw === "string"
      ? { initialPriceFactor: normalizeDecimalString(initialPriceFactorRaw) }
      : {}),
    ...(typeof modifyPriceFactorRaw === "string"
      ? { modifyPriceFactor: normalizeDecimalString(modifyPriceFactorRaw) }
      : {}),
    skipModify: values.get("skip-modify") === true,
    cancelMode,
    ...(typeof setLeverageRaw === "string"
      ? { setLeverage: parseIntegerFlag(setLeverageRaw, "set-leverage") }
      : {}),
    ...(typeof scheduleCancelMsRaw === "string"
      ? { scheduleCancelMs: parseIntegerFlag(scheduleCancelMsRaw, "schedule-cancel-ms") }
      : {})
  };
}

function normalizeMarket(value: string | true | undefined, fallback: string): string {
  if (value === undefined || value === true) {
    return fallback;
  }

  return value.trim().toUpperCase();
}

function normalizeSide(value: string): ExecutionOrderSide {
  const normalized = value.trim().toLowerCase();

  if (normalized === "buy" || normalized === "sell") {
    return normalized;
  }

  throw new ConfigurationError(`Invalid --side value: ${value}`);
}

function normalizeCancelMode(value: string): "cloid" | "order-id" {
  const normalized = value.trim().toLowerCase();

  if (normalized === "cloid" || normalized === "order-id") {
    return normalized;
  }

  throw new ConfigurationError(`Invalid --cancel-mode value: ${value}`);
}

function parseIntegerFlag(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new ConfigurationError(`--${flag} must be a positive integer`);
  }

  return parsed;
}

function defaultInitialFactor(side: ExecutionOrderSide): string {
  return side === "buy" ? "0.5" : "1.5";
}

function defaultModifyFactor(side: ExecutionOrderSide): string {
  return side === "buy" ? "0.45" : "1.55";
}

function smallestIncrement(sizeDecimals: number): string {
  if (sizeDecimals <= 0) {
    return "1";
  }

  return `0.${"0".repeat(sizeDecimals - 1)}1`;
}

await main();
