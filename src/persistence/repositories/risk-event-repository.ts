import type Database from "better-sqlite3";

import type { RiskEventRecord } from "../../risk/types.js";
import { deserializeJson, serializeJson } from "./shared.js";

interface RiskEventRow {
  readonly occurred_at: string;
  readonly action_type: string;
  readonly operator_address: string;
  readonly trust_state: string;
  readonly decision: string;
  readonly market_symbol: string | null;
  readonly asset_id: number | null;
  readonly correlation_id: string | null;
  readonly message: string;
  readonly details_json: string | null;
}

export class RiskEventRepository {
  private readonly insertStatement: Database.Statement;
  private readonly listRecentStatement: Database.Statement<[number], RiskEventRow>;

  constructor(private readonly db: Database.Database) {
    this.insertStatement = this.db.prepare(`
      INSERT INTO risk_event_records (
        boot_id,
        occurred_at,
        action_type,
        operator_address,
        trust_state,
        decision,
        market_symbol,
        asset_id,
        correlation_id,
        message,
        details_json
      ) VALUES (
        @bootId,
        @occurredAt,
        @actionType,
        @operatorAddress,
        @trustState,
        @decision,
        @marketSymbol,
        @assetId,
        @correlationId,
        @message,
        @detailsJson
      )
    `);

    this.listRecentStatement = this.db.prepare(`
      SELECT
        occurred_at,
        action_type,
        operator_address,
        trust_state,
        decision,
        market_symbol,
        asset_id,
        correlation_id,
        message,
        details_json
      FROM risk_event_records
      ORDER BY id DESC
      LIMIT ?
    `);
  }

  insert(record: RiskEventRecord, bootId?: string): void {
    this.insertStatement.run({
      bootId: bootId ?? null,
      occurredAt: record.occurredAt,
      actionType: record.actionType,
      operatorAddress: record.operatorAddress,
      trustState: record.trustState,
      decision: record.decision,
      marketSymbol: record.marketSymbol ?? null,
      assetId: record.assetId ?? null,
      correlationId: record.correlationId ?? null,
      message: record.message,
      detailsJson: serializeJson(record.details)
    });
  }

  listRecent(limit = 20): readonly RiskEventRecord[] {
    return this.listRecentStatement.all(limit).map((row) => ({
      occurredAt: row.occurred_at,
      actionType: row.action_type as RiskEventRecord["actionType"],
      operatorAddress: row.operator_address as RiskEventRecord["operatorAddress"],
      trustState: row.trust_state as RiskEventRecord["trustState"],
      decision: row.decision as RiskEventRecord["decision"],
      message: row.message,
      ...(row.market_symbol !== null ? { marketSymbol: row.market_symbol } : {}),
      ...(row.asset_id !== null ? { assetId: row.asset_id } : {}),
      ...(row.correlation_id !== null ? { correlationId: row.correlation_id } : {}),
      ...(row.details_json !== null ? { details: deserializeJson(row.details_json)! } : {})
    }));
  }
}
