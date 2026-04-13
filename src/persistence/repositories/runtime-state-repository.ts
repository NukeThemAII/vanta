import type Database from "better-sqlite3";

import type { RuntimeTrustTransition } from "../../core/trust-state.js";
import { deserializeJson, serializeJson } from "./shared.js";

interface RuntimeStateRow {
  readonly changed_at: string;
  readonly state: string;
  readonly reason: string;
  readonly details_json: string | null;
}

export class RuntimeStateRepository {
  private readonly insertStatement: Database.Statement;
  private readonly latestStatement: Database.Statement<[], RuntimeStateRow>;

  constructor(private readonly db: Database.Database) {
    this.insertStatement = this.db.prepare(`
      INSERT INTO runtime_state_transitions (
        boot_id,
        changed_at,
        state,
        reason,
        details_json
      ) VALUES (
        @bootId,
        @changedAt,
        @state,
        @reason,
        @detailsJson
      )
    `);

    this.latestStatement = this.db.prepare(`
      SELECT changed_at, state, reason, details_json
      FROM runtime_state_transitions
      ORDER BY id DESC
      LIMIT 1
    `);
  }

  insert(transition: RuntimeTrustTransition, bootId?: string): void {
    this.insertStatement.run({
      bootId: bootId ?? null,
      changedAt: transition.changedAt,
      state: transition.state,
      reason: transition.reason,
      detailsJson: serializeJson(transition.details)
    });
  }

  getLatest(): RuntimeTrustTransition | undefined {
    const row = this.latestStatement.get();

    if (row === undefined) {
      return undefined;
    }

    return {
      changedAt: row.changed_at,
      state: row.state as RuntimeTrustTransition["state"],
      reason: row.reason,
      ...(row.details_json !== null ? { details: deserializeJson(row.details_json)! } : {})
    };
  }
}
