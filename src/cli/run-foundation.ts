import { bootstrapFoundationApp } from "../app/bootstrap.js";
import { createShutdownSignalListener } from "../app/shutdown.js";
import { ConfigurationError } from "../core/errors.js";
import type { FoundationContainer } from "../app/container.js";
import { installRuntimePolyfills } from "../core/runtime.js";

async function main(): Promise<void> {
  let app: FoundationContainer | undefined;
  let shutdownSignals:
    | ReturnType<typeof createShutdownSignalListener>
    | undefined;
  let stopReason = "unknown";

  try {
    installRuntimePolyfills();
    app = bootstrapFoundationApp();
    shutdownSignals = createShutdownSignalListener(app.logger.child({ component: "app.shutdown" }));
    await app.foundationService.start();

    const outcome = await Promise.race([
      shutdownSignals.waitForSignal().then((signal) => ({
        kind: "signal" as const,
        signal
      })),
      app.foundationService.waitForFailure().then((error) => ({
        kind: "failure" as const,
        error
      }))
    ]);

    if (outcome.kind === "failure") {
      stopReason = "runtime_failure";
      throw outcome.error;
    }

    stopReason = `signal:${outcome.signal}`;
    await app.foundationService.stop(stopReason);
  } catch (error) {
    const failure = error instanceof Error ? error : new Error("Unknown foundation failure");
    if (app !== undefined) {
      app.logger.error({ err: failure }, "Foundation CLI failed");
    } else {
      console.error(failure);
    }

    if (failure instanceof ConfigurationError) {
      process.exitCode = 1;
    } else {
      process.exitCode = 1;
    }

    if (app !== undefined) {
      await app.foundationService.stop(stopReason, failure);
    }
  } finally {
    shutdownSignals?.dispose();
  }
}

await main();
