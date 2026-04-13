import type { AccountMirrorSnapshot } from "../../portfolio/account-mirror.js";

export interface StaleStateGuardResult {
  readonly ok: boolean;
  readonly message: string;
}

export function evaluateFreshAccountState(
  snapshot: AccountMirrorSnapshot | undefined
): StaleStateGuardResult {
  if (snapshot === undefined) {
    return {
      ok: false,
      message: "Risk checks require a reconciled account snapshot"
    };
  }

  if (snapshot.staleness !== "fresh") {
    return {
      ok: false,
      message: `Account snapshot is ${snapshot.staleness}`
    };
  }

  return {
    ok: true,
    message: "Account snapshot is fresh"
  };
}
