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
      throw new Error("VANTA_OPERATOR_ADDRESS must be configured to inspect mirrored account state");
    }

    const snapshot = app.stateSnapshotRepository.getLatestAccountSnapshot(app.config.operatorAddress);
    const latestRun = app.reconciliationRepository.getLatestRun();
    const runtimeTrust = app.runtimeTrustController.getSnapshot();

    if (snapshot === undefined) {
      throw new Error("No persisted account snapshot exists yet. Run `pnpm reconcile:run` first.");
    }

    console.log(
      JSON.stringify(
        {
          runtimeTrust,
          latestReconciliationRun: latestRun,
          account: {
            operatorAddress: snapshot.operatorAddress,
            network: snapshot.network,
            syncedAt: snapshot.syncedAt,
            staleness: snapshot.staleness,
            marginModeAssumption: snapshot.marginModeAssumption,
            positionCount: snapshot.positions.length,
            spotBalanceCount: snapshot.spotBalances.length,
            marginSummary: snapshot.marginSummary,
            crossMarginSummary: snapshot.crossMarginSummary,
            withdrawable: snapshot.withdrawable,
            positions: snapshot.positions,
            spotBalances: snapshot.spotBalances,
            rateLimit: snapshot.rateLimit ?? null
          }
        },
        null,
        2
      )
    );
  } catch (error) {
    const failure = error instanceof Error ? error : new Error("Unknown account-state inspection failure");

    if (app !== undefined) {
      app.logger.error({ err: failure }, "Show-account-state CLI failed");
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
