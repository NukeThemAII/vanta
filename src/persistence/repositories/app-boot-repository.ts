import type Database from "better-sqlite3";

import type { AppBootRecordInput, AppBootStatusUpdate } from "../../core/types.js";
import { serializeJson } from "./shared.js";

export class AppBootRepository {
  private readonly insertStatement: Database.Statement;
  private readonly updateStatement: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.insertStatement = this.db.prepare(`
      INSERT INTO app_boots (
        boot_id,
        started_at,
        status,
        app_env,
        network,
        markets_json,
        operator_address
      ) VALUES (
        @bootId,
        @startedAt,
        'starting',
        @appEnv,
        @network,
        @marketsJson,
        @operatorAddress
      )
    `);

    this.updateStatement = this.db.prepare(`
      UPDATE app_boots
      SET
        completed_at = @completedAt,
        status = @status,
        bootstrap_summary_json = @bootstrapSummaryJson,
        error_message = @errorMessage,
        stop_reason = @stopReason
      WHERE boot_id = @bootId
    `);
  }

  recordStart(input: AppBootRecordInput): void {
    this.insertStatement.run({
      bootId: input.bootId,
      startedAt: input.startedAt,
      appEnv: input.appEnv,
      network: input.network,
      marketsJson: JSON.stringify(input.markets),
      operatorAddress: input.operatorAddress ?? null
    });
  }

  updateStatus(update: AppBootStatusUpdate): void {
    this.updateStatement.run({
      bootId: update.bootId,
      completedAt: update.completedAt,
      status: update.status,
      bootstrapSummaryJson: serializeJson(update.bootstrapSummary),
      errorMessage: update.errorMessage ?? null,
      stopReason: update.stopReason ?? null
    });
  }
}
