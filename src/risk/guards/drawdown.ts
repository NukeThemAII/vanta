import { compareDecimalStrings, subtractDecimalStrings } from "../../core/decimal.js";

export interface DrawdownGuardResult {
  readonly ok: boolean;
  readonly message: string;
  readonly dailyClosedPnl: string;
  readonly weeklyClosedPnl: string;
}

export function evaluateRealizedDrawdown(args: {
  readonly dailyClosedPnl: string;
  readonly weeklyClosedPnl: string;
  readonly maxDailyRealizedDrawdownUsd: string;
  readonly maxWeeklyRealizedDrawdownUsd: string;
}): DrawdownGuardResult {
  const dailyFloor = subtractDecimalStrings("0", args.maxDailyRealizedDrawdownUsd);
  if (compareDecimalStrings(args.dailyClosedPnl, dailyFloor) <= 0) {
    return {
      ok: false,
      message: `Daily realized drawdown ${args.dailyClosedPnl} breached configured limit -${args.maxDailyRealizedDrawdownUsd}`,
      dailyClosedPnl: args.dailyClosedPnl,
      weeklyClosedPnl: args.weeklyClosedPnl
    };
  }

  const weeklyFloor = subtractDecimalStrings("0", args.maxWeeklyRealizedDrawdownUsd);
  if (compareDecimalStrings(args.weeklyClosedPnl, weeklyFloor) <= 0) {
    return {
      ok: false,
      message: `Weekly realized drawdown ${args.weeklyClosedPnl} breached configured limit -${args.maxWeeklyRealizedDrawdownUsd}`,
      dailyClosedPnl: args.dailyClosedPnl,
      weeklyClosedPnl: args.weeklyClosedPnl
    };
  }

  return {
    ok: true,
    message: "Realized drawdown is within configured daily and weekly limits",
    dailyClosedPnl: args.dailyClosedPnl,
    weeklyClosedPnl: args.weeklyClosedPnl
  };
}
