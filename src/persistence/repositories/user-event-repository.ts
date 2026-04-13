import type Database from "better-sqlite3";

import type { NormalizedUserEventRecord } from "../../exchange/user-event-normalizers.js";

export class UserEventRepository {
  private readonly insertStatement: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.insertStatement = this.db.prepare(`
      INSERT INTO user_event_records (
        boot_id,
        received_at,
        operator_address,
        event_type,
        entity_key,
        market,
        event_timestamp_ms,
        is_snapshot,
        payload_json
      ) VALUES (
        @bootId,
        @receivedAt,
        @operatorAddress,
        @eventType,
        @entityKey,
        @market,
        @eventTimestampMs,
        @isSnapshot,
        @payloadJson
      )
    `);
  }

  insert(record: NormalizedUserEventRecord, bootId?: string): void {
    this.insertStatement.run({
      bootId: bootId ?? null,
      receivedAt: record.receivedAt,
      operatorAddress: record.operatorAddress,
      eventType: record.eventType,
      entityKey: record.entityKey,
      market: record.market,
      eventTimestampMs: record.eventTimestampMs,
      isSnapshot: record.isSnapshot ? 1 : 0,
      payloadJson: JSON.stringify(record.payload)
    });
  }

  insertMany(records: readonly NormalizedUserEventRecord[], bootId?: string): void {
    const transaction = this.db.transaction(() => {
      for (const record of records) {
        this.insert(record, bootId);
      }
    });

    transaction();
  }
}
