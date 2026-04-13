import type { Address } from "viem";

import type { RuntimeTrustState } from "../core/trust-state.js";
import type { JsonValue } from "../core/types.js";

export type RiskActionType = "place_order" | "modify_order" | "update_leverage";
export type RiskDecision = "approved" | "adjusted" | "rejected";

export interface RiskEventRecord {
  readonly occurredAt: string;
  readonly actionType: RiskActionType;
  readonly operatorAddress: Address;
  readonly trustState: RuntimeTrustState;
  readonly decision: RiskDecision;
  readonly marketSymbol?: string;
  readonly assetId?: number;
  readonly correlationId?: string;
  readonly message: string;
  readonly details?: JsonValue;
}
