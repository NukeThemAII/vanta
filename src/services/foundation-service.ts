import { randomUUID } from "node:crypto";

import type { Logger } from "pino";

import { asJsonValue, type AppConfig, type JsonValue } from "../core/types.js";
import type { HyperliquidClient } from "../exchange/hyperliquid-client.js";
import { UserStateWsManager } from "../exchange/user-state-ws-manager.js";
import type { OrderStateMachine } from "../exchange/order-state-machine.js";
import { MarketDataWsManager } from "../marketdata/ws-manager.js";
import type { SqliteDatabase } from "../persistence/db.js";
import type { AppBootRepository } from "../persistence/repositories/app-boot-repository.js";
import type { AppEventRepository } from "../persistence/repositories/app-event-repository.js";
import type { MarketEventRepository } from "../persistence/repositories/market-event-repository.js";
import type { UserEventRepository } from "../persistence/repositories/user-event-repository.js";
import type { ReconciliationService } from "./reconciliation-service.js";
import type { RuntimeTrustController } from "./runtime-trust-controller.js";

interface FoundationServiceOptions {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly database: SqliteDatabase;
  readonly bootRepository: AppBootRepository;
  readonly appEventRepository: AppEventRepository;
  readonly marketEventRepository: MarketEventRepository;
  readonly userEventRepository: UserEventRepository;
  readonly exchangeClient: HyperliquidClient;
  readonly reconciliationService: ReconciliationService;
  readonly runtimeTrustController: RuntimeTrustController;
  readonly orderStateMachine: OrderStateMachine;
}

export class FoundationService {
  readonly bootId = randomUUID();

  private readonly failureController = new AbortController();
  private readonly startedAt = new Date().toISOString();
  private marketDataWsManager?: MarketDataWsManager;
  private userStateWsManager?: UserStateWsManager;
  private heartbeatInterval: NodeJS.Timeout | undefined;
  private stopped = false;
  private fullyStarted = false;
  private reconnectReconciliationInFlight = false;

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

    this.recordAppEvent("foundation.starting", "info", "Starting Phase 2 foundation bootstrap", {
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
        accountMirror: this.options.reconciliationService.getAccountMirror(),
        openOrderMirror: this.options.reconciliationService.getOpenOrderMirror(),
        orderStateMachine: this.options.orderStateMachine,
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

    this.recordAppEvent("foundation.ready", "info", "Phase 2 foundation service is running", {
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
      this.options.logger.info(
        {
          bootId: this.bootId,
          trustState: this.options.reconciliationService.getCurrentTrustState(),
          marketDataStats: this.marketDataWsManager?.getStats() ?? {},
          userStateStats: this.userStateWsManager?.getStats() ?? {}
        },
        "Foundation heartbeat"
      );
    }, 30_000);

    this.heartbeatInterval.unref();
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
}

function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error("Unknown runtime failure");
}
