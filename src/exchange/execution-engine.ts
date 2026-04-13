import { randomUUID } from "node:crypto";

import type {
  ModifyParameters,
  OrderParameters
} from "@nktkas/hyperliquid/api/exchange";
import type { Logger } from "pino";
import type { Hex } from "viem";
import { asJsonValue } from "../core/types.js";
import { ExecutionError } from "../core/errors.js";
import type { HyperliquidClient } from "./hyperliquid-client.js";
import type { ExecutionActionRepository } from "../persistence/repositories/execution-action-repository.js";
import type { CloidMappingRepository } from "../persistence/repositories/cloid-mapping-repository.js";
import type { ExecutionGate } from "./execution-gate.js";
import type { HyperliquidOrderFormatter } from "./order-formatter.js";
import type { ExecutionExchangeClient } from "./execution-client.js";
import type { ExecutionNonceController } from "./nonce-manager.js";
import type {
  CancelOrderByCloidRequest,
  CancelOrderRequest,
  ExecutionActionRecord,
  ExecutionIdentity,
  FormattedOrderRequest,
  ModifyOrderRequest,
  PlaceOrderRequest,
  ScheduleCancelRequest,
  UpdateLeverageRequest
} from "./execution-types.js";
import type { OrderStateMachine } from "./order-state-machine.js";
import type { ReconciliationService } from "../services/reconciliation-service.js";

interface ExecutionEngineOptions {
  readonly logger: Logger;
  readonly gate: ExecutionGate;
  readonly formatter: HyperliquidOrderFormatter;
  readonly exchangeClient: ExecutionExchangeClient;
  readonly readClient: HyperliquidClient;
  readonly nonceController: ExecutionNonceController;
  readonly actionRepository: ExecutionActionRepository;
  readonly cloidMappingRepository: CloidMappingRepository;
  readonly orderStateMachine: OrderStateMachine;
  readonly reconciliationService: ReconciliationService;
}

export class ExecutionEngine {
  constructor(private readonly options: ExecutionEngineOptions) {}

  async placeOrder(request: PlaceOrderRequest, bootId?: string): Promise<{
    readonly actionId: string;
    readonly correlationId: string;
    readonly clientOrderId: Hex;
    readonly orderId?: number;
    readonly response: unknown;
  }> {
    const identity = this.options.gate.requireWriteAccess("place_order");
    const { correlationId, order } = this.options.formatter.formatPlaceOrder(request);
    const actionId = randomUUID();

    const action = this.insertQueuedAction({
      actionId,
      actionType: "place_order",
      identity,
      marketSymbol: order.marketSymbol,
      assetId: order.assetId,
      clientOrderId: order.clientOrderId,
      correlationId,
      request: asJsonValue(request),
      normalizedRequest: asJsonValue(order)
    }, bootId);

    this.options.cloidMappingRepository.upsert({
      clientOrderId: order.clientOrderId,
      actionId,
      correlationId,
      operatorAddress: identity.operatorAddress,
      marketSymbol: order.marketSymbol,
      assetId: order.assetId,
      createdAt: action.createdAt,
      updatedAt: action.createdAt
    });

    this.options.orderStateMachine.recordSubmitted({
      actionId,
      identity,
      order,
      occurredAt: action.createdAt
    });

    return await this.runAction(action, async () => {
      const orderPromise = this.options.exchangeClient.placeOrder({
        orders: [mapFormattedOrderToSdk(order)],
        grouping: order.grouping
      });

      const nonce = await this.options.nonceController.waitForActionNonce(actionId);
      this.markActionSubmitted(action, {
        exchangeNonce: nonce
      });

      const response = await orderPromise;
      const responseStatus = response.response.data.statuses[0];

      if (responseStatus === undefined) {
        throw new ExecutionError("Exchange returned no order status");
      }

      const nextState = this.options.orderStateMachine.recordOrderAcknowledgement({
        actionId,
        identity,
        order,
        response: responseStatus,
        occurredAt: new Date().toISOString()
      });

      const orderId =
        typeof responseStatus === "object" && "resting" in responseStatus
          ? responseStatus.resting.oid
          : typeof responseStatus === "object" && "filled" in responseStatus
            ? responseStatus.filled.oid
            : undefined;

      if (orderId !== undefined) {
        this.options.cloidMappingRepository.upsert({
          clientOrderId: order.clientOrderId,
          actionId,
          correlationId,
          operatorAddress: identity.operatorAddress,
          marketSymbol: order.marketSymbol,
          assetId: order.assetId,
          orderId,
          createdAt: action.createdAt,
          updatedAt: new Date().toISOString()
        });
      }

      if (typeof responseStatus === "object" && "error" in responseStatus) {
        throw new ExecutionError(String(responseStatus.error));
      }

      this.completeAction(action, {
        status: "succeeded",
        completedAt: new Date().toISOString(),
        exchangeNonce: nonce,
        ...(orderId !== undefined ? { orderId } : {}),
        response: asJsonValue(response)
      });

      return {
        actionId,
        correlationId,
        clientOrderId: order.clientOrderId,
        ...(nextState.orderId !== undefined ? { orderId: nextState.orderId } : {}),
        response
      };
    });
  }

  async cancelOrder(request: CancelOrderRequest, bootId?: string): Promise<{
    readonly actionId: string;
    readonly response: unknown;
  }> {
    const identity = this.options.gate.requireWriteAccess("cancel_order");
    const cancel = this.options.formatter.formatCancelOrder(request);
    const actionId = randomUUID();
    const action = this.insertQueuedAction({
      actionId,
      actionType: "cancel_order",
      identity,
      marketSymbol: cancel.marketSymbol,
      assetId: cancel.assetId,
      orderId: cancel.orderId,
      request: asJsonValue(request),
      normalizedRequest: asJsonValue(cancel)
    }, bootId);

    this.options.orderStateMachine.recordCancelRequested({
      actionId,
      identity,
      marketSymbol: cancel.marketSymbol,
      assetId: cancel.assetId,
      reference: {
        marketSymbol: cancel.marketSymbol,
        orderId: cancel.orderId
      },
      occurredAt: action.createdAt
    });

    return await this.runAction(action, async () => {
      const cancelPromise = this.options.exchangeClient.cancelOrder({
        cancels: [{ a: cancel.assetId, o: cancel.orderId }]
      });
      const nonce = await this.options.nonceController.waitForActionNonce(actionId);
      this.markActionSubmitted(action, { exchangeNonce: nonce });
      const response = await cancelPromise;
      const status = response.response.data.statuses[0];

      if (status !== "success") {
        const message = extractExchangeStatusError(status, "Unknown cancel failure");
        throw new ExecutionError(message);
      }

      this.completeAction(action, {
        status: "succeeded",
        completedAt: new Date().toISOString(),
        exchangeNonce: nonce,
        response: asJsonValue(response)
      });

      return { actionId, response };
    });
  }

  async cancelOrderByCloid(request: CancelOrderByCloidRequest, bootId?: string): Promise<{
    readonly actionId: string;
    readonly response: unknown;
  }> {
    const identity = this.options.gate.requireWriteAccess("cancel_order_by_cloid");
    const cancel = this.options.formatter.formatCancelOrderByCloid(request);
    const actionId = randomUUID();
    const action = this.insertQueuedAction({
      actionId,
      actionType: "cancel_order_by_cloid",
      identity,
      marketSymbol: cancel.marketSymbol,
      assetId: cancel.assetId,
      clientOrderId: cancel.clientOrderId,
      request: asJsonValue(request),
      normalizedRequest: asJsonValue(cancel)
    }, bootId);

    this.options.orderStateMachine.recordCancelRequested({
      actionId,
      identity,
      marketSymbol: cancel.marketSymbol,
      assetId: cancel.assetId,
      reference: {
        marketSymbol: cancel.marketSymbol,
        clientOrderId: cancel.clientOrderId
      },
      occurredAt: action.createdAt
    });

    return await this.runAction(action, async () => {
      const cancelPromise = this.options.exchangeClient.cancelOrderByCloid({
        cancels: [{ asset: cancel.assetId, cloid: cancel.clientOrderId }]
      });
      const nonce = await this.options.nonceController.waitForActionNonce(actionId);
      this.markActionSubmitted(action, { exchangeNonce: nonce });
      const response = await cancelPromise;
      const status = response.response.data.statuses[0];

      if (status !== "success") {
        const message = extractExchangeStatusError(status, "Unknown cancel-by-cloid failure");
        throw new ExecutionError(message);
      }

      this.completeAction(action, {
        status: "succeeded",
        completedAt: new Date().toISOString(),
        exchangeNonce: nonce,
        response: asJsonValue(response)
      });

      return { actionId, response };
    });
  }

  async modifyOrder(request: ModifyOrderRequest, bootId?: string): Promise<{
    readonly actionId: string;
    readonly response: unknown;
  }> {
    const identity = this.options.gate.requireWriteAccess("modify_order");
    const { modify } = this.options.formatter.formatModifyOrder(request);
    const actionId = randomUUID();
    const action = this.insertQueuedAction({
      actionId,
      actionType: "modify_order",
      identity,
      marketSymbol: modify.order.marketSymbol,
      assetId: modify.order.assetId,
      clientOrderId: modify.order.clientOrderId,
      request: asJsonValue(request),
      normalizedRequest: asJsonValue(modify)
    }, bootId);

    this.options.orderStateMachine.recordModifyRequested({
      actionId,
      identity,
      order: modify.order,
      reference: modify.target,
      occurredAt: action.createdAt
    });

    return await this.runAction(action, async () => {
      const modifyPromise = this.options.exchangeClient.modifyOrder(mapFormattedModifyToSdk(modify));
      const nonce = await this.options.nonceController.waitForActionNonce(actionId);
      this.markActionSubmitted(action, { exchangeNonce: nonce });
      const response = await modifyPromise;

      this.completeAction(action, {
        status: "succeeded",
        completedAt: new Date().toISOString(),
        exchangeNonce: nonce,
        response: asJsonValue(response)
      });

      return { actionId, response };
    });
  }

  async updateLeverage(request: UpdateLeverageRequest, bootId?: string): Promise<{
    readonly actionId: string;
    readonly response: unknown;
  }> {
    const identity = this.options.gate.requireWriteAccess("update_leverage");
    const leverage = this.options.formatter.formatUpdateLeverage(request);
    const actionId = randomUUID();
    const action = this.insertQueuedAction({
      actionId,
      actionType: "update_leverage",
      identity,
      marketSymbol: leverage.marketSymbol,
      assetId: leverage.assetId,
      request: asJsonValue(request),
      normalizedRequest: asJsonValue(leverage)
    }, bootId);

    return await this.runAction(action, async () => {
      const leveragePromise = this.options.exchangeClient.updateLeverage({
        asset: leverage.assetId,
        leverage: leverage.leverage,
        isCross: leverage.isCross
      });
      const nonce = await this.options.nonceController.waitForActionNonce(actionId);
      this.markActionSubmitted(action, { exchangeNonce: nonce });
      const response = await leveragePromise;

      this.completeAction(action, {
        status: "succeeded",
        completedAt: new Date().toISOString(),
        exchangeNonce: nonce,
        response: asJsonValue(response)
      });

      return { actionId, response };
    });
  }

  async scheduleCancel(request: ScheduleCancelRequest, bootId?: string): Promise<{
    readonly actionId: string;
    readonly response: unknown;
  }> {
    const identity = this.options.gate.requireWriteAccess("schedule_cancel");
    const actionId = randomUUID();
    const action = this.insertQueuedAction({
      actionId,
      actionType: "schedule_cancel",
      identity,
      request: asJsonValue(request),
      normalizedRequest: asJsonValue(request)
    }, bootId);

    return await this.runAction(action, async () => {
      const schedulePromise =
        request.time === null
          ? this.options.exchangeClient.scheduleCancel()
          : this.options.exchangeClient.scheduleCancel({ time: request.time });
      const nonce = await this.options.nonceController.waitForActionNonce(actionId);
      this.markActionSubmitted(action, { exchangeNonce: nonce });
      const response = await schedulePromise;

      this.completeAction(action, {
        status: "succeeded",
        completedAt: new Date().toISOString(),
        exchangeNonce: nonce,
        response: asJsonValue(response)
      });

      return { actionId, response };
    });
  }

  async refreshOrderStatus(reference: {
    readonly clientOrderId?: Hex;
    readonly orderId?: number;
  }): Promise<void> {
    const operatorAddress = this.options.reconciliationService.getAccountMirror().getSnapshot()?.operatorAddress
      ?? this.options.reconciliationService.getLatestPersistedAccountSnapshot()?.operatorAddress;

    if (operatorAddress === undefined) {
      throw new ExecutionError("Cannot refresh order status without a configured operator address");
    }

    const identifier = reference.clientOrderId ?? reference.orderId;
    if (identifier === undefined) {
      throw new ExecutionError("Order status refresh requires either clientOrderId or orderId");
    }

    const response = await this.options.readClient.fetchOrderStatus(operatorAddress, identifier);

    if (response.status === "unknownOid") {
      throw new ExecutionError(`Exchange does not recognize order reference ${String(identifier)}`);
    }

    const registry = this.options.reconciliationService.getAssetRegistry();
    if (registry === undefined) {
      throw new ExecutionError("Asset registry is unavailable for order status refresh");
    }

    this.options.orderStateMachine.applyOrderStatus({
      operatorAddress,
      registry,
      response
    });
  }

  private insertQueuedAction(
    args: {
      readonly actionId: string;
      readonly actionType: ExecutionActionRecord["actionType"];
      readonly identity: ExecutionIdentity;
      readonly request: ExecutionActionRecord["request"];
      readonly normalizedRequest?: ExecutionActionRecord["normalizedRequest"];
      readonly marketSymbol?: string;
      readonly assetId?: number;
      readonly orderId?: number;
      readonly clientOrderId?: Hex;
      readonly correlationId?: string;
    },
    bootId?: string
  ): ExecutionActionRecord {
    const record: ExecutionActionRecord = {
      actionId: args.actionId,
      createdAt: new Date().toISOString(),
      actionType: args.actionType,
      operatorAddress: args.identity.operatorAddress,
      signerAddress: args.identity.signerAddress,
      ...(args.identity.vaultAddress !== undefined ? { vaultAddress: args.identity.vaultAddress } : {}),
      status: "queued",
      trustState: this.options.reconciliationService.getCurrentTrustState(),
      request: args.request,
      ...(args.normalizedRequest !== undefined ? { normalizedRequest: args.normalizedRequest } : {}),
      ...(args.marketSymbol !== undefined ? { marketSymbol: args.marketSymbol } : {}),
      ...(args.assetId !== undefined ? { assetId: args.assetId } : {}),
      ...(args.orderId !== undefined ? { orderId: args.orderId } : {}),
      ...(args.clientOrderId !== undefined ? { clientOrderId: args.clientOrderId } : {}),
      ...(args.correlationId !== undefined ? { correlationId: args.correlationId } : {})
    };

    this.options.actionRepository.insert(record, bootId);
    return record;
  }

  private markActionSubmitted(
    action: ExecutionActionRecord,
    patch: {
      readonly exchangeNonce: number;
    }
  ): void {
    this.options.actionRepository.update({
      ...action,
      status: "submitted",
      exchangeNonce: patch.exchangeNonce
    });
  }

  private completeAction(
    action: ExecutionActionRecord,
    patch: {
      readonly status: "succeeded" | "failed";
      readonly completedAt: string;
      readonly exchangeNonce?: number;
      readonly orderId?: number;
      readonly response?: ExecutionActionRecord["response"];
      readonly errorMessage?: string;
    }
  ): void {
    this.options.actionRepository.update({
      ...action,
      status: patch.status,
      completedAt: patch.completedAt,
      ...(patch.exchangeNonce !== undefined ? { exchangeNonce: patch.exchangeNonce } : {}),
      ...(patch.orderId !== undefined ? { orderId: patch.orderId } : {}),
      ...(patch.response !== undefined ? { response: patch.response } : {}),
      ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage } : {})
    });
  }

  private async runAction<T>(
    action: ExecutionActionRecord,
    operation: () => Promise<T>
  ): Promise<T> {
    try {
      return await this.options.nonceController.runWithAction(action.actionId, operation);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error("Unknown execution failure");
      const nonce = this.options.nonceController.getActionNonce(action.actionId);

      this.completeAction(action, {
        status: "failed",
        completedAt: new Date().toISOString(),
        ...(nonce !== undefined ? { exchangeNonce: nonce } : {}),
        errorMessage: failure.message
      });

      this.options.logger.error(
        {
          err: failure,
          actionId: action.actionId,
          actionType: action.actionType,
          marketSymbol: action.marketSymbol ?? null,
          clientOrderId: action.clientOrderId ?? null
        },
        "Execution action failed"
      );

      if (action.marketSymbol !== undefined && action.assetId !== undefined) {
        if (action.clientOrderId !== undefined) {
          this.options.orderStateMachine.markNeedsReconciliation({
            actionId: action.actionId,
            operatorAddress: action.operatorAddress,
            marketSymbol: action.marketSymbol,
            assetId: action.assetId,
            reference: {
              marketSymbol: action.marketSymbol,
              clientOrderId: action.clientOrderId
            },
            reason: failure.message
          });
        } else if (action.orderId !== undefined) {
          this.options.orderStateMachine.markNeedsReconciliation({
            actionId: action.actionId,
            operatorAddress: action.operatorAddress,
            marketSymbol: action.marketSymbol,
            assetId: action.assetId,
            reference: {
              marketSymbol: action.marketSymbol,
              orderId: action.orderId
            },
            reason: failure.message
          });
        }
      }

      throw failure;
    }
  }
}

function extractExchangeStatusError(status: unknown, fallback: string): string {
  if (status !== null && typeof status === "object" && "error" in status) {
    return String((status as { readonly error: unknown }).error);
  }

  return fallback;
}

function mapFormattedOrderToSdk(order: FormattedOrderRequest): OrderParameters["orders"][number] {
  return {
    a: order.assetId,
    b: order.side === "buy",
    p: order.price,
    s: order.size,
    r: order.reduceOnly,
    t: order.orderType.kind === "limit"
      ? { limit: { tif: order.orderType.timeInForce } }
      : {
          trigger: {
            isMarket: order.orderType.isMarket,
            triggerPx: order.orderType.triggerPrice,
            tpsl: order.orderType.triggerKind
          }
        },
    c: order.clientOrderId
  };
}

function mapFormattedModifyToSdk(modify: {
  readonly target: {
    readonly marketSymbol: string;
    readonly orderId?: number;
    readonly clientOrderId?: Hex;
  };
  readonly order: FormattedOrderRequest;
}): ModifyParameters {
  return {
    oid: modify.target.clientOrderId ?? modify.target.orderId ?? -1,
    order: mapFormattedOrderToSdk(modify.order)
  };
}
