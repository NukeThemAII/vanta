import type Database from "better-sqlite3";
import type { Address } from "viem";

import {
  addDecimalStrings,
  compareDecimalStrings,
  normalizeDecimalString
} from "../../core/decimal.js";
import type { FillRecord } from "../../portfolio/fills.js";

interface FillRow {
  readonly fill_key: string;
  readonly operator_address: string;
  readonly network: string;
  readonly recorded_at: string;
  readonly exchange_timestamp_ms: number;
  readonly market_symbol: string;
  readonly asset_id: number;
  readonly market_type: string;
  readonly order_id: number;
  readonly transaction_id: number;
  readonly side: string;
  readonly price: string;
  readonly size: string;
  readonly start_position: string;
  readonly direction: string;
  readonly closed_pnl: string;
  readonly fee: string;
  readonly builder_fee: string | null;
  readonly fee_token: string;
  readonly hash: string;
  readonly crossed: number;
  readonly is_snapshot: number;
  readonly client_order_id: string | null;
}

export class FillRepository {
  private readonly upsertStatement: Database.Statement;
  private readonly listRecentStatement: Database.Statement<[string, number], FillRow>;
  private readonly listClosedPnlSinceStatement: Database.Statement<[string, number], Pick<FillRow, "closed_pnl" | "exchange_timestamp_ms">>;
  private readonly listRecentClosingFillsStatement: Database.Statement<[string, string, number], Pick<FillRow, "closed_pnl" | "exchange_timestamp_ms">>;

  constructor(private readonly db: Database.Database) {
    this.upsertStatement = this.db.prepare(`
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
        @fillKey,
        @bootId,
        @operatorAddress,
        @network,
        @recordedAt,
        @exchangeTimestampMs,
        @marketSymbol,
        @assetId,
        @marketType,
        @orderId,
        @transactionId,
        @side,
        @price,
        @size,
        @startPosition,
        @direction,
        @closedPnl,
        @fee,
        @builderFee,
        @feeToken,
        @hash,
        @crossed,
        @isSnapshot,
        @clientOrderId
      )
      ON CONFLICT(fill_key) DO UPDATE SET
        boot_id = excluded.boot_id,
        operator_address = excluded.operator_address,
        network = excluded.network,
        recorded_at = excluded.recorded_at,
        exchange_timestamp_ms = excluded.exchange_timestamp_ms,
        market_symbol = excluded.market_symbol,
        asset_id = excluded.asset_id,
        market_type = excluded.market_type,
        order_id = excluded.order_id,
        transaction_id = excluded.transaction_id,
        side = excluded.side,
        price = excluded.price,
        size = excluded.size,
        start_position = excluded.start_position,
        direction = excluded.direction,
        closed_pnl = excluded.closed_pnl,
        fee = excluded.fee,
        builder_fee = excluded.builder_fee,
        fee_token = excluded.fee_token,
        hash = excluded.hash,
        crossed = excluded.crossed,
        is_snapshot = excluded.is_snapshot,
        client_order_id = excluded.client_order_id
    `);

    this.listRecentStatement = this.db.prepare(`
      SELECT *
      FROM fill_records
      WHERE operator_address = ?
      ORDER BY exchange_timestamp_ms DESC, fill_key DESC
      LIMIT ?
    `);

    this.listClosedPnlSinceStatement = this.db.prepare(`
      SELECT closed_pnl, exchange_timestamp_ms
      FROM fill_records
      WHERE operator_address = ?
        AND exchange_timestamp_ms >= ?
        AND closed_pnl != '0'
      ORDER BY exchange_timestamp_ms DESC, fill_key DESC
    `);

    this.listRecentClosingFillsStatement = this.db.prepare(`
      SELECT closed_pnl, exchange_timestamp_ms
      FROM fill_records
      WHERE operator_address = ?
        AND market_symbol = ?
        AND closed_pnl != '0'
      ORDER BY exchange_timestamp_ms DESC, fill_key DESC
      LIMIT ?
    `);
  }

  upsert(record: FillRecord, bootId?: string): void {
    this.upsertStatement.run({
      fillKey: record.fillKey,
      bootId: bootId ?? null,
      operatorAddress: record.operatorAddress,
      network: record.network,
      recordedAt: record.recordedAt,
      exchangeTimestampMs: record.exchangeTimestampMs,
      marketSymbol: record.marketSymbol,
      assetId: record.assetId,
      marketType: record.marketType,
      orderId: record.orderId,
      transactionId: record.transactionId,
      side: record.side,
      price: record.price,
      size: record.size,
      startPosition: record.startPosition,
      direction: record.direction,
      closedPnl: record.closedPnl,
      fee: record.fee,
      builderFee: record.builderFee ?? null,
      feeToken: record.feeToken,
      hash: record.hash,
      crossed: record.crossed ? 1 : 0,
      isSnapshot: record.isSnapshot ? 1 : 0,
      clientOrderId: record.clientOrderId ?? null
    });
  }

  upsertMany(records: readonly FillRecord[], bootId?: string): void {
    const transaction = this.db.transaction(() => {
      for (const record of records) {
        this.upsert(record, bootId);
      }
    });

    transaction();
  }

  listRecent(operatorAddress: Address, limit = 20): readonly FillRecord[] {
    return this.listRecentStatement.all(operatorAddress, limit).map(hydrateFillRecord);
  }

  sumClosedPnlSince(operatorAddress: Address, startTimeMs: number): string {
    const rows = this.listClosedPnlSinceStatement.all(operatorAddress, startTimeMs);
    return rows.reduce((sum, row) => addDecimalStrings(sum, normalizeDecimalString(row.closed_pnl)), "0");
  }

  getConsecutiveLossStreak(args: {
    readonly operatorAddress: Address;
    readonly marketSymbol: string;
    readonly limit: number;
  }): {
    readonly count: number;
    readonly lastLossTimestampMs?: number;
  } {
    const rows = this.listRecentClosingFillsStatement.all(args.operatorAddress, args.marketSymbol, args.limit);
    let count = 0;
    let lastLossTimestampMs: number | undefined;

    for (const row of rows) {
      if (compareDecimalStrings(row.closed_pnl, "0") === -1) {
        count += 1;
        if (lastLossTimestampMs === undefined) {
          lastLossTimestampMs = row.exchange_timestamp_ms;
        }
        continue;
      }

      break;
    }

    return {
      count,
      ...(lastLossTimestampMs !== undefined ? { lastLossTimestampMs } : {})
    };
  }
}

function hydrateFillRecord(row: FillRow): FillRecord {
  return {
    fillKey: row.fill_key,
    operatorAddress: row.operator_address as FillRecord["operatorAddress"],
    network: row.network as FillRecord["network"],
    recordedAt: row.recorded_at,
    exchangeTimestampMs: row.exchange_timestamp_ms,
    marketSymbol: row.market_symbol,
    assetId: row.asset_id,
    marketType: row.market_type as FillRecord["marketType"],
    orderId: row.order_id,
    transactionId: row.transaction_id,
    side: row.side as FillRecord["side"],
    price: row.price,
    size: row.size,
    startPosition: row.start_position,
    direction: row.direction,
    closedPnl: row.closed_pnl,
    fee: row.fee,
    feeToken: row.fee_token,
    hash: row.hash as FillRecord["hash"],
    crossed: row.crossed === 1,
    isSnapshot: row.is_snapshot === 1,
    ...(row.builder_fee !== null ? { builderFee: row.builder_fee } : {}),
    ...(row.client_order_id !== null ? { clientOrderId: row.client_order_id as NonNullable<FillRecord["clientOrderId"]> } : {})
  };
}
