import type Database from "better-sqlite3";

import type { CloidMappingRecord } from "../../exchange/execution-types.js";

interface CloidMappingRow {
  readonly client_order_id: string;
  readonly action_id: string;
  readonly correlation_id: string;
  readonly operator_address: string;
  readonly market_symbol: string;
  readonly asset_id: number;
  readonly order_id: number | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export class CloidMappingRepository {
  private readonly upsertStatement: Database.Statement;
  private readonly getByCloidStatement: Database.Statement<[string], CloidMappingRow>;

  constructor(private readonly db: Database.Database) {
    this.upsertStatement = this.db.prepare(`
      INSERT INTO cloid_mappings (
        client_order_id,
        action_id,
        correlation_id,
        operator_address,
        market_symbol,
        asset_id,
        order_id,
        created_at,
        updated_at
      ) VALUES (
        @clientOrderId,
        @actionId,
        @correlationId,
        @operatorAddress,
        @marketSymbol,
        @assetId,
        @orderId,
        @createdAt,
        @updatedAt
      )
      ON CONFLICT(client_order_id) DO UPDATE SET
        action_id = excluded.action_id,
        correlation_id = excluded.correlation_id,
        market_symbol = excluded.market_symbol,
        asset_id = excluded.asset_id,
        order_id = excluded.order_id,
        updated_at = excluded.updated_at
    `);

    this.getByCloidStatement = this.db.prepare(`
      SELECT
        client_order_id,
        action_id,
        correlation_id,
        operator_address,
        market_symbol,
        asset_id,
        order_id,
        created_at,
        updated_at
      FROM cloid_mappings
      WHERE client_order_id = ?
      LIMIT 1
    `);
  }

  upsert(record: CloidMappingRecord): void {
    this.upsertStatement.run({
      clientOrderId: record.clientOrderId,
      actionId: record.actionId,
      correlationId: record.correlationId,
      operatorAddress: record.operatorAddress,
      marketSymbol: record.marketSymbol,
      assetId: record.assetId,
      orderId: record.orderId ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    });
  }

  getByClientOrderId(clientOrderId: string): CloidMappingRecord | undefined {
    const row = this.getByCloidStatement.get(clientOrderId);

    if (row === undefined) {
      return undefined;
    }

    return {
      clientOrderId: row.client_order_id as CloidMappingRecord["clientOrderId"],
      actionId: row.action_id,
      correlationId: row.correlation_id,
      operatorAddress: row.operator_address as CloidMappingRecord["operatorAddress"],
      marketSymbol: row.market_symbol,
      assetId: row.asset_id,
      ...(row.order_id !== null ? { orderId: row.order_id } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
