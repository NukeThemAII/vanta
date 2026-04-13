import type { FoundationContainer } from "../app/container.js";
import { bootstrapFoundationApp } from "../app/bootstrap.js";
import { ConfigurationError } from "../core/errors.js";
import { installRuntimePolyfills } from "../core/runtime.js";

async function main(): Promise<void> {
  let app: FoundationContainer | undefined;

  try {
    installRuntimePolyfills();
    app = bootstrapFoundationApp();

    const result = await app.reconciliationService.reconcile({
      trigger: "manual"
    });

    console.log(
      JSON.stringify(
        {
          runId: result.runId,
          trigger: result.trigger,
          trustStateBefore: result.trustStateBefore,
          trustStateAfter: result.trustStateAfter,
          summary: result.summary,
          accountSnapshotSyncedAt: result.accountSnapshot?.syncedAt ?? null,
          openOrderSnapshotSyncedAt: result.openOrderSnapshot?.syncedAt ?? null
        },
        null,
        2
      )
    );
  } catch (error) {
    const failure = error instanceof Error ? error : new Error("Unknown reconciliation failure");

    if (app !== undefined) {
      app.logger.error({ err: failure }, "Manual reconciliation CLI failed");
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
