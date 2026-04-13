export interface CooldownGuardResult {
  readonly ok: boolean;
  readonly message: string;
  readonly consecutiveLossCount: number;
  readonly cooldownEndsAtMs?: number;
}

export function evaluateConsecutiveLossCooldown(args: {
  readonly consecutiveLossCount: number;
  readonly lastLossTimestampMs?: number;
  readonly cooldownCount: number;
  readonly cooldownMinutes: number;
  readonly nowMs?: number;
}): CooldownGuardResult {
  const nowMs = args.nowMs ?? Date.now();
  if (args.consecutiveLossCount < args.cooldownCount || args.lastLossTimestampMs === undefined) {
    return {
      ok: true,
      message: "Consecutive-loss cooldown is not active",
      consecutiveLossCount: args.consecutiveLossCount
    };
  }

  const cooldownEndsAtMs = args.lastLossTimestampMs + args.cooldownMinutes * 60_000;
  if (nowMs < cooldownEndsAtMs) {
    return {
      ok: false,
      message: `Consecutive-loss cooldown active after ${args.consecutiveLossCount} losing close fills`,
      consecutiveLossCount: args.consecutiveLossCount,
      cooldownEndsAtMs
    };
  }

  return {
    ok: true,
    message: "Consecutive-loss cooldown window has expired",
    consecutiveLossCount: args.consecutiveLossCount,
    cooldownEndsAtMs
  };
}
