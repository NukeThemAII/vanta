import type { RiskConfig } from "../core/types.js";

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxOrderNotionalUsd: "500",
  maxOpenOrders: 8,
  maxConcurrentPositions: 3,
  maxPriceDeviationBps: 150,
  maxLeverageFractionOfExchangeMax: 0.5,
  defaultRiskFractionOfAccount: "0.005",
  maxDailyRealizedDrawdownUsd: "50",
  maxWeeklyRealizedDrawdownUsd: "150",
  consecutiveLossCooldownCount: 3,
  consecutiveLossCooldownMinutes: 60,
  maxAbsoluteFundingRate: "0.0008",
  minRateLimitSurplus: 25,
  enforceStopLossForEntries: false
};
