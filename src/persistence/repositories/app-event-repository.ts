import type Database from "better-sqlite3";

import type { AppEventRecordInput } from "../../core/types.js";
import { serializeJson } from "./shared.js";

export class AppEventRepository {
  private readonly insertStatement: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.insertStatement = this.db.prepare(`
      INSERT INTO app_events (
        boot_id,
        event_time,
        event_type,
        severity,
        component,
        message,
        payload_json
      ) VALUES (
        @bootId,
        @eventTime,
        @eventType,
        @severity,
        @component,
        @message,
        @payloadJson
      )
    `);
  }

  insert(input: AppEventRecordInput): void {
    this.insertStatement.run({
      bootId: input.bootId,
      eventTime: input.eventTime,
      eventType: input.eventType,
      severity: input.severity,
      component: input.component,
      message: input.message,
      payloadJson: serializeJson(input.payload)
    });
  }
}
