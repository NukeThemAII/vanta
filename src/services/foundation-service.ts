import { randomUUID } from "node:crypto";

import type { Logger } from "pino";

import { asJsonValue, type AppConfig, type JsonValue } from "../core/types.js";
import type { HyperliquidClient } from "../exchange/hyperliquid-client.js";
import type { UserStateHealthMonitor, UserStateHealthSnapshot } from "../exchange/user-state-health.js";
import type { CandleStore } from "../marketdata/candle-store.js";
import { UserStateWsManager } from "../exchange/user-state-ws-manager.js";
import type { MarketDataHealthMonitor, MarketDataHealthSnapshot } from "../marketdata/health.js";
import type { OrderStateMachine } from "../exchange/order-state-machine.js";
import { MarketDataWsManager } from "../marketdata/ws-manager.js";
import type { SqliteDatabase } from "../persistence/db.js";
import type { AppBootRepository } from "../persistence/repositories/app-boot-repository.js";
import type { AppEventRepository } from "../persistence/repositories/app-event-repository.js";
import type { MarketEventRepository } from "../persistence/repositories/market-event-repository.js";
import type { UserEventRepository } from "../persistence/repositories/user-event-repository.js";
import type { FillRepository } from "../persistence/repositories/fill-repository.js";
import type { ReconciliationService } from "./reconciliation-service.js";
import type { RuntimeTrustController } from "./runtime-trust-controller.js";

interface FoundationServiceOptions {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly database: SqliteDatabase;
  readonly bootRepository: AppBootRepository;
  readonly appEventRepository: AppEventRepository;
  readonly marketEventRepository: MarketEventRepository;
  readonly candleStore: CandleStore;
  readonly userEventRepository: UserEventRepository;
  readonly fillRepository: FillRepository;
  readonly exchangeClient: HyperliquidClient;
  readonly reconciliationService: ReconciliationService;
  readonly runtimeTrustController: RuntimeTrustController;
  readonly orderStateMachine: OrderStateMachine;
  readonly marketDataHealthMonitor: MarketDataHealthMonitor;
  readonly userStateHealthMonitor: UserStateHealthMonitor;
}

export class FoundationService {
  readonly bootId = randomUUID();

  private readonly failureController = new AbortController();
  private readonly startedAt = new Date().toISOString();
  private marketDataWsManager?: MarketDataWsManager;
  private userStateWsManager?: UserStateWsManager;
  private heartbeatInterval: NodeJS.Timeout | undefined;
  private marketDataHealthInterval: NodeJS.Timeout | undefined;
  private stopped = false;
  private fullyStarted = false;
  private reconnectReconciliationInFlight = false;
  private marketDataDegraded = false;
  private userStateDegraded = false;

  constructor(private readonly options: FoundationServiceOptions) {}

  get failureSignal(): AbortSignal {
    return this.failureController.signal;
  }

  async start(): Promise<void> {
    this.options.bootRepository.recordStart({
      bootId: this.bootId,
      startedAt: this.startedAt,
      appEnv: this.options.config.appEnv,
      network: this.options.config.network.name,
      markets: this.options.config.watchedMarkets,
      ...(this.options.config.operatorAddress !== undefined
        ? { operatorAddress: this.options.config.operatorAddress }
        : {})
    });

    this.recordAppEvent("foundation.starting", "info", "Starting Vanta foundation bootstrap", {
      sqlitePath: this.options.config.sqlitePath,
      watchedMarkets: [...this.options.config.watchedMarkets],
      operatorAddress: this.options.config.operatorAddress ?? null,
      bootstrapUserState: this.options.config.bootstrapUserState
    });

    const reconciliation = await this.options.reconciliationService.reconcile({
      trigger: "startup",
      bootId: this.bootId
    });
    this.applyReconciledState(reconciliation);

    this.recordAppEvent("foundation.reconciled", "info", "Startup reconciliation completed", {
      runId: reconciliation.runId,
      trustStateAfter: reconciliation.trustStateAfter,
      summary: asJsonValue(reconciliation.summary)
    });

    this.marketDataWsManager = new MarketDataWsManager({
      bootId: this.bootId,
      markets: this.options.config.watchedMarkets,
      subscriptionClient: this.options.exchangeClient.subscriptionClient,
      transport: this.options.exchangeClient.wsTransport,
      appEvents: this.options.appEventRepository,
      marketEvents: this.options.marketEventRepository,
      candleStore: this.options.candleStore,
      healthMonitor: this.options.marketDataHealthMonitor,
      logger: this.options.logger.child({ module: "marketdata.ws-manager" }),
      onFatalFailure: (error) => {
        this.handleRuntimeFailure(error);
      },
      onTransportOpen: () => {
        this.handleTransportOpen();
      },
      onTransportClose: (event) => {
        this.handleTransportClose(event);
      }
    });

    await this.marketDataWsManager.start();

    if (this.options.config.operatorAddress !== undefined) {
      this.userStateWsManager = new UserStateWsManager({
        bootId: this.bootId,
        network: this.options.config.network.name,
        operatorAddress: this.options.config.operatorAddress,
        subscriptionClient: this.options.exchangeClient.subscriptionClient,
        logger: this.options.logger.child({ module: "exchange.user-state-ws-manager" }),
        appEvents: this.options.appEventRepository,
        userEventRepository: this.options.userEventRepository,
        fillRepository: this.options.fillRepository,
        accountMirror: this.options.reconciliationService.getAccountMirror(),
        openOrderMirror: this.options.reconciliationService.getOpenOrderMirror(),
        orderStateMachine: this.options.orderStateMachine,
        healthMonitor: this.options.userStateHealthMonitor,
        getRegistry: () => this.options.reconciliationService.getAssetRegistry(),
        onFatalFailure: (error) => {
          this.handleRuntimeFailure(error);
        }
      });

      await this.userStateWsManager.start();
    }

    this.startHeartbeat();
    this.fullyStarted = true;

    this.options.bootRepository.updateStatus({
      bootId: this.bootId,
      completedAt: new Date().toISOString(),
      status: "ready",
      bootstrapSummary: {
        reconciliationRunId: reconciliation.runId,
        trustStateAfter: reconciliation.trustStateAfter,
        reconciliationSummary: asJsonValue(reconciliation.summary)
      }
    });

    this.recordAppEvent("foundation.ready", "info", "Vanta foundation service is running", {
      trustState: this.options.reconciliationService.getCurrentTrustState(),
      operatorConfigured: this.options.config.operatorAddress !== undefined
    });

    this.options.logger.info(
      {
        bootId: this.bootId,
        network: this.options.config.network.name,
        trustState: this.options.reconciliationService.getCurrentTrustState(),
        watchedMarkets: this.options.config.watchedMarkets
      },
      "Foundation service started"
    );
  }

  async stop(stopReason: string, error?: Error): Promise<void> {
    if (this.stopped) {
      return;
    }

    this.stopped = true;

    if (this.heartbeatInterval !== undefined) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }

    if (this.marketDataHealthInterval !== undefined) {
      clearInterval(this.marketDataHealthInterval);
      this.marketDataHealthInterval = undefined;
    }

    if (this.userStateWsManager !== undefined) {
      await this.userStateWsManager.stop();
    }

    if (this.marketDataWsManager !== undefined) {
      await this.marketDataWsManager.stop();
    }

    await this.options.exchangeClient.close();

    if (error === undefined) {
      this.options.bootRepository.updateStatus({
        bootId: this.bootId,
        completedAt: new Date().toISOString(),
        status: "stopped",
        stopReason,
        bootstrapSummary: {
          trustState: this.options.reconciliationService.getCurrentTrustState()
        }
      });

      this.recordAppEvent("foundation.stopped", "info", "Foundation service stopped cleanly", {
        reason: stopReason
      });
    } else {
      this.options.bootRepository.updateStatus({
        bootId: this.bootId,
        completedAt: new Date().toISOString(),
        status: "failed",
        stopReason,
        errorMessage: error.message
      });

      this.recordAppEvent("foundation.failed", "error", "Foundation service stopped with an error", {
        reason: stopReason,
        errorName: error.name,
        errorMessage: error.message
      });
    }

    this.options.database.close();
    this.options.logger.info(
      {
        bootId: this.bootId,
        reason: stopReason,
        trustState: this.options.reconciliationService.getCurrentTrustState()
      },
      "Foundation service stopped"
    );
  }

  async waitForFailure(): Promise<Error> {
    if (this.failureSignal.aborted) {
      return asError(this.failureSignal.reason);
    }

    return await new Promise<Error>((resolve) => {
      this.failureSignal.addEventListener(
        "abort",
        () => {
          resolve(asError(this.failureSignal.reason));
        },
        { once: true }
      );
    });
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const marketDataHealth = this.getMarketDataHealthSnapshot();
      const userStateHealth = this.getUserStateHealthSnapshot();
      this.options.logger.info(
        {
          bootId: this.bootId,
          trustState: this.options.reconciliationService.getCurrentTrustState(),
          marketDataStats: this.marketDataWsManager?.getStats() ?? {},
          candleStoreStats: this.options.candleStore.getStats(),
          marketDataHealth,
          userStateStats: this.userStateWsManager?.getStats() ?? {},
          userStateHealth
        },
        "Foundation heartbeat"
      );
    }, 30_000);

    this.heartbeatInterval.unref();

    this.marketDataHealthInterval = setInterval(() => {
      this.evaluateMarketDataHealth();
      this.evaluateUserStateHealth();
    }, 10_000);

    this.marketDataHealthInterval.unref();
  }

  private handleTransportOpen(): void {
    if (!this.fullyStarted || this.stopped || this.reconnectReconciliationInFlight) {
      return;
    }

    this.reconnectReconciliationInFlight = true;

    void this.options.reconciliationService
      .reconcile({
        trigger: "ws_reconnect",
        bootId: this.bootId
      })
      .then((result) => {
        this.applyReconciledState(result);
        this.recordAppEvent("foundation.reconnect_reconciled", "info", "Reconciled after transport reconnect", {
          runId: result.runId,
          trustStateAfter: result.trustStateAfter,
          summary: asJsonValue(result.summary)
        });
      })
      .catch((error: unknown) => {
        const failure = error instanceof Error ? error : new Error("Unknown reconnect reconciliation failure");
        this.handleRuntimeFailure(failure);
      })
      .finally(() => {
        this.reconnectReconciliationInFlight = false;
      });
  }

  private handleTransportClose(event: CloseEvent | undefined): void {
    if (!this.fullyStarted || this.stopped) {
      return;
    }

    this.options.runtimeTrustController.transition(
      "degraded",
      "market_data_transport_closed",
      {
        code: event?.code ?? null,
        reason: event?.reason ?? null,
        wasClean: event?.wasClean ?? null
      },
      this.bootId
    );

    this.options.reconciliationService.getAccountMirror().markStale();
    this.userStateWsManager?.beginSnapshotCycle("transport_reconnect_pending");
    this.recordAppEvent("foundation.transport_degraded", "warn", "Runtime trust downgraded after transport close", {
      code: event?.code ?? null,
      reason: event?.reason ?? null
    });
  }

  private handleRuntimeFailure(error: Error): void {
    if (this.failureSignal.aborted) {
      return;
    }

    this.options.runtimeTrustController.transition(
      "untrusted",
      "runtime_failure",
      {
        errorName: error.name,
        errorMessage: error.message
      },
      this.bootId
    );

    this.recordAppEvent("foundation.runtime_failure", "error", "Runtime failure detected", {
      errorName: error.name,
      errorMessage: error.message
    });

    this.failureController.abort(error);
  }

  private recordAppEvent(
    eventType: string,
    severity: "info" | "warn" | "error",
    message: string,
    payload?: JsonValue
  ): void {
    this.options.appEventRepository.insert({
      bootId: this.bootId,
      eventTime: new Date().toISOString(),
      eventType,
      severity,
      component: "services.foundation-service",
      message,
      ...(payload !== undefined ? { payload } : {})
    });
  }

  private applyReconciledState(result: Awaited<ReturnType<ReconciliationService["reconcile"]>>): void {
    if (result.openOrderSnapshot !== undefined) {
      this.options.orderStateMachine.applyOpenOrderSnapshot(result.openOrderSnapshot);
    }
  }

  private evaluateMarketDataHealth(): void {
    if (!this.fullyStarted || this.stopped) {
      return;
    }

    const health = this.getMarketDataHealthSnapshot();

    if (health.status === "healthy") {
      this.handleRecoveredMarketDataHealth(health);
      return;
    }

    this.handleDegradedMarketDataHealth(health);
  }

  private evaluateUserStateHealth(): void {
    const health = this.getUserStateHealthSnapshot();
    if (health === undefined) {
      return;
    }

    if (health.status === "healthy") {
      this.handleRecoveredUserStateHealth(health);
      return;
    }

    if (health.status === "degraded") {
      this.handleDegradedUserStateHealth(health);
    }
  }

  private handleDegradedMarketDataHealth(health: MarketDataHealthSnapshot): void {
    if (this.marketDataDegraded) {
      return;
    }

    this.marketDataDegraded = true;
    this.options.runtimeTrustController.transition(
      "degraded",
      "market_data_unhealthy",
      asJsonValue(health),
      this.bootId
    );
    this.recordAppEvent(
      "foundation.market_data_unhealthy",
      "warn",
      "Runtime trust downgraded because market-data freshness is unhealthy",
      asJsonValue(health)
    );
  }

  private handleRecoveredMarketDataHealth(health: MarketDataHealthSnapshot): void {
    if (!this.marketDataDegraded) {
      return;
    }

    this.marketDataDegraded = false;
    const trust = this.options.runtimeTrustController.getSnapshot();

    if (trust.state === "degraded" && trust.reason.startsWith("market_data_")) {
      this.options.runtimeTrustController.transition(
        "trusted",
        "market_data_recovered",
        asJsonValue(health),
        this.bootId
      );
    }

    this.recordAppEvent(
      "foundation.market_data_recovered",
      "info",
      "Market-data freshness returned to healthy state",
      asJsonValue(health)
    );
  }

  private handleDegradedUserStateHealth(health: UserStateHealthSnapshot): void {
    if (this.userStateDegraded) {
      return;
    }

    this.userStateDegraded = true;
    this.options.runtimeTrustController.transition(
      "degraded",
      "user_state_sync_unhealthy",
      asJsonValue(health),
      this.bootId
    );
    this.recordAppEvent(
      "foundation.user_state_unhealthy",
      "warn",
      "Runtime trust downgraded because required user-state sync did not complete",
      asJsonValue(health)
    );
  }

  private handleRecoveredUserStateHealth(health: UserStateHealthSnapshot): void {
    if (!this.userStateDegraded) {
      return;
    }

    this.userStateDegraded = false;
    const trust = this.options.runtimeTrustController.getSnapshot();

    if (trust.state === "degraded" && trust.reason.startsWith("user_state_")) {
      this.options.runtimeTrustController.transition(
        "trusted",
        "user_state_sync_recovered",
        asJsonValue(health),
        this.bootId
      );
    }

    this.recordAppEvent(
      "foundation.user_state_recovered",
      "info",
      "Required user-state sync returned to healthy state",
      asJsonValue(health)
    );
  }

  private getMarketDataHealthSnapshot(now = new Date()): MarketDataHealthSnapshot {
    return this.options.marketDataHealthMonitor.getSnapshot(
      this.options.config.watchedMarkets,
      {
        maxMidAgeMs: this.options.config.risk.marketDataMaxMidAgeMs,
        maxTradeAgeMs: this.options.config.risk.marketDataMaxTradeAgeMs
      },
      now
    );
  }

  private getUserStateHealthSnapshot(now = new Date()): UserStateHealthSnapshot | undefined {
    if (this.userStateWsManager === undefined) {
      return undefined;
    }

    return this.userStateWsManager.getHealthSnapshot(this.options.config.risk.userStateMaxSyncWaitMs, now);
  }
}

function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error("Unknown runtime failure");
}
