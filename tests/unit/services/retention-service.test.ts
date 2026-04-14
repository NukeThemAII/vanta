import pino from "pino";
import { describe, expect, it } from "vitest";

import { DEFAULT_RETENTION_CONFIG } from "../../../src/config/retention.js";
import { SqliteDatabase } from "../../../src/persistence/db.js";
import { RetentionRepository } from "../../../src/persistence/repositories/retention-repository.js";
import { RetentionService } from "../../../src/services/retention-service.js";

describe("RetentionService", () => {
  it("previews eligible rows without deleting them", () => {
    const db = new SqliteDatabase(":memory:");
    seedTable(db, "market_events", "received_at", "2026-04-01T00:00:00.000Z");
    const service = new RetentionService(
      DEFAULT_RETENTION_CONFIG,
      new RetentionRepository(db.connection),
      pino({ level: "silent" })
    );

    const summary = service.preview(new Date("2026-04-13T00:00:00.000Z"));

    expect(summary.mode).toBe("preview");
    expect(summary.totalMatchedRows).toBeGreaterThan(0);
    expect(countRows(db, "market_events")).toBe(1);

    db.close();
  });

  it("deletes expired rows when apply is requested", () => {
    const db = new SqliteDatabase(":memory:");
    seedTable(db, "market_events", "received_at", "2026-04-01T00:00:00.000Z");
    seedTable(db, "app_events", "event_time", "2026-02-01T00:00:00.000Z");
    seedTable(db, "fill_records", "recorded_at", "2025-12-01T00:00:00.000Z");

    const service = new RetentionService(
      DEFAULT_RETENTION_CONFIG,
      new RetentionRepository(db.connection),
      pino({ level: "silent" })
    );

    const summary = service.apply({
      now: new Date("2026-04-13T00:00:00.000Z")
    });

    expect(summary.mode).toBe("apply");
    expect(summary.totalDeletedRows).toBe(3);
    expect(countRows(db, "market_events")).toBe(0);
    expect(countRows(db, "app_events")).toBe(0);
    expect(countRows(db, "fill_records")).toBe(0);

    db.close();
  });
});

function countRows(db: SqliteDatabase, table: string): number {
  return Number(db.connection.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
}

function seedTable(db: SqliteDatabase, table: string, timestampColumn: string, timestampIso: string): void {
  switch (table) {
    case "market_events":
      db.connection.prepare(`
        INSERT INTO market_events (
          boot_id,
          received_at,
          exchange_timestamp_ms,
          market,
          channel,
          payload_json
        ) VALUES (
          'boot',
          ?,
          NULL,
          'BTC',
          'mid',
          '{}'
        )
      `).run(timestampIso);
      return;
    case "app_events":
      db.connection.prepare(`
        INSERT INTO app_events (
          boot_id,
          event_time,
          event_type,
          severity,
          component,
          message,
          payload_json
        ) VALUES (
          'boot',
          ?,
          'test.event',
          'info',
          'test.component',
          'test message',
          NULL
        )
      `).run(timestampIso);
      return;
    case "fill_records":
      db.connection.prepare(`
        INSERT INTO fill_records (
          fill_key,
          boot_id,
          operator_address,
          network,
          recorded_at,
          exchange_timestamp_ms,
          market_symbol,
          asset_id,
          market_type,
          order_id,
          transaction_id,
          side,
          price,
          size,
          start_position,
          direction,
          closed_pnl,
          fee,
          builder_fee,
          fee_token,
          hash,
          crossed,
          is_snapshot,
          client_order_id
        ) VALUES (
          'fill-key',
          'boot',
          '0x1111111111111111111111111111111111111111',
          'testnet',
          ?,
          1,
          'BTC',
          0,
          'perp',
          1,
          1,
          'buy',
          '68000',
          '0.001',
          '0',
          'Open Long',
          '-1',
          '0.1',
          NULL,
          'USDC',
          '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          0,
          1,
          NULL
        )
      `).run(timestampIso);
      return;
    default:
      throw new Error(`Unhandled test table ${table} for timestamp column ${timestampColumn}`);
  }
}
