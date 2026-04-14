import type { Logger } from "pino";

import { RiskCheckError } from "../core/errors.js";
import { compareDecimalStrings } from "../core/decimal.js";
import { asJsonValue, type AppConfig } from "../core/types.js";
import type { AssetRegistry, PerpAssetRecord } from "../exchange/asset-registry.js";
import type {
  ExecutionIdentity,
  FormattedLeverageRequest,
  FormattedModifyRequest,
  FormattedOrderRequest,
  PlaceOrderRequest,
} from "../exchange/execution-types.js";
import type { FillRepository } from "../persistence/repositories/fill-repository.js";
import type { OrderStateRepository } from "../persistence/repositories/order-state-repository.js";
import type { RiskEventRepository } from "../persistence/repositories/risk-event-repository.js";
import type { MarketDataHealthSnapshot, MarketDataMarketHealth } from "../marketdata/health.js";
import type { AccountMirrorSnapshot } from "../portfolio/account-mirror.js";
import type { RuntimeTrustController } from "../services/runtime-trust-controller.js";
import { evaluateConsecutiveLossCooldown } from "./guards/cooldown.js";
import { evaluateRealizedDrawdown } from "./guards/drawdown.js";
import { evaluateConcurrentPositionLimit, evaluateMaxOrderNotional, evaluateOpenOrderLimit, evaluateStopBasedSizing } from "./guards/exposure.js";
import { evaluateFundingRate } from "./guards/funding.js";
import { evaluateLeverageLimit } from "./guards/leverage.js";
import { evaluateMarketDataFreshness } from "./guards/market-data.js";
import { evaluateRateLimitHeadroom } from "./guards/rate-limit.js";
import { evaluatePriceDeviation } from "./guards/slippage.js";
import { evaluateFreshAccountState } from "./guards/stale-state.js";
import type { RiskActionType, RiskDecision } from "./types.js";

interface RiskEngineOptions {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly runtimeTrustController: RuntimeTrustController;
  readonly orderStateRepository: OrderStateRepository;
  readonly fillRepository: FillRepository;
  readonly riskEventRepository: RiskEventRepository;
  readonly getAssetRegistry: () => AssetRegistry | undefined;
  readonly getAccountSnapshot: () => AccountMirrorSnapshot | undefined;
  readonly getMarketDataHealthSnapshot: () => MarketDataHealthSnapshot;
}

export class RiskEngine {
  constructor(private readonly options: RiskEngineOptions) {}

  evaluatePlaceOrder(args: {
    readonly identity: ExecutionIdentity;
    readonly request: PlaceOrderRequest;
    readonly order: FormattedOrderRequest;
    readonly correlationId: string;
    readonly bootId?: string;
  }): FormattedOrderRequest {
    const context = this.buildContext(args.identity.operatorAddress);
    const guardOutcomes: GuardOutcome[] = [];
    const accountSnapshot = this.requireFreshAccountContext(
      "place_order",
      args.identity,
      args.bootId,
      args.order,
      args.correlationId,
      context.accountSnapshot,
      guardOutcomes
    );
    const asset = this.requirePerpAsset(
      "place_order",
      args.identity,
      args.bootId,
      args.order,
      args.correlationId,
      args.order.assetId,
      guardOutcomes
    );

    let order = args.order;
    const isNewRisk = order.reduceOnly !== true;
    if (isNewRisk) {
      const rateLimitOutcome = evaluateRateLimitHeadroom({
        rateLimit: accountSnapshot.rateLimit,
        minRateLimitSurplus: this.options.config.risk.minRateLimitSurplus
      });
      guardOutcomes.push(outcomeFromGuard("rate_limit_headroom", rateLimitOutcome.ok ? "approved" : "rejected", rateLimitOutcome.message, {
        requestsSurplus: rateLimitOutcome.requestsSurplus ?? null,
        minRateLimitSurplus: this.options.config.risk.minRateLimitSurplus
      }));
      if (!rateLimitOutcome.ok) {
        this.reject("place_order", args.identity, args.bootId, order, args.correlationId, rateLimitOutcome.message, guardOutcomes);
      }

      const openOrderOutcome = evaluateOpenOrderLimit({
        activeOrders: context.activeOrders,
        maxOpenOrders: this.options.config.risk.maxOpenOrders
      });
      guardOutcomes.push(outcomeFromGuard("open_order_limit", openOrderOutcome.ok ? "approved" : "rejected", openOrderOutcome.message));
      if (!openOrderOutcome.ok) {
        this.reject("place_order", args.identity, args.bootId, order, args.correlationId, openOrderOutcome.message, guardOutcomes);
      }

      const positionOutcome = evaluateConcurrentPositionLimit({
        accountSnapshot,
        maxConcurrentPositions: this.options.config.risk.maxConcurrentPositions,
        marketSymbol: order.marketSymbol,
        reduceOnly: order.reduceOnly
      });
      guardOutcomes.push(outcomeFromGuard("position_limit", positionOutcome.ok ? "approved" : "rejected", positionOutcome.message));
      if (!positionOutcome.ok) {
        this.reject("place_order", args.identity, args.bootId, order, args.correlationId, positionOutcome.message, guardOutcomes);
      }

      const drawdownOutcome = evaluateRealizedDrawdown({
        dailyClosedPnl: this.options.fillRepository.sumClosedPnlSince(
          args.identity.operatorAddress,
          startOfUtcDayMs()
        ),
        weeklyClosedPnl: this.options.fillRepository.sumClosedPnlSince(
          args.identity.operatorAddress,
          startOfUtcWeekMs()
        ),
        maxDailyRealizedDrawdownUsd: this.options.config.risk.maxDailyRealizedDrawdownUsd,
        maxWeeklyRealizedDrawdownUsd: this.options.config.risk.maxWeeklyRealizedDrawdownUsd
      });
      guardOutcomes.push(outcomeFromGuard("realized_drawdown", drawdownOutcome.ok ? "approved" : "rejected", drawdownOutcome.message, {
        dailyClosedPnl: drawdownOutcome.dailyClosedPnl,
        weeklyClosedPnl: drawdownOutcome.weeklyClosedPnl,
        maxDailyRealizedDrawdownUsd: this.options.config.risk.maxDailyRealizedDrawdownUsd,
        maxWeeklyRealizedDrawdownUsd: this.options.config.risk.maxWeeklyRealizedDrawdownUsd
      }));
      if (!drawdownOutcome.ok) {
        this.reject("place_order", args.identity, args.bootId, order, args.correlationId, drawdownOutcome.message, guardOutcomes);
      }

      const cooldownStreak = this.options.fillRepository.getConsecutiveLossStreak({
        operatorAddress: args.identity.operatorAddress,
        marketSymbol: order.marketSymbol,
        limit: this.options.config.risk.consecutiveLossCooldownCount
      });
      const cooldownOutcome = evaluateConsecutiveLossCooldown({
        consecutiveLossCount: cooldownStreak.count,
        cooldownCount: this.options.config.risk.consecutiveLossCooldownCount,
        cooldownMinutes: this.options.config.risk.consecutiveLossCooldownMinutes,
        ...(cooldownStreak.lastLossTimestampMs !== undefined
          ? { lastLossTimestampMs: cooldownStreak.lastLossTimestampMs }
          : {})
      });
      guardOutcomes.push(outcomeFromGuard("consecutive_loss_cooldown", cooldownOutcome.ok ? "approved" : "rejected", cooldownOutcome.message, {
        consecutiveLossCount: cooldownOutcome.consecutiveLossCount,
        cooldownEndsAtMs: cooldownOutcome.cooldownEndsAtMs ?? null,
        cooldownMinutes: this.options.config.risk.consecutiveLossCooldownMinutes
      }));
      if (!cooldownOutcome.ok) {
        this.reject("place_order", args.identity, args.bootId, order, args.correlationId, cooldownOutcome.message, guardOutcomes);
      }

      const fundingOutcome = evaluateFundingRate({
        side: order.side,
        fundingRate: asset.context.fundingRate,
        maxAbsoluteFundingRate: this.options.config.risk.maxAbsoluteFundingRate
      });
      guardOutcomes.push(outcomeFromGuard("funding_threshold", fundingOutcome.ok ? "approved" : "rejected", fundingOutcome.message, {
        fundingRate: fundingOutcome.fundingRate,
        maxAbsoluteFundingRate: this.options.config.risk.maxAbsoluteFundingRate
      }));
      if (!fundingOutcome.ok) {
        this.reject("place_order", args.identity, args.bootId, order, args.correlationId, fundingOutcome.message, guardOutcomes);
      }

      const marketDataOutcome = evaluateMarketDataFreshness({
        marketHealth: this.getMarketHealth(order.marketSymbol)
      });
      guardOutcomes.push(outcomeFromGuard("market_data_freshness", marketDataOutcome.ok ? "approved" : "rejected", marketDataOutcome.message));
      if (!marketDataOutcome.ok) {
        this.reject("place_order", args.identity, args.bootId, order, args.correlationId, marketDataOutcome.message, guardOutcomes);
      }
    }

    const notionalOutcome = evaluateMaxOrderNotional({
      order,
      maxOrderNotionalUsd: this.options.config.risk.maxOrderNotionalUsd
    });
    guardOutcomes.push(outcomeFromGuard("max_notional", notionalOutcome.ok ? "approved" : "rejected", notionalOutcome.message, {
      requestedNotionalUsd: notionalOutcome.requestedNotionalUsd ?? null,
      limitUsd: this.options.config.risk.maxOrderNotionalUsd
    }));
    if (!notionalOutcome.ok) {
      this.reject("place_order", args.identity, args.bootId, order, args.correlationId, notionalOutcome.message, guardOutcomes);
    }

    const referencePrice = this.resolveReferencePrice(asset);
    const slippageOutcome = evaluatePriceDeviation({
      order,
      referencePrice: referencePrice.value,
      maxPriceDeviationBps: this.options.config.risk.maxPriceDeviationBps
    });
    guardOutcomes.push(outcomeFromGuard("aggressive_price_deviation", slippageOutcome.ok ? "approved" : "rejected", slippageOutcome.message, {
      referencePriceSource: referencePrice.source,
      referencePrice: slippageOutcome.referencePrice,
      boundaryPrice: slippageOutcome.boundaryPrice,
      actualPrice: slippageOutcome.actualPrice,
      maxPriceDeviationBps: this.options.config.risk.maxPriceDeviationBps
    }));
    if (!slippageOutcome.ok) {
      this.reject("place_order", args.identity, args.bootId, order, args.correlationId, slippageOutcome.message, guardOutcomes);
    }

    const sizingOutcome = evaluateStopBasedSizing({
      order,
      riskConfig: this.options.config.risk,
      accountSnapshot,
      asset,
      ...(args.request.risk !== undefined ? { riskRequest: args.request.risk } : {})
    });
    guardOutcomes.push(outcomeFromGuard("stop_sizing", sizingOutcome.decision, sizingOutcome.message, {
      requestedSize: sizingOutcome.requestedSize,
      approvedSize: sizingOutcome.approvedSize,
      maxSize: sizingOutcome.maxSize ?? null,
      stopLossPrice: sizingOutcome.stopLossPrice ?? null,
      riskBudgetUsd: sizingOutcome.riskBudgetUsd ?? null
    }));
    if (!sizingOutcome.ok) {
      this.reject("place_order", args.identity, args.bootId, args.order, args.correlationId, sizingOutcome.message, guardOutcomes);
    }

    if (sizingOutcome.decision === "adjusted") {
      order = {
        ...order,
        size: sizingOutcome.approvedSize
      };
    }

    this.recordDecision("place_order", args.identity, args.bootId, adjustedDecision(guardOutcomes), order.marketSymbol, order.assetId, args.correlationId, "Risk checks approved place-order request", {
      guardOutcomes,
      approvedOrder: order,
      activeOrderCount: context.activeOrders.length,
      activePositionCount: countActivePositions(accountSnapshot)
    });

    return order;
  }

  evaluateModifyOrder(args: {
    readonly identity: ExecutionIdentity;
    readonly modify: FormattedModifyRequest;
    readonly correlationId: string;
    readonly bootId?: string;
  }): void {
    const context = this.buildContext(args.identity.operatorAddress);
    const guardOutcomes: GuardOutcome[] = [];
    this.requireFreshAccountContext(
      "modify_order",
      args.identity,
      args.bootId,
      args.modify.order,
      args.correlationId,
      context.accountSnapshot,
      guardOutcomes
    );
    const asset = this.requirePerpAsset(
      "modify_order",
      args.identity,
      args.bootId,
      args.modify.order,
      args.correlationId,
      args.modify.order.assetId,
      guardOutcomes
    );

    const marketDataOutcome = evaluateMarketDataFreshness({
      marketHealth: this.getMarketHealth(args.modify.order.marketSymbol)
    });
    guardOutcomes.push(outcomeFromGuard("market_data_freshness", marketDataOutcome.ok ? "approved" : "rejected", marketDataOutcome.message));
    if (!marketDataOutcome.ok) {
      this.reject("modify_order", args.identity, args.bootId, args.modify.order, args.correlationId, marketDataOutcome.message, guardOutcomes);
    }

    const notionalOutcome = evaluateMaxOrderNotional({
      order: args.modify.order,
      maxOrderNotionalUsd: this.options.config.risk.maxOrderNotionalUsd
    });
    guardOutcomes.push(outcomeFromGuard("max_notional", notionalOutcome.ok ? "approved" : "rejected", notionalOutcome.message, {
      requestedNotionalUsd: notionalOutcome.requestedNotionalUsd ?? null,
      limitUsd: this.options.config.risk.maxOrderNotionalUsd
    }));
    if (!notionalOutcome.ok) {
      this.reject("modify_order", args.identity, args.bootId, args.modify.order, args.correlationId, notionalOutcome.message, guardOutcomes);
    }

    const referencePrice = this.resolveReferencePrice(asset);
    const slippageOutcome = evaluatePriceDeviation({
      order: args.modify.order,
      referencePrice: referencePrice.value,
      maxPriceDeviationBps: this.options.config.risk.maxPriceDeviationBps
    });
    guardOutcomes.push(outcomeFromGuard("aggressive_price_deviation", slippageOutcome.ok ? "approved" : "rejected", slippageOutcome.message, {
      referencePriceSource: referencePrice.source,
      referencePrice: slippageOutcome.referencePrice,
      boundaryPrice: slippageOutcome.boundaryPrice,
      actualPrice: slippageOutcome.actualPrice,
      maxPriceDeviationBps: this.options.config.risk.maxPriceDeviationBps
    }));
    if (!slippageOutcome.ok) {
      this.reject("modify_order", args.identity, args.bootId, args.modify.order, args.correlationId, slippageOutcome.message, guardOutcomes);
    }

    this.recordDecision("modify_order", args.identity, args.bootId, "approved", args.modify.order.marketSymbol, args.modify.order.assetId, args.correlationId, "Risk checks approved modify-order request", {
      guardOutcomes,
      approvedOrder: args.modify.order,
      target: args.modify.target
    });
  }

  evaluateLeverageUpdate(args: {
    readonly identity: ExecutionIdentity;
    readonly leverage: FormattedLeverageRequest;
    readonly bootId?: string;
  }): void {
    const context = this.buildContext(args.identity.operatorAddress);
    const guardOutcomes: GuardOutcome[] = [];
    this.requireFreshAccountContext(
      "update_leverage",
      args.identity,
      args.bootId,
      args.leverage,
      undefined,
      context.accountSnapshot,
      guardOutcomes
    );
    const asset = this.requirePerpAsset(
      "update_leverage",
      args.identity,
      args.bootId,
      args.leverage,
      undefined,
      args.leverage.assetId,
      guardOutcomes
    );

    const leverageOutcome = evaluateLeverageLimit({
      asset,
      requestedLeverage: args.leverage.leverage,
      maxLeverageFractionOfExchangeMax: this.options.config.risk.maxLeverageFractionOfExchangeMax,
      isCross: args.leverage.isCross
    });
    guardOutcomes.push(outcomeFromGuard("leverage_cap", leverageOutcome.ok ? "approved" : "rejected", leverageOutcome.message, {
      requestedLeverage: args.leverage.leverage,
      maxAllowedLeverage: leverageOutcome.maxAllowedLeverage,
      exchangeMaxLeverage: asset.maxLeverage
    }));
    if (!leverageOutcome.ok) {
      this.reject("update_leverage", args.identity, args.bootId, args.leverage, undefined, leverageOutcome.message, guardOutcomes);
    }

    this.recordDecision("update_leverage", args.identity, args.bootId, "approved", args.leverage.marketSymbol, args.leverage.assetId, undefined, "Risk checks approved leverage update", {
      guardOutcomes,
      leverage: args.leverage
    });
  }

  private buildContext(operatorAddress: ExecutionIdentity["operatorAddress"]): {
    readonly accountSnapshot: AccountMirrorSnapshot | undefined;
    readonly activeOrders: ReturnType<OrderStateRepository["listActiveOrders"]>;
  } {
    return {
      accountSnapshot: this.options.getAccountSnapshot(),
      activeOrders: this.options.orderStateRepository.listActiveOrders(operatorAddress)
    };
  }

  private requireFreshAccountContext(
    actionType: RiskActionType,
    identity: ExecutionIdentity,
    bootId: string | undefined,
    normalizedRequest: FormattedOrderRequest | FormattedLeverageRequest,
    correlationId: string | undefined,
    accountSnapshot: AccountMirrorSnapshot | undefined,
    guardOutcomes: GuardOutcome[]
  ): AccountMirrorSnapshot {
    const staleStateOutcome = evaluateFreshAccountState(accountSnapshot);
    guardOutcomes.push(outcomeFromGuard("fresh_account_state", staleStateOutcome.ok ? "approved" : "rejected", staleStateOutcome.message));
    if (!staleStateOutcome.ok) {
      this.reject(actionType, identity, bootId, normalizedRequest, correlationId, staleStateOutcome.message, guardOutcomes);
    }

    if (accountSnapshot === undefined) {
      throw new RiskCheckError("Account snapshot disappeared during risk evaluation");
    }

    return accountSnapshot;
  }

  private requirePerpAsset(
    actionType: RiskActionType,
    identity: ExecutionIdentity,
    bootId: string | undefined,
    normalizedRequest: FormattedOrderRequest | FormattedLeverageRequest,
    correlationId: string | undefined,
    assetId: number,
    guardOutcomes: GuardOutcome[]
  ): PerpAssetRecord {
    const registry = this.options.getAssetRegistry();
    if (registry === undefined) {
      guardOutcomes.push(outcomeFromGuard("asset_registry", "rejected", "Asset registry is unavailable for risk checks"));
      this.reject(actionType, identity, bootId, normalizedRequest, correlationId, "Asset registry is unavailable for risk checks", guardOutcomes);
    }

    const asset = registry.getByAssetId(assetId);
    if (asset === undefined || asset.kind !== "perp") {
      guardOutcomes.push(outcomeFromGuard("asset_registry", "rejected", `Phase 4 risk engine supports perps only; asset ${assetId} is unavailable or not a perp`));
      this.reject(actionType, identity, bootId, normalizedRequest, correlationId, `Phase 4 risk engine supports perps only; asset ${assetId} is unavailable or not a perp`, guardOutcomes);
    }

    guardOutcomes.push(outcomeFromGuard("asset_registry", "approved", `Resolved perp metadata for ${asset.symbol}`));
    return asset;
  }

  private reject(
    actionType: RiskActionType,
    identity: ExecutionIdentity,
    bootId: string | undefined,
    normalizedRequest: FormattedOrderRequest | FormattedLeverageRequest,
    correlationId: string | undefined,
    message: string,
    guardOutcomes: readonly GuardOutcome[]
  ): never {
    this.recordDecision(
      actionType,
      identity,
      bootId,
      "rejected",
      normalizedRequest.marketSymbol,
      normalizedRequest.assetId,
      correlationId,
      message,
      {
        guardOutcomes,
        normalizedRequest
      }
    );
    throw new RiskCheckError(message);
  }

  private recordDecision(
    actionType: RiskActionType,
    identity: ExecutionIdentity,
    bootId: string | undefined,
    decision: RiskDecision,
    marketSymbol: string | undefined,
    assetId: number | undefined,
    correlationId: string | undefined,
    message: string,
    details: Record<string, unknown>
  ): void {
    const trustState = this.options.runtimeTrustController.getSnapshot().state;
    this.options.riskEventRepository.insert(
      {
        occurredAt: new Date().toISOString(),
        actionType,
        operatorAddress: identity.operatorAddress,
        trustState,
        decision,
        ...(marketSymbol !== undefined ? { marketSymbol } : {}),
        ...(assetId !== undefined ? { assetId } : {}),
        ...(correlationId !== undefined ? { correlationId } : {}),
        message,
        details: asJsonValue(details)
      },
      bootId
    );

    const logPayload = {
      actionType,
      decision,
      marketSymbol: marketSymbol ?? null,
      assetId: assetId ?? null,
      correlationId: correlationId ?? null,
      details
    };

    if (decision === "rejected") {
      this.options.logger.warn(logPayload, message);
      return;
    }

    if (decision === "adjusted") {
      this.options.logger.info(logPayload, message);
      return;
    }

      this.options.logger.debug(logPayload, message);
  }

  private resolveReferencePrice(asset: PerpAssetRecord): {
    readonly value: string;
    readonly source: "mid" | "mark" | "oracle";
  } {
    if (asset.context.midPrice !== null) {
      return { value: asset.context.midPrice, source: "mid" };
    }

    this.options.logger.warn(
      {
        marketSymbol: asset.symbol,
        markPrice: asset.context.markPrice,
        oraclePrice: asset.context.oraclePrice
      },
      "Mid price unavailable for risk checks; falling back to mark/oracle price"
    );

    return asset.context.markPrice !== ""
      ? { value: asset.context.markPrice, source: "mark" }
      : { value: asset.context.oraclePrice, source: "oracle" };
  }

  private getMarketHealth(marketSymbol: string): MarketDataMarketHealth | undefined {
    const healthSnapshot = this.options.getMarketDataHealthSnapshot();
    return healthSnapshot.markets.find((market) => market.market === marketSymbol);
  }
}

interface GuardOutcome {
  readonly guard: string;
  readonly decision: RiskDecision;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

function outcomeFromGuard(
  guard: string,
  decision: RiskDecision,
  message: string,
  details?: Record<string, unknown>
): GuardOutcome {
  return {
    guard,
    decision,
    message,
    ...(details !== undefined ? { details } : {})
  };
}

function adjustedDecision(guardOutcomes: readonly GuardOutcome[]): RiskDecision {
  return guardOutcomes.some((outcome) => outcome.decision === "adjusted") ? "adjusted" : "approved";
}

function countActivePositions(accountSnapshot: AccountMirrorSnapshot): number {
  return accountSnapshot.positions.filter((position) => compareDecimalStrings(position.size, "0") !== 0).length;
}

function startOfUtcDayMs(now = new Date()): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function startOfUtcWeekMs(now = new Date()): number {
  const dayOfWeek = now.getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday);
}
