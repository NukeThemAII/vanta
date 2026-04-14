import type { RuntimeTrustState } from "../core/trust-state.js";
import type { RuntimeTrustController } from "../services/runtime-trust-controller.js";
import type { SignerRegistry } from "./signer-registry.js";
import { ExecutionGateError } from "../core/errors.js";
import type { ExecutionActionType, ExecutionIdentity } from "./execution-types.js";

export const DEGRADED_TRUST_EMERGENCY_ACTIONS = [
  "cancel_order",
  "cancel_order_by_cloid",
  "schedule_cancel"
] as const satisfies readonly ExecutionActionType[];

const DEGRADED_TRUST_EMERGENCY_ACTION_SET = new Set<ExecutionActionType>(DEGRADED_TRUST_EMERGENCY_ACTIONS);

export class ExecutionGate {
  constructor(
    private readonly runtimeTrustController: RuntimeTrustController,
    private readonly signerRegistry: SignerRegistry
  ) {}

  requireWriteAccess(actionType: ExecutionActionType): ExecutionIdentity {
    const trustSnapshot = this.runtimeTrustController.getSnapshot();

    if (!isExecutionAllowedForTrustState(actionType, trustSnapshot.state)) {
      throw new ExecutionGateError(
        `Write action ${actionType} is blocked because runtime trust is ${trustSnapshot.state}`
      );
    }

    const identity = this.signerRegistry.requireExecutionIdentity();

    if (identity.network !== "testnet") {
      throw new ExecutionGateError(
        `Phase 3 write actions are restricted to testnet, but current network is ${identity.network}`
      );
    }

    return identity;
  }
}

export function isExecutionAllowedForTrustState(
  actionType: ExecutionActionType,
  trustState: RuntimeTrustState
): boolean {
  if (trustState === "trusted") {
    return true;
  }

  if (trustState === "degraded") {
    return DEGRADED_TRUST_EMERGENCY_ACTION_SET.has(actionType);
  }

  return false;
}
