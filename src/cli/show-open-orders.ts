import type { FoundationContainer } from "../app/container.js";
import { bootstrapFoundationApp } from "../app/bootstrap.js";
import { ConfigurationError } from "../core/errors.js";
import { installRuntimePolyfills } from "../core/runtime.js";

async function main(): Promise<void> {
  let app: FoundationContainer | undefined;

  try {
    installRuntimePolyfills();
    app = bootstrapFoundationApp();

    if (app.config.operatorAddress === undefined) {
      throw new Error("VANTA_OPERATOR_ADDRESS must be configured to inspect mirrored open orders");
    }

    const snapshot = app.stateSnapshotRepository.getLatestOpenOrderSnapshot(app.config.operatorAddress);
    const latestRun = app.reconciliationRepository.getLatestRun();
    const runtimeTrust = app.runtimeTrustController.getSnapshot();

    if (snapshot === undefined) {
      throw new Error("No persisted open-order snapshot exists yet. Run `pnpm reconcile:run` first.");
    }

    console.log(
      JSON.stringify(
        {
          runtimeTrust,
          latestReconciliationRun: latestRun,
          openOrders: {
            operatorAddress: snapshot.operatorAddress,
            network: snapshot.network,
            syncedAt: snapshot.syncedAt,
            orderCount: snapshot.orders.length,
            orders: snapshot.orders
          }
        },
        null,
        2
      )
    );
  } catch (error) {
    const failure = error instanceof Error ? error : new Error("Unknown open-order inspection failure");

    if (app !== undefined) {
      app.logger.error({ err: failure }, "Show-open-orders CLI failed");
    } else {
      console.error(failure);
    }

    process.exitCode = failure instanceof ConfigurationError ? 1 : 1;
  } finally {
    if (app !== undefined) {
      await app.exchangeClient.close();
      app.database.close();
    }
  }
}

await main();
