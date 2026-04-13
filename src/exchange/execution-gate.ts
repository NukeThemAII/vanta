import type { RuntimeTrustController } from "../services/runtime-trust-controller.js";
import type { SignerRegistry } from "./signer-registry.js";
import { ExecutionGateError } from "../core/errors.js";
import type { ExecutionActionType, ExecutionIdentity } from "./execution-types.js";

export class ExecutionGate {
  constructor(
    private readonly runtimeTrustController: RuntimeTrustController,
    private readonly signerRegistry: SignerRegistry
  ) {}

  requireWriteAccess(actionType: ExecutionActionType): ExecutionIdentity {
    const trustSnapshot = this.runtimeTrustController.getSnapshot();

    if (trustSnapshot.state !== "trusted") {
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
