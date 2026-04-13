import type { JsonValue } from "./types.js";

export const RUNTIME_TRUST_STATES = ["trusted", "reconciling", "degraded", "untrusted"] as const;

export type RuntimeTrustState = (typeof RUNTIME_TRUST_STATES)[number];

export interface RuntimeTrustTransition {
  readonly changedAt: string;
  readonly state: RuntimeTrustState;
  readonly reason: string;
  readonly details?: JsonValue;
}

export function isRuntimeTrustState(value: string): value is RuntimeTrustState {
  return RUNTIME_TRUST_STATES.includes(value as RuntimeTrustState);
}
