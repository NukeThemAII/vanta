import type Database from "better-sqlite3";

import type { MarketEventRecordInput } from "../../core/types.js";
import { serializeJson } from "./shared.js";

export class MarketEventRepository {
  private readonly insertStatement: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.insertStatement = this.db.prepare(`
      INSERT INTO market_events (
        boot_id,
        received_at,
        exchange_timestamp_ms,
        market,
        channel,
        payload_json
      ) VALUES (
        @bootId,
        @receivedAt,
        @exchangeTimestampMs,
        @market,
        @channel,
        @payloadJson
      )
    `);
  }

  insert(input: MarketEventRecordInput): void {
    this.insertStatement.run({
      bootId: input.bootId,
      receivedAt: input.receivedAt,
      exchangeTimestampMs: input.exchangeTimestampMs,
      market: input.market,
      channel: input.channel,
      payloadJson: serializeJson(input.payload)
    });
  }
}
