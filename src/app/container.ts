import type { Logger } from "pino";

import type { AppConfig } from "../core/types.js";
import { createComponentLogger } from "../core/logger.js";
import { CloidService } from "../exchange/cloid-service.js";
import { ExecutionExchangeClient } from "../exchange/execution-client.js";
import { ExecutionEngine } from "../exchange/execution-engine.js";
import { ExecutionGate } from "../exchange/execution-gate.js";
import { HyperliquidClient } from "../exchange/hyperliquid-client.js";
import { ExecutionNonceController } from "../exchange/nonce-manager.js";
import { HyperliquidOrderFormatter } from "../exchange/order-formatter.js";
import { OrderStateMachine } from "../exchange/order-state-machine.js";
import { SignerRegistry } from "../exchange/signer-registry.js";
import { SqliteDatabase } from "../persistence/db.js";
import { AssetRegistryRepository } from "../persistence/repositories/asset-registry-repository.js";
import { AppBootRepository } from "../persistence/repositories/app-boot-repository.js";
import { AppEventRepository } from "../persistence/repositories/app-event-repository.js";
import { CloidMappingRepository } from "../persistence/repositories/cloid-mapping-repository.js";
import { ExecutionActionRepository } from "../persistence/repositories/execution-action-repository.js";
import { MarketEventRepository } from "../persistence/repositories/market-event-repository.js";
import { OrderStateRepository } from "../persistence/repositories/order-state-repository.js";
import { ReconciliationRepository } from "../persistence/repositories/reconciliation-repository.js";
import { RiskEventRepository } from "../persistence/repositories/risk-event-repository.js";
import { RuntimeStateRepository } from "../persistence/repositories/runtime-state-repository.js";
import { StateSnapshotRepository } from "../persistence/repositories/state-snapshot-repository.js";
import { UserEventRepository } from "../persistence/repositories/user-event-repository.js";
import { RiskEngine } from "../risk/risk-engine.js";
import { FoundationService } from "../services/foundation-service.js";
import { ReconciliationService } from "../services/reconciliation-service.js";
import { RuntimeTrustController } from "../services/runtime-trust-controller.js";

export interface FoundationContainer {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly database: SqliteDatabase;
  readonly exchangeClient: HyperliquidClient;
  readonly assetRegistryRepository: AssetRegistryRepository;
  readonly stateSnapshotRepository: StateSnapshotRepository;
  readonly reconciliationRepository: ReconciliationRepository;
  readonly runtimeStateRepository: RuntimeStateRepository;
  readonly appEventRepository: AppEventRepository;
  readonly userEventRepository: UserEventRepository;
  readonly riskEventRepository: RiskEventRepository;
  readonly reconciliationService: ReconciliationService;
  readonly runtimeTrustController: RuntimeTrustController;
  readonly signerRegistry: SignerRegistry;
  readonly orderStateMachine: OrderStateMachine;
  readonly riskEngine: RiskEngine;
  readonly executionEngine: ExecutionEngine;
  readonly foundationService: FoundationService;
}

export function createFoundationContainer(config: AppConfig, logger: Logger): FoundationContainer {
  const database = new SqliteDatabase(config.sqlitePath);
  const bootRepository = new AppBootRepository(database.connection);
  const appEventRepository = new AppEventRepository(database.connection);
  const marketEventRepository = new MarketEventRepository(database.connection);
  const assetRegistryRepository = new AssetRegistryRepository(database.connection);
  const stateSnapshotRepository = new StateSnapshotRepository(database.connection);
  const reconciliationRepository = new ReconciliationRepository(database.connection);
  const runtimeStateRepository = new RuntimeStateRepository(database.connection);
  const userEventRepository = new UserEventRepository(database.connection);
  const executionActionRepository = new ExecutionActionRepository(database.connection);
  const cloidMappingRepository = new CloidMappingRepository(database.connection);
  const orderStateRepository = new OrderStateRepository(database.connection);
  const riskEventRepository = new RiskEventRepository(database.connection);
  const exchangeLogger = createComponentLogger(logger, "exchange.hyperliquid-client");
  const exchangeClient = new HyperliquidClient(config, exchangeLogger);
  const runtimeTrustController = new RuntimeTrustController(
    runtimeStateRepository,
    createComponentLogger(logger, "services.runtime-trust-controller")
  );
  const reconciliationService = new ReconciliationService({
    config,
    logger: createComponentLogger(logger, "services.reconciliation-service"),
    exchangeClient,
    assetRegistryRepository,
    stateSnapshotRepository,
    reconciliationRepository,
    orderStateRepository,
    runtimeTrustController
  });
  const signerRegistry = new SignerRegistry(
    config,
    createComponentLogger(logger, "exchange.signer-registry")
  );
  const nonceController = new ExecutionNonceController();
  const cloidService = new CloidService();
  const executionGate = new ExecutionGate(runtimeTrustController, signerRegistry);
  const executionWriteClient = new ExecutionExchangeClient(
    config,
    signerRegistry,
    nonceController,
    createComponentLogger(logger, "exchange.execution-client")
  );
  const orderStateMachine = new OrderStateMachine(
    orderStateRepository,
    createComponentLogger(logger, "exchange.order-state-machine")
  );
  const riskEngine = new RiskEngine({
    config,
    logger: createComponentLogger(logger, "risk.risk-engine"),
    runtimeTrustController,
    orderStateRepository,
    riskEventRepository,
    getAssetRegistry: () => reconciliationService.getAssetRegistry(),
    getAccountSnapshot: () =>
      reconciliationService.getAccountMirror().getSnapshot()
      ?? reconciliationService.getLatestPersistedAccountSnapshot()
  });
  const executionEngine = new ExecutionEngine({
    logger: createComponentLogger(logger, "exchange.execution-engine"),
    gate: executionGate,
    riskEngine,
    formatter: new HyperliquidOrderFormatter(() => reconciliationService.getAssetRegistry(), cloidService),
    exchangeClient: executionWriteClient,
    readClient: exchangeClient,
    nonceController,
    actionRepository: executionActionRepository,
    cloidMappingRepository,
    orderStateMachine,
    reconciliationService
  });
  const foundationService = new FoundationService({
    config,
    logger: createComponentLogger(logger, "services.foundation-service"),
    database,
    bootRepository,
    appEventRepository,
    marketEventRepository,
    userEventRepository,
    exchangeClient,
    reconciliationService,
    runtimeTrustController,
    orderStateMachine
  });

  return {
    config,
    logger,
    database,
    exchangeClient,
    assetRegistryRepository,
    stateSnapshotRepository,
    reconciliationRepository,
    runtimeStateRepository,
    appEventRepository,
    userEventRepository,
    riskEventRepository,
    reconciliationService,
    runtimeTrustController,
    signerRegistry,
    orderStateMachine,
    riskEngine,
    executionEngine,
    foundationService
  };
}
