import type Database from "better-sqlite3";

import type { FoundationMarket } from "../../config/markets.js";
import type { MarketEventRecordInput } from "../../core/types.js";
import type { LatestMarketEventTimes } from "../../marketdata/health.js";
import { serializeJson } from "./shared.js";

interface LatestMarketEventRow {
  readonly market: string;
  readonly channel: string;
  readonly received_at: string;
  readonly exchange_timestamp_ms: number | null;
}

export class MarketEventRepository {
  private readonly insertStatement: Database.Statement;
  private readonly listLatestStatement: Database.Statement<[], LatestMarketEventRow>;

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

    this.listLatestStatement = this.db.prepare(`
      SELECT
        market,
        channel,
        MAX(received_at) AS received_at,
        MAX(exchange_timestamp_ms) AS exchange_timestamp_ms
      FROM market_events
      GROUP BY market, channel
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

  getLatestTimes(): LatestMarketEventTimes {
    const result: LatestMarketEventTimes = {};

    for (const row of this.listLatestStatement.all()) {
      const market = row.market as FoundationMarket;
      const channel = row.channel as keyof NonNullable<LatestMarketEventTimes[FoundationMarket]>;
      const byMarket = result[market] ?? {};

      byMarket[channel] = {
        receivedAt: row.received_at,
        exchangeTimestampMs: row.exchange_timestamp_ms
      };

      result[market] = byMarket;
    }

    return result;
  }
}
