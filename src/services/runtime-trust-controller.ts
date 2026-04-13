import type { Logger } from "pino";

import type { JsonValue } from "../core/types.js";
import type { RuntimeTrustState, RuntimeTrustTransition } from "../core/trust-state.js";
import type { RuntimeStateRepository } from "../persistence/repositories/runtime-state-repository.js";

export class RuntimeTrustController {
  private current: RuntimeTrustTransition;

  constructor(
    private readonly repository: RuntimeStateRepository,
    private readonly logger: Logger
  ) {
    this.current =
      this.repository.getLatest() ?? {
        changedAt: new Date().toISOString(),
        state: "untrusted",
        reason: "process_start"
      };
  }

  getSnapshot(): RuntimeTrustTransition {
    return this.current;
  }

  transition(
    state: RuntimeTrustState,
    reason: string,
    details?: JsonValue,
    bootId?: string
  ): RuntimeTrustTransition {
    const transition: RuntimeTrustTransition = {
      changedAt: new Date().toISOString(),
      state,
      reason,
      ...(details !== undefined ? { details } : {})
    };

    this.repository.insert(transition, bootId);
    this.current = transition;
    this.logger.info({ state, reason, details }, "Runtime trust state changed");
    return transition;
  }
}
