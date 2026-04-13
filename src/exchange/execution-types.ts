import type { Address, Hex } from "viem";

import type { RuntimeTrustState } from "../core/trust-state.js";
import type { JsonValue, NetworkName } from "../core/types.js";
import type { AssetKind } from "./asset-registry.js";

export type NumericInput = string | number;
export type ExecutionOrderSide = "buy" | "sell";
export type OrderTimeInForce = "Gtc" | "Ioc" | "Alo" | "FrontendMarket";
export type OrderGrouping = "na" | "normalTpsl" | "positionTpsl";
export type TriggerKind = "tp" | "sl";

export interface TriggerOrderRequest {
  readonly isMarket: boolean;
  readonly triggerPrice: NumericInput;
  readonly kind: TriggerKind;
}

export interface PlaceOrderRequest {
  readonly marketSymbol: string;
  readonly side: ExecutionOrderSide;
  readonly price: NumericInput;
  readonly size: NumericInput;
  readonly reduceOnly?: boolean;
  readonly timeInForce?: OrderTimeInForce;
  readonly trigger?: TriggerOrderRequest;
  readonly grouping?: OrderGrouping;
  readonly correlationId?: string;
  readonly clientOrderId?: Hex;
}

export type OrderReference =
  | {
      readonly marketSymbol: string;
      readonly orderId: number;
    }
  | {
      readonly marketSymbol: string;
      readonly clientOrderId: Hex;
    };

export interface CancelOrderRequest {
  readonly marketSymbol: string;
  readonly orderId: number;
}

export interface CancelOrderByCloidRequest {
  readonly marketSymbol: string;
  readonly clientOrderId: Hex;
}

export interface ModifyOrderRequest {
  readonly target: OrderReference;
  readonly next: {
    readonly marketSymbol: string;
    readonly side: ExecutionOrderSide;
    readonly price: NumericInput;
    readonly size: NumericInput;
    readonly reduceOnly?: boolean;
    readonly timeInForce?: OrderTimeInForce;
    readonly trigger?: TriggerOrderRequest;
    readonly clientOrderId?: Hex;
  };
  readonly correlationId?: string;
}

export interface UpdateLeverageRequest {
  readonly marketSymbol: string;
  readonly leverage: number;
  readonly isCross: boolean;
}

export interface ScheduleCancelRequest {
  readonly time: number | null;
}

export interface FormattedOrderRequest {
  readonly marketSymbol: string;
  readonly marketType: AssetKind;
  readonly assetId: number;
  readonly side: ExecutionOrderSide;
  readonly price: string;
  readonly size: string;
  readonly reduceOnly: boolean;
  readonly orderType:
    | {
        readonly kind: "limit";
        readonly timeInForce: OrderTimeInForce;
      }
    | {
        readonly kind: "trigger";
        readonly isMarket: boolean;
        readonly triggerPrice: string;
        readonly triggerKind: TriggerKind;
      };
  readonly grouping: OrderGrouping;
  readonly clientOrderId: Hex;
}

export interface FormattedModifyRequest {
  readonly target: OrderReference;
  readonly order: FormattedOrderRequest;
}

export interface FormattedCancelRequest {
  readonly marketSymbol: string;
  readonly assetId: number;
  readonly orderId: number;
}

export interface FormattedCancelByCloidRequest {
  readonly marketSymbol: string;
  readonly assetId: number;
  readonly clientOrderId: Hex;
}

export interface FormattedLeverageRequest {
  readonly marketSymbol: string;
  readonly assetId: number;
  readonly leverage: number;
  readonly isCross: boolean;
}

export type ExecutionActionType =
  | "place_order"
  | "cancel_order"
  | "cancel_order_by_cloid"
  | "modify_order"
  | "update_leverage"
  | "schedule_cancel";

export type ExecutionActionStatus = "queued" | "submitted" | "succeeded" | "failed";

export interface ExecutionIdentity {
  readonly network: NetworkName;
  readonly operatorAddress: Address;
  readonly signerAddress: Address;
  readonly signerType: "api_wallet";
  readonly mode: "direct" | "vault";
  readonly vaultAddress?: Address;
}

export type OrderLifecycleState =
  | "submitted"
  | "resting"
  | "partially_filled"
  | "filled"
  | "cancel_requested"
  | "canceled"
  | "modify_requested"
  | "rejected"
  | "needs_reconciliation";

export type OrderLifecycleSource =
  | "execution_submission"
  | "exchange_ack"
  | "order_update"
  | "user_fill"
  | "open_orders_snapshot"
  | "order_status"
  | "reconciliation";

export interface ExecutionActionRecord {
  readonly actionId: string;
  readonly createdAt: string;
  readonly actionType: ExecutionActionType;
  readonly operatorAddress: Address;
  readonly signerAddress: Address;
  readonly vaultAddress?: Address;
  readonly status: ExecutionActionStatus;
  readonly trustState: RuntimeTrustState;
  readonly marketSymbol?: string;
  readonly assetId?: number;
  readonly orderId?: number;
  readonly clientOrderId?: Hex;
  readonly correlationId?: string;
  readonly exchangeNonce?: number;
  readonly request: JsonValue;
  readonly normalizedRequest?: JsonValue;
  readonly response?: JsonValue;
  readonly errorMessage?: string;
  readonly completedAt?: string;
}

export interface CloidMappingRecord {
  readonly clientOrderId: Hex;
  readonly actionId: string;
  readonly correlationId: string;
  readonly operatorAddress: Address;
  readonly marketSymbol: string;
  readonly assetId: number;
  readonly orderId?: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OrderStateRecord {
  readonly orderKey: string;
  readonly operatorAddress: Address;
  readonly marketSymbol: string;
  readonly assetId: number;
  readonly marketType: AssetKind;
  readonly state: OrderLifecycleState;
  readonly side?: ExecutionOrderSide;
  readonly orderId?: number;
  readonly clientOrderId?: Hex;
  readonly limitPrice?: string;
  readonly originalSize?: string;
  readonly filledSize: string;
  readonly averageFillPrice?: string;
  readonly lastSource: OrderLifecycleSource;
  readonly updatedAt: string;
  readonly eventTimestampMs?: number | null;
  readonly rejectionReason?: string;
  readonly metadata?: JsonValue;
}

export interface OrderStateTransitionRecord {
  readonly transitionId: string;
  readonly orderKey: string;
  readonly actionId?: string;
  readonly operatorAddress: Address;
  readonly marketSymbol: string;
  readonly assetId: number;
  readonly occurredAt: string;
  readonly source: OrderLifecycleSource;
  readonly fromState?: OrderLifecycleState;
  readonly toState: OrderLifecycleState;
  readonly orderId?: number;
  readonly clientOrderId?: Hex;
  readonly eventTimestampMs?: number | null;
  readonly payload?: JsonValue;
}
