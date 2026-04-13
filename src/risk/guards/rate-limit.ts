import type { UserRateLimitSnapshot } from "../../portfolio/account-mirror.js";

export interface RateLimitGuardResult {
  readonly ok: boolean;
  readonly message: string;
  readonly requestsSurplus?: number;
}

export function evaluateRateLimitHeadroom(args: {
  readonly rateLimit: UserRateLimitSnapshot | undefined;
  readonly minRateLimitSurplus: number;
}): RateLimitGuardResult {
  if (args.rateLimit === undefined) {
    return {
      ok: false,
      message: "Rate-limit snapshot is unavailable for risk checks"
    };
  }

  if (args.rateLimit.requestsSurplus < args.minRateLimitSurplus) {
    return {
      ok: false,
      message: `Rate-limit surplus ${args.rateLimit.requestsSurplus} is below configured minimum ${args.minRateLimitSurplus}`,
      requestsSurplus: args.rateLimit.requestsSurplus
    };
  }

  return {
    ok: true,
    message: "Rate-limit surplus is within the configured headroom threshold",
    requestsSurplus: args.rateLimit.requestsSurplus
  };
}
