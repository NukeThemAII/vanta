import {
  addDecimalStrings,
  compareDecimalStrings,
  divideDecimalStrings,
  multiplyDecimalStrings,
  subtractDecimalStrings
} from "../../core/decimal.js";
import type { ExecutionOrderSide, FormattedOrderRequest } from "../../exchange/execution-types.js";

export interface SlippageGuardResult {
  readonly ok: boolean;
  readonly message: string;
  readonly referencePrice: string;
  readonly boundaryPrice: string;
  readonly actualPrice: string;
}

export function evaluatePriceDeviation(args: {
  readonly order: FormattedOrderRequest;
  readonly referencePrice: string;
  readonly maxPriceDeviationBps: number;
}): SlippageGuardResult {
  if (args.order.orderType.kind !== "limit" || args.order.orderType.timeInForce === "Alo") {
    return {
      ok: true,
      message: "Passive or non-limit order skipped by price-deviation guard",
      referencePrice: args.referencePrice,
      boundaryPrice: args.referencePrice,
      actualPrice: args.order.price
    };
  }

  const deviationFraction = divideDecimalStrings(String(args.maxPriceDeviationBps), "10000", 8);
  const upperBoundary = multiplyDecimalStrings(
    args.referencePrice,
    addDecimalStrings("1", deviationFraction)
  );
  const lowerBoundary = multiplyDecimalStrings(
    args.referencePrice,
    subtractDecimalStrings("1", deviationFraction)
  );

  if (isAggressiveOutsideBoundary(args.order.side, args.order.price, upperBoundary, lowerBoundary)) {
    return {
      ok: false,
      message: `Order price exceeds max aggressive deviation of ${args.maxPriceDeviationBps} bps`,
      referencePrice: args.referencePrice,
      boundaryPrice: args.order.side === "buy" ? upperBoundary : lowerBoundary,
      actualPrice: args.order.price
    };
  }

  return {
    ok: true,
    message: "Order price is within the configured aggressive-deviation guard",
    referencePrice: args.referencePrice,
    boundaryPrice: args.order.side === "buy" ? upperBoundary : lowerBoundary,
    actualPrice: args.order.price
  };
}

function isAggressiveOutsideBoundary(
  side: ExecutionOrderSide,
  actualPrice: string,
  upperBoundary: string,
  lowerBoundary: string
): boolean {
  if (side === "buy") {
    return compareDecimalStrings(actualPrice, upperBoundary) === 1;
  }

  return compareDecimalStrings(actualPrice, lowerBoundary) === -1;
}
