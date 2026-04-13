import { compareDecimalStrings, normalizeDecimalString } from "../../core/decimal.js";
import type { ExecutionOrderSide } from "../../exchange/execution-types.js";

export interface FundingGuardResult {
  readonly ok: boolean;
  readonly message: string;
  readonly fundingRate: string;
}

export function evaluateFundingRate(args: {
  readonly side: ExecutionOrderSide;
  readonly fundingRate: string;
  readonly maxAbsoluteFundingRate: string;
}): FundingGuardResult {
  const threshold = normalizeDecimalString(args.maxAbsoluteFundingRate);
  const fundingRate = normalizeDecimalString(args.fundingRate);

  if (args.side === "buy" && compareDecimalStrings(fundingRate, threshold) === 1) {
    return {
      ok: false,
      message: `Funding rate ${fundingRate} is too hostile for new long exposure`,
      fundingRate
    };
  }

  if (args.side === "sell" && compareDecimalStrings(fundingRate, `-${threshold}`) === -1) {
    return {
      ok: false,
      message: `Funding rate ${fundingRate} is too hostile for new short exposure`,
      fundingRate
    };
  }

  return {
    ok: true,
    message: "Funding rate is within the configured directional threshold",
    fundingRate
  };
}
