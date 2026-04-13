import type { RiskConfig } from "../core/types.js";

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxOrderNotionalUsd: "500",
  maxOpenOrders: 8,
  maxConcurrentPositions: 3,
  maxPriceDeviationBps: 150,
  maxLeverageFractionOfExchangeMax: 0.5,
  defaultRiskFractionOfAccount: "0.005",
  enforceStopLossForEntries: false
};
