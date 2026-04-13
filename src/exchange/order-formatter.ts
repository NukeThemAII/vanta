import { formatPrice, formatSize } from "@nktkas/hyperliquid/utils";
import type { Hex } from "viem";

import { OrderFormattingError } from "../core/errors.js";
import { normalizeDecimalString, isPositiveDecimal } from "../core/decimal.js";
import type { AssetRegistry, AssetRegistryEntry, PerpAssetRecord } from "./asset-registry.js";
import type {
  CancelOrderByCloidRequest,
  CancelOrderRequest,
  ExecutionOrderSide,
  FormattedCancelByCloidRequest,
  FormattedCancelRequest,
  FormattedLeverageRequest,
  FormattedModifyRequest,
  FormattedOrderRequest,
  ModifyOrderRequest,
  OrderGrouping,
  OrderReference,
  OrderTimeInForce,
  PlaceOrderRequest,
  TriggerOrderRequest,
  UpdateLeverageRequest
} from "./execution-types.js";
import type { CloidService } from "./cloid-service.js";

export class HyperliquidOrderFormatter {
  constructor(
    private readonly getRegistry: () => AssetRegistry | undefined,
    private readonly cloidService: CloidService
  ) {}

  formatPlaceOrder(request: PlaceOrderRequest): {
    readonly correlationId: string;
    readonly order: FormattedOrderRequest;
  } {
    const asset = this.resolveAsset(request.marketSymbol);
    const correlation = request.clientOrderId !== undefined
      ? {
          correlationId: request.correlationId ?? request.clientOrderId,
          clientOrderId: this.cloidService.normalize(request.clientOrderId)
        }
      : this.cloidService.generate({
          ...(request.correlationId !== undefined ? { correlationId: request.correlationId } : {}),
          context: {
            marketSymbol: asset.symbol,
            side: request.side,
            price: stringifyNumericInput(request.price),
            size: stringifyNumericInput(request.size),
            grouping: request.grouping ?? "na"
          }
        });

    return {
      correlationId: correlation.correlationId,
      order: this.buildFormattedOrder(asset, {
        marketSymbol: asset.symbol,
        side: request.side,
        price: request.price,
        size: request.size,
        clientOrderId: correlation.clientOrderId,
        ...(request.reduceOnly !== undefined ? { reduceOnly: request.reduceOnly } : {}),
        ...(request.timeInForce !== undefined ? { timeInForce: request.timeInForce } : {}),
        ...(request.trigger !== undefined ? { trigger: request.trigger } : {}),
        ...(request.grouping !== undefined ? { grouping: request.grouping } : {})
      })
    };
  }

  formatModifyOrder(request: ModifyOrderRequest): {
    readonly correlationId: string;
    readonly modify: FormattedModifyRequest;
  } {
    const asset = this.resolveAsset(request.next.marketSymbol);
    const targetClientOrderId =
      "clientOrderId" in request.target ? request.target.clientOrderId : undefined;
    const clientOrderId = request.next.clientOrderId !== undefined
      ? this.cloidService.normalize(request.next.clientOrderId)
      : targetClientOrderId;

    if (clientOrderId === undefined) {
      throw new OrderFormattingError("Modify requests must retain or specify a valid client order id");
    }

    return {
      correlationId: request.correlationId ?? clientOrderId,
      modify: {
        target: this.normalizeOrderReference(request.target),
        order: this.buildFormattedOrder(asset, {
          ...request.next,
          clientOrderId
        })
      }
    };
  }

  formatCancelOrder(request: CancelOrderRequest): FormattedCancelRequest {
    const asset = this.resolveAsset(request.marketSymbol);

    if (!Number.isSafeInteger(request.orderId) || request.orderId < 0) {
      throw new OrderFormattingError("orderId must be a non-negative safe integer");
    }

    return {
      marketSymbol: asset.symbol,
      assetId: asset.assetId,
      orderId: request.orderId
    };
  }

  formatCancelOrderByCloid(request: CancelOrderByCloidRequest): FormattedCancelByCloidRequest {
    const asset = this.resolveAsset(request.marketSymbol);

    return {
      marketSymbol: asset.symbol,
      assetId: asset.assetId,
      clientOrderId: this.cloidService.normalize(request.clientOrderId)
    };
  }

  formatUpdateLeverage(request: UpdateLeverageRequest): FormattedLeverageRequest {
    const asset = this.resolvePerpAsset(request.marketSymbol);

    if (!Number.isSafeInteger(request.leverage) || request.leverage < 1) {
      throw new OrderFormattingError("Leverage must be a positive integer");
    }

    return {
      marketSymbol: asset.symbol,
      assetId: asset.assetId,
      leverage: request.leverage,
      isCross: request.isCross
    };
  }

  private buildFormattedOrder(
    asset: AssetRegistryEntry,
    request: {
      readonly marketSymbol: string;
      readonly side: ExecutionOrderSide;
      readonly price: string | number;
      readonly size: string | number;
      readonly reduceOnly?: boolean;
      readonly timeInForce?: OrderTimeInForce;
      readonly trigger?: TriggerOrderRequest;
      readonly grouping?: OrderGrouping;
      readonly clientOrderId: Hex;
    }
  ): FormattedOrderRequest {
    const priceInput = stringifyNumericInput(request.price);
    const sizeInput = stringifyNumericInput(request.size);

    if (!isPositiveDecimal(priceInput)) {
      throw new OrderFormattingError("Order price must be greater than zero");
    }

    if (!isPositiveDecimal(sizeInput)) {
      throw new OrderFormattingError("Order size must be greater than zero");
    }

    const price = formatPrice(
      priceInput,
      asset.precision.sizeDecimals,
      asset.kind
    );
    const size = formatSize(sizeInput, asset.precision.sizeDecimals);

    return {
      marketSymbol: asset.symbol,
      marketType: asset.kind,
      assetId: asset.assetId,
      side: request.side,
      price,
      size,
      reduceOnly: request.reduceOnly === true,
      orderType: request.trigger !== undefined
        ? this.formatTriggerOrder(asset, request.trigger)
        : {
            kind: "limit",
            timeInForce: request.timeInForce ?? "Gtc"
          },
      grouping: request.grouping ?? "na",
      clientOrderId: request.clientOrderId
    };
  }

  private formatTriggerOrder(
    asset: AssetRegistryEntry,
    trigger: TriggerOrderRequest
  ): FormattedOrderRequest["orderType"] {
    const triggerInput = stringifyNumericInput(trigger.triggerPrice);

    if (!isPositiveDecimal(triggerInput)) {
      throw new OrderFormattingError("Trigger price must be greater than zero");
    }

    return {
      kind: "trigger",
      isMarket: trigger.isMarket,
      triggerPrice: formatPrice(triggerInput, asset.precision.sizeDecimals, asset.kind),
      triggerKind: trigger.kind
    };
  }

  private normalizeOrderReference(reference: OrderReference): OrderReference {
    if ("clientOrderId" in reference) {
      return {
        marketSymbol: this.resolveAsset(reference.marketSymbol).symbol,
        clientOrderId: this.cloidService.normalize(reference.clientOrderId)
      };
    }

    if (!Number.isSafeInteger(reference.orderId) || reference.orderId < 0) {
      throw new OrderFormattingError("orderId must be a non-negative safe integer");
    }

    return {
      marketSymbol: this.resolveAsset(reference.marketSymbol).symbol,
      orderId: reference.orderId
    };
  }

  private resolveAsset(marketSymbol: string): AssetRegistryEntry {
    return this.requireRegistry().requireBySymbol(marketSymbol.trim().toUpperCase());
  }

  private resolvePerpAsset(marketSymbol: string): PerpAssetRecord {
    return this.requireRegistry().requirePerpBySymbol(marketSymbol.trim().toUpperCase());
  }

  private requireRegistry(): AssetRegistry {
    const registry = this.getRegistry();

    if (registry === undefined) {
      throw new OrderFormattingError("Asset registry is unavailable for order formatting");
    }

    return registry;
  }
}

function stringifyNumericInput(value: string | number): string {
  return normalizeDecimalString(String(value));
}
