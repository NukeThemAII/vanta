import type { Logger } from "pino";

const SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

export interface ShutdownSignalListener {
  waitForSignal(): Promise<NodeJS.Signals>;
  dispose(): void;
}

export function createShutdownSignalListener(logger: Logger): ShutdownSignalListener {
  let settled = false;
  let resolveSignal!: (signal: NodeJS.Signals) => void;

  const signalPromise = new Promise<NodeJS.Signals>((resolve) => {
    resolveSignal = resolve;
  });

  const handlers = new Map<NodeJS.Signals, () => void>();

  const dispose = (): void => {
    for (const [signal, handler] of handlers) {
      process.off(signal, handler);
    }
    handlers.clear();
  };

  for (const signal of SHUTDOWN_SIGNALS) {
    const handler = (): void => {
      if (settled) {
        return;
      }

      settled = true;
      logger.info({ signal }, "Shutdown signal received");
      dispose();
      resolveSignal(signal);
    };

    handlers.set(signal, handler);
    process.once(signal, handler);
  }

  return {
    waitForSignal: async () => await signalPromise,
    dispose
  };
}
