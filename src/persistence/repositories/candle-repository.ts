import type Database from "better-sqlite3";

import type { FoundationMarket } from "../../config/markets.js";
import type { NetworkName } from "../../core/types.js";
import type { CandleBar, CandleInterval } from "../../marketdata/candle-store.js";

interface CandleBarRow {
  readonly network: string;
  readonly market: string;
  readonly interval: string;
  readonly open_time_ms: number;
  readonly close_time_ms: number;
  readonly open_price: string;
  readonly high_price: string;
  readonly low_price: string;
  readonly close_price: string;
  readonly base_volume: string;
  readonly quote_volume: string;
  readonly trade_count: number;
  readonly first_trade_time_ms: number;
  readonly last_trade_time_ms: number;
  readonly updated_at: string;
}

export class CandleRepository {
  private readonly upsertStatement: Database.Statement;
  private readonly getStatement: Database.Statement<[string, string, string, number], CandleBarRow>;
  private readonly listRecentStatement: Database.Statement<[string, string, string, number], CandleBarRow>;

  constructor(private readonly db: Database.Database) {
    this.upsertStatement = this.db.prepare(`
      INSERT INTO candle_bars (
        boot_id,
        network,
        market,
        interval,
        open_time_ms,
        close_time_ms,
        open_price,
        high_price,
        low_price,
        close_price,
        base_volume,
        quote_volume,
        trade_count,
        first_trade_time_ms,
        last_trade_time_ms,
        updated_at
      ) VALUES (
        @bootId,
        @network,
        @market,
        @interval,
        @openTimeMs,
        @closeTimeMs,
        @openPrice,
        @highPrice,
        @lowPrice,
        @closePrice,
        @baseVolume,
        @quoteVolume,
        @tradeCount,
        @firstTradeTimeMs,
        @lastTradeTimeMs,
        @updatedAt
      )
      ON CONFLICT(network, market, interval, open_time_ms) DO UPDATE SET
        boot_id = excluded.boot_id,
        close_time_ms = excluded.close_time_ms,
        open_price = excluded.open_price,
        high_price = excluded.high_price,
        low_price = excluded.low_price,
        close_price = excluded.close_price,
        base_volume = excluded.base_volume,
        quote_volume = excluded.quote_volume,
        trade_count = excluded.trade_count,
        first_trade_time_ms = excluded.first_trade_time_ms,
        last_trade_time_ms = excluded.last_trade_time_ms,
        updated_at = excluded.updated_at
    `);

    this.getStatement = this.db.prepare(`
      SELECT
        network,
        market,
        interval,
        open_time_ms,
        close_time_ms,
        open_price,
        high_price,
        low_price,
        close_price,
        base_volume,
        quote_volume,
        trade_count,
        first_trade_time_ms,
        last_trade_time_ms,
        updated_at
      FROM candle_bars
      WHERE network = ?
        AND market = ?
        AND interval = ?
        AND open_time_ms = ?
    `);

    this.listRecentStatement = this.db.prepare(`
      SELECT
        network,
        market,
        interval,
        open_time_ms,
        close_time_ms,
        open_price,
        high_price,
        low_price,
        close_price,
        base_volume,
        quote_volume,
        trade_count,
        first_trade_time_ms,
        last_trade_time_ms,
        updated_at
      FROM candle_bars
      WHERE network = ?
        AND market = ?
        AND interval = ?
      ORDER BY open_time_ms DESC
      LIMIT ?
    `);
  }

  get(args: {
    readonly network: NetworkName;
    readonly market: FoundationMarket;
    readonly interval: CandleInterval;
    readonly openTimeMs: number;
  }): CandleBar | undefined {
    const row = this.getStatement.get(args.network, args.market, args.interval, args.openTimeMs);
    return row === undefined ? undefined : hydrateCandleBar(row);
  }

  upsert(bar: CandleBar, bootId?: string): void {
    this.upsertStatement.run({
      bootId: bootId ?? null,
      network: bar.network,
      market: bar.market,
      interval: bar.interval,
      openTimeMs: bar.openTimeMs,
      closeTimeMs: bar.closeTimeMs,
      openPrice: bar.openPrice,
      highPrice: bar.highPrice,
      lowPrice: bar.lowPrice,
      closePrice: bar.closePrice,
      baseVolume: bar.baseVolume,
      quoteVolume: bar.quoteVolume,
      tradeCount: bar.tradeCount,
      firstTradeTimeMs: bar.firstTradeTimeMs,
      lastTradeTimeMs: bar.lastTradeTimeMs,
      updatedAt: bar.updatedAt
    });
  }

  upsertMany(bars: readonly CandleBar[], bootId?: string): void {
    const transaction = this.db.transaction(() => {
      for (const bar of bars) {
        this.upsert(bar, bootId);
      }
    });

    transaction();
  }

  listRecent(args: {
    readonly network: NetworkName;
    readonly market: FoundationMarket;
    readonly interval: CandleInterval;
    readonly limit?: number;
  }): readonly CandleBar[] {
    return this.listRecentStatement
      .all(args.network, args.market, args.interval, args.limit ?? 20)
      .map(hydrateCandleBar);
  }
}

function hydrateCandleBar(row: CandleBarRow): CandleBar {
  return {
    network: row.network as NetworkName,
    market: row.market as FoundationMarket,
    interval: row.interval as CandleInterval,
    openTimeMs: row.open_time_ms,
    closeTimeMs: row.close_time_ms,
    openPrice: row.open_price,
    highPrice: row.high_price,
    lowPrice: row.low_price,
    closePrice: row.close_price,
    baseVolume: row.base_volume,
    quoteVolume: row.quote_volume,
    tradeCount: row.trade_count,
    firstTradeTimeMs: row.first_trade_time_ms,
    lastTradeTimeMs: row.last_trade_time_ms,
    updatedAt: row.updated_at
  };
}
