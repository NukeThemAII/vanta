import { createFoundationContainer } from "../app/container.js";
import { loadAppConfig } from "../config/env.js";
import { createLogger } from "../core/logger.js";
import { installRuntimePolyfills } from "../core/runtime.js";

async function main(): Promise<void> {
  installRuntimePolyfills();
  const args = parseArgs(process.argv.slice(2));
  const config = loadAppConfig();
  const app = createFoundationContainer(
    {
      ...config,
      logLevel: "silent"
    },
    createLogger({
      ...config,
      logLevel: "silent"
    })
  );

  try {
    const summary = args.apply
      ? app.retentionService.apply({ vacuum: args.vacuum })
      : app.retentionService.preview();

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await app.exchangeClient.close();
    app.database.close();
  }
}

await main();

function parseArgs(argv: readonly string[]): {
  readonly apply: boolean;
  readonly vacuum: boolean;
} {
  return {
    apply: argv.includes("--apply"),
    vacuum: argv.includes("--vacuum")
  };
}
