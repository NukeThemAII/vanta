import type { Logger } from "pino";

import { BootstrapError } from "../core/errors.js";
import { asJsonValue, type AppConfig, type JsonValue } from "../core/types.js";
import type { RuntimeTrustState } from "../core/trust-state.js";
import {
  AssetRegistry
} from "../exchange/asset-registry.js";
import type { AssetRegistrySnapshot } from "../exchange/asset-registry.js";
import {
  determineTrustStateAfterReconciliation,
  diffActiveOrderStatesAgainstOpenOrders,
  diffAccountSnapshots,
  diffAssetRegistry,
  diffOpenOrderSnapshots,
  summarizeReconciliationIssues,
  type ReconciliationIssue,
  type ReconciliationSummary,
  type ReconciliationTrigger
} from "../exchange/reconciliation.js";
import {
  OpenOrderMirror,
  normalizeOpenOrderSnapshot
} from "../exchange/open-order-mirror.js";
import type { OpenOrderStateSnapshot } from "../exchange/open-order-mirror.js";
import type { HyperliquidClient } from "../exchange/hyperliquid-client.js";
import type { OrderStateRecord } from "../exchange/execution-types.js";
import {
  AccountStateMirror,
  normalizeAccountSnapshot
} from "../portfolio/account-mirror.js";
import type { AccountMirrorSnapshot } from "../portfolio/account-mirror.js";
import { normalizeUserFills } from "../portfolio/fills.js";
import type { AssetRegistryRepository } from "../persistence/repositories/asset-registry-repository.js";
import type { FillRepository } from "../persistence/repositories/fill-repository.js";
import {
  type ReconciliationRunRecord,
  type ReconciliationRepository
} from "../persistence/repositories/reconciliation-repository.js";
import type { OrderStateRepository } from "../persistence/repositories/order-state-repository.js";
import type { StateSnapshotRepository } from "../persistence/repositories/state-snapshot-repository.js";
import type { RuntimeTrustController } from "./runtime-trust-controller.js";

export interface ReconciliationResult {
  readonly runId: number;
  readonly trigger: ReconciliationTrigger;
  readonly trustStateBefore: RuntimeTrustState;
  readonly trustStateAfter: RuntimeTrustState;
  readonly issues: readonly ReconciliationIssue[];
  readonly summary: ReconciliationSummary;
  readonly registrySnapshot: AssetRegistrySnapshot;
  readonly accountSnapshot?: AccountMirrorSnapshot;
  readonly openOrderSnapshot?: OpenOrderStateSnapshot;
}

interface ReconciliationServiceOptions {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly exchangeClient: HyperliquidClient;
  readonly assetRegistryRepository: AssetRegistryRepository;
  readonly stateSnapshotRepository: StateSnapshotRepository;
  readonly reconciliationRepository: ReconciliationRepository;
  readonly orderStateRepository: OrderStateRepository;
  readonly fillRepository: FillRepository;
  readonly runtimeTrustController: RuntimeTrustController;
}

const FILL_RECONCILIATION_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export class ReconciliationService {
  private readonly accountMirror = new AccountStateMirror();
  private readonly openOrderMirror = new OpenOrderMirror();
  private assetRegistry: AssetRegistry | undefined;
  private inFlight: Promise<ReconciliationResult> | undefined;

  constructor(private readonly options: ReconciliationServiceOptions) {}

  getAssetRegistry(): AssetRegistry | undefined {
    return this.assetRegistry;
  }

  getAccountMirror(): AccountStateMirror {
    return this.accountMirror;
  }

  getOpenOrderMirror(): OpenOrderMirror {
    return this.openOrderMirror;
  }

  getCurrentTrustState(): RuntimeTrustState {
    return this.options.runtimeTrustController.getSnapshot().state;
  }

  getLatestPersistedAccountSnapshot(): AccountMirrorSnapshot | undefined {
    if (this.options.config.operatorAddress === undefined) {
      return undefined;
    }

    return this.options.stateSnapshotRepository.getLatestAccountSnapshot(this.options.config.operatorAddress);
  }

  getLatestPersistedOpenOrderSnapshot(): OpenOrderStateSnapshot | undefined {
    if (this.options.config.operatorAddress === undefined) {
      return undefined;
    }

    return this.options.stateSnapshotRepository.getLatestOpenOrderSnapshot(this.options.config.operatorAddress);
  }

  getLatestReconciliationRun(): ReconciliationRunRecord | undefined {
    return this.options.reconciliationRepository.getLatestRun();
  }

  async reconcile(args: {
    readonly trigger: ReconciliationTrigger;
    readonly bootId?: string;
  }): Promise<ReconciliationResult> {
    if (this.inFlight !== undefined) {
      return await this.inFlight;
    }

    const promise = this.runReconciliation(args);
    this.inFlight = promise.finally(() => {
      this.inFlight = undefined;
    });

    return await this.inFlight;
  }

  private async runReconciliation(args: {
    readonly trigger: ReconciliationTrigger;
    readonly bootId?: string;
  }): Promise<ReconciliationResult> {
    const startedAt = new Date().toISOString();
    const trustStateBefore = this.options.runtimeTrustController.getSnapshot().state;
    this.options.runtimeTrustController.transition(
      "reconciling",
      `reconcile:${args.trigger}:start`,
      { trigger: args.trigger },
      args.bootId
    );

    const runId = this.options.reconciliationRepository.startRun({
      startedAt,
      trigger: args.trigger,
      trustStateBefore,
      ...(args.bootId !== undefined ? { bootId: args.bootId } : {}),
      ...(this.options.config.operatorAddress !== undefined
        ? { operatorAddress: this.options.config.operatorAddress }
        : {})
    });

    try {
      const previousRegistry = this.options.assetRegistryRepository.getLatestSnapshot();
      const previousAccount = this.getLatestPersistedAccountSnapshot();
      const previousOpenOrders = this.getLatestPersistedOpenOrderSnapshot();

      const metadata = await this.options.exchangeClient.fetchRegistryMetadata();
      const registry = AssetRegistry.build({
        createdAt: startedAt,
        network: this.options.config.network.name,
        perpMetaAndAssetCtxs: metadata.perpMetaAndAssetCtxs,
        spotMetaAndAssetCtxs: metadata.spotMetaAndAssetCtxs
      });

      const registrySnapshot = registry.getSnapshot();
      this.options.assetRegistryRepository.saveSnapshot(registrySnapshot, args.bootId);

      let accountSnapshot: AccountMirrorSnapshot | undefined;
      let openOrderSnapshot: OpenOrderStateSnapshot | undefined;

      if (this.options.config.operatorAddress !== undefined) {
        const [userState, recentFills] = await Promise.all([
          this.options.exchangeClient.fetchUserExchangeState(this.options.config.operatorAddress),
          this.options.exchangeClient.fetchUserFillsByTime(
            this.options.config.operatorAddress,
            Date.now() - FILL_RECONCILIATION_LOOKBACK_MS
          )
        ]);

        if (userState === undefined) {
          throw new BootstrapError("Operator exchange state could not be loaded during reconciliation");
        }

        accountSnapshot = normalizeAccountSnapshot({
          operatorAddress: this.options.config.operatorAddress,
          network: this.options.config.network.name,
          source: "rest_reconciliation",
          syncedAt: startedAt,
          registry,
          clearinghouseState: userState.clearinghouseState,
          spotState: userState.spotState,
          userRateLimit: userState.userRateLimit
        });

        openOrderSnapshot = normalizeOpenOrderSnapshot({
          operatorAddress: this.options.config.operatorAddress,
          network: this.options.config.network.name,
          source: "rest_reconciliation",
          syncedAt: startedAt,
          registry,
          openOrders: userState.frontendOpenOrders
        });

        this.options.stateSnapshotRepository.saveAccountSnapshot(accountSnapshot, args.bootId);
        this.options.stateSnapshotRepository.saveOpenOrderSnapshot(openOrderSnapshot, args.bootId);
        this.options.fillRepository.upsertMany(
          normalizeUserFills({
            operatorAddress: this.options.config.operatorAddress,
            network: this.options.config.network.name,
            registry,
            fills: recentFills,
            isSnapshot: true,
            recordedAt: startedAt
          }),
          args.bootId
        );
      }

      const issues = buildReconciliationIssues({
        operatorAddressConfigured: this.options.config.operatorAddress !== undefined,
        previousRegistry,
        currentRegistry: registrySnapshot,
        previousAccount,
        currentAccount: accountSnapshot,
        previousOpenOrders,
        currentOpenOrders: openOrderSnapshot,
        localActiveOrderStates:
          this.options.config.operatorAddress !== undefined
            ? this.options.orderStateRepository.listActiveOrders(this.options.config.operatorAddress)
            : []
      });

      const summary = summarizeReconciliationIssues(issues);
      const trustStateAfter = determineTrustStateAfterReconciliation({
        operatorConfigured: this.options.config.operatorAddress !== undefined,
        issues
      });

      this.options.reconciliationRepository.addIssues(runId, issues);
      this.options.reconciliationRepository.completeRun({
        id: runId,
        completedAt: new Date().toISOString(),
        status: "succeeded",
        trustStateAfter,
        issueCount: summary.issueCount,
        summary
      });

      this.assetRegistry = registry;
      if (accountSnapshot !== undefined) {
        this.accountMirror.replace(accountSnapshot);
      }
      if (openOrderSnapshot !== undefined) {
        this.openOrderMirror.replaceSnapshot(openOrderSnapshot);
      }

      this.options.runtimeTrustController.transition(
        trustStateAfter,
        `reconcile:${args.trigger}:complete`,
        {
          runId,
          summary: summarizeReconciliationSummary(summary),
          issues: asJsonValue(issues.slice(0, 20))
        },
        args.bootId
      );

      this.options.logger.info(
        {
          trigger: args.trigger,
          runId,
          trustStateBefore,
          trustStateAfter,
          summary
        },
        "Reconciliation run completed"
      );

      return {
        runId,
        trigger: args.trigger,
        trustStateBefore,
        trustStateAfter,
        issues,
        summary,
        registrySnapshot,
        ...(accountSnapshot !== undefined ? { accountSnapshot } : {}),
        ...(openOrderSnapshot !== undefined ? { openOrderSnapshot } : {})
      };
    } catch (error) {
      const failure = error instanceof Error ? error : new Error("Unknown reconciliation failure");
      this.options.reconciliationRepository.completeRun({
        id: runId,
        completedAt: new Date().toISOString(),
        status: "failed",
        trustStateAfter: "untrusted",
        issueCount: 0,
        errorMessage: failure.message
      });

      this.options.runtimeTrustController.transition(
        "untrusted",
        `reconcile:${args.trigger}:failed`,
        {
          runId,
          errorName: failure.name,
          errorMessage: failure.message
        },
        args.bootId
      );

      this.options.logger.error({ err: failure, trigger: args.trigger, runId }, "Reconciliation run failed");
      throw failure;
    }
  }
}

function buildReconciliationIssues(args: {
  readonly operatorAddressConfigured: boolean;
  readonly previousRegistry: AssetRegistrySnapshot | undefined;
  readonly currentRegistry: AssetRegistrySnapshot;
  readonly previousAccount: AccountMirrorSnapshot | undefined;
  readonly currentAccount: AccountMirrorSnapshot | undefined;
  readonly previousOpenOrders: OpenOrderStateSnapshot | undefined;
  readonly currentOpenOrders: OpenOrderStateSnapshot | undefined;
  readonly localActiveOrderStates: readonly OrderStateRecord[];
}): ReconciliationIssue[] {
  const issues: ReconciliationIssue[] = [];

  issues.push(...diffAssetRegistry(args.previousRegistry, args.currentRegistry));

  if (!args.operatorAddressConfigured) {
    issues.push({
      severity: "warn",
      issueType: "operator_address_missing",
      entityType: "system",
      entityKey: "operator",
      message: "Operator address is not configured; account and open-order reconciliation cannot be trusted"
    });
    return issues;
  }

  if (args.currentAccount !== undefined) {
    issues.push(...diffAccountSnapshots(args.previousAccount, args.currentAccount));
  } else {
    issues.push({
      severity: "error",
      issueType: "account_snapshot_missing",
      entityType: "account",
      entityKey: "operator",
      message: "Fresh account snapshot was not available during reconciliation"
    });
  }

  if (args.currentOpenOrders !== undefined) {
    issues.push(...diffOpenOrderSnapshots(args.previousOpenOrders, args.currentOpenOrders));
    issues.push(...diffActiveOrderStatesAgainstOpenOrders(args.localActiveOrderStates, args.currentOpenOrders));
  } else {
    issues.push({
      severity: "error",
      issueType: "open_order_snapshot_missing",
      entityType: "order",
      entityKey: "operator",
      message: "Fresh open-order snapshot was not available during reconciliation"
    });
  }

  return issues;
}

function summarizeReconciliationSummary(summary: ReconciliationSummary): JsonValue {
  return {
    issueCount: summary.issueCount,
    errorCount: summary.errorCount,
    warningCount: summary.warningCount,
    infoCount: summary.infoCount
  };
}
