import pino, { stdTimeFunctions, type Logger } from "pino";

import type { AppConfig } from "./types.js";
import { APP_NAME } from "./types.js";

export function createLogger(config: Pick<AppConfig, "appEnv" | "logLevel" | "network">): Logger {
  return pino({
    level: config.logLevel,
    timestamp: stdTimeFunctions.isoTime,
    base: {
      app: APP_NAME,
      env: config.appEnv,
      network: config.network.name
    }
  });
}

export function createComponentLogger(parent: Logger, component: string): Logger {
  return parent.child({ component });
}
