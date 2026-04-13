import type { PerpAssetRecord } from "../../exchange/asset-registry.js";

export interface LeverageGuardResult {
  readonly ok: boolean;
  readonly message: string;
  readonly maxAllowedLeverage: number;
}

export function evaluateLeverageLimit(args: {
  readonly asset: PerpAssetRecord;
  readonly requestedLeverage: number;
  readonly maxLeverageFractionOfExchangeMax: number;
  readonly isCross: boolean;
}): LeverageGuardResult {
  const cappedExchangeLeverage = Math.max(
    1,
    Math.floor(args.asset.maxLeverage * args.maxLeverageFractionOfExchangeMax)
  );

  if (!args.isCross) {
    return {
      ok: false,
      message: "Cross-margin is required for leverage updates in MVP mode",
      maxAllowedLeverage: cappedExchangeLeverage
    };
  }

  if (args.requestedLeverage > cappedExchangeLeverage) {
    return {
      ok: false,
      message: `Requested leverage exceeds capped limit of ${cappedExchangeLeverage}x for ${args.asset.symbol}`,
      maxAllowedLeverage: cappedExchangeLeverage
    };
  }

  return {
    ok: true,
    message: "Requested leverage is within the configured cap",
    maxAllowedLeverage: cappedExchangeLeverage
  };
}
