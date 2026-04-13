import { createFoundationContainer } from "../app/container.js";
import { loadAppConfig } from "../config/env.js";
import { createLogger } from "../core/logger.js";
import { installRuntimePolyfills } from "../core/runtime.js";

async function main(): Promise<void> {
  installRuntimePolyfills();
  const config = loadAppConfig();
  const logger = createLogger(config);
  const container = createFoundationContainer(config, logger);

  try {
    const accountSnapshot =
      container.reconciliationService.getAccountMirror().getSnapshot()
      ?? container.reconciliationService.getLatestPersistedAccountSnapshot();
    const openOrderSnapshot = container.reconciliationService.getLatestPersistedOpenOrderSnapshot();
    const trustState = container.runtimeTrustController.getSnapshot();
    const recentRiskEvents = container.riskEventRepository.listRecent(10);

    console.log(
      JSON.stringify(
        {
          network: config.network.name,
          operatorAddress: config.operatorAddress ?? null,
          trustState,
          riskConfig: config.risk,
          account: accountSnapshot === undefined
            ? null
            : {
                syncedAt: accountSnapshot.syncedAt,
                staleness: accountSnapshot.staleness,
                accountValue: accountSnapshot.marginSummary.accountValue,
                positionCount: accountSnapshot.positions.length,
                withdrawable: accountSnapshot.withdrawable
              },
          openOrders: openOrderSnapshot === undefined
            ? null
            : {
                syncedAt: openOrderSnapshot.syncedAt,
                orderCount: openOrderSnapshot.orders.length
              },
          recentRiskEvents
        },
        null,
        2
      )
    );
  } finally {
    await container.exchangeClient.close();
    container.database.close();
  }
}

await main();
