import type { AppConfig } from "../core/types.js";
import { createLogger } from "../core/logger.js";
import { loadAppConfig } from "../config/env.js";
import { createFoundationContainer, type FoundationContainer } from "./container.js";

export function bootstrapFoundationApp(config?: AppConfig): FoundationContainer {
  const resolvedConfig = config ?? loadAppConfig();
  const logger = createLogger(resolvedConfig);

  return createFoundationContainer(resolvedConfig, logger);
}
