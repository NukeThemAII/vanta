import type Database from "better-sqlite3";

import type { OrderStateRecord, OrderStateTransitionRecord } from "../../exchange/execution-types.js";
import { deserializeJson, serializeJson } from "./shared.js";

interface OrderStateRow {
  readonly order_key: string;
  readonly operator_address: string;
  readonly market_symbol: string;
  readonly asset_id: number;
  readonly market_type: string;
  readonly state: string;
  readonly side: string | null;
  readonly order_id: number | null;
  readonly client_order_id: string | null;
  readonly limit_price: string | null;
  readonly original_size: string | null;
  readonly filled_size: string;
  readonly average_fill_price: string | null;
  readonly last_source: string;
  readonly updated_at: string;
  readonly event_timestamp_ms: number | null;
  readonly rejection_reason: string | null;
  readonly metadata_json: string | null;
}

export class OrderStateRepository {
  private readonly upsertStateStatement: Database.Statement;
  private readonly insertTransitionStatement: Database.Statement;
  private readonly getByOrderKeyStatement: Database.Statement<[string], OrderStateRow>;
  private readonly getByOrderIdStatement: Database.Statement<[number], OrderStateRow>;
  private readonly getByClientOrderIdStatement: Database.Statement<[string], OrderStateRow>;

  constructor(private readonly db: Database.Database) {
    this.upsertStateStatement = this.db.prepare(`
      INSERT INTO order_state_records (
        order_key,
        operator_address,
        market_symbol,
        asset_id,
        market_type,
        state,
        side,
        order_id,
        client_order_id,
        limit_price,
        original_size,
        filled_size,
        average_fill_price,
        last_source,
        updated_at,
        event_timestamp_ms,
        rejection_reason,
        metadata_json
      ) VALUES (
        @orderKey,
        @operatorAddress,
        @marketSymbol,
        @assetId,
        @marketType,
        @state,
        @side,
        @orderId,
        @clientOrderId,
        @limitPrice,
        @originalSize,
        @filledSize,
        @averageFillPrice,
        @lastSource,
        @updatedAt,
        @eventTimestampMs,
        @rejectionReason,
        @metadataJson
      )
      ON CONFLICT(order_key) DO UPDATE SET
        operator_address = excluded.operator_address,
        market_symbol = excluded.market_symbol,
        asset_id = excluded.asset_id,
        market_type = excluded.market_type,
        state = excluded.state,
        side = excluded.side,
        order_id = excluded.order_id,
        client_order_id = excluded.client_order_id,
        limit_price = excluded.limit_price,
        original_size = excluded.original_size,
        filled_size = excluded.filled_size,
        average_fill_price = excluded.average_fill_price,
        last_source = excluded.last_source,
        updated_at = excluded.updated_at,
        event_timestamp_ms = excluded.event_timestamp_ms,
        rejection_reason = excluded.rejection_reason,
        metadata_json = excluded.metadata_json
    `);

    this.insertTransitionStatement = this.db.prepare(`
      INSERT INTO order_state_transitions (
        transition_id,
        action_id,
        order_key,
        operator_address,
        market_symbol,
        asset_id,
        occurred_at,
        source,
        from_state,
        to_state,
        order_id,
        client_order_id,
        event_timestamp_ms,
        payload_json
      ) VALUES (
        @transitionId,
        @actionId,
        @orderKey,
        @operatorAddress,
        @marketSymbol,
        @assetId,
        @occurredAt,
        @source,
        @fromState,
        @toState,
        @orderId,
        @clientOrderId,
        @eventTimestampMs,
        @payloadJson
      )
    `);

    this.getByOrderKeyStatement = this.db.prepare(`
      SELECT *
      FROM order_state_records
      WHERE order_key = ?
      LIMIT 1
    `);

    this.getByOrderIdStatement = this.db.prepare(`
      SELECT *
      FROM order_state_records
      WHERE order_id = ?
      LIMIT 1
    `);

    this.getByClientOrderIdStatement = this.db.prepare(`
      SELECT *
      FROM order_state_records
      WHERE client_order_id = ?
      LIMIT 1
    `);
  }

  upsertState(record: OrderStateRecord): void {
    this.upsertStateStatement.run({
      orderKey: record.orderKey,
      operatorAddress: record.operatorAddress,
      marketSymbol: record.marketSymbol,
      assetId: record.assetId,
      marketType: record.marketType,
      state: record.state,
      side: record.side ?? null,
      orderId: record.orderId ?? null,
      clientOrderId: record.clientOrderId ?? null,
      limitPrice: record.limitPrice ?? null,
      originalSize: record.originalSize ?? null,
      filledSize: record.filledSize,
      averageFillPrice: record.averageFillPrice ?? null,
      lastSource: record.lastSource,
      updatedAt: record.updatedAt,
      eventTimestampMs: record.eventTimestampMs ?? null,
      rejectionReason: record.rejectionReason ?? null,
      metadataJson: serializeJson(record.metadata)
    });
  }

  insertTransition(record: OrderStateTransitionRecord): void {
    this.insertTransitionStatement.run({
      transitionId: record.transitionId,
      actionId: record.actionId ?? null,
      orderKey: record.orderKey,
      operatorAddress: record.operatorAddress,
      marketSymbol: record.marketSymbol,
      assetId: record.assetId,
      occurredAt: record.occurredAt,
      source: record.source,
      fromState: record.fromState ?? null,
      toState: record.toState,
      orderId: record.orderId ?? null,
      clientOrderId: record.clientOrderId ?? null,
      eventTimestampMs: record.eventTimestampMs ?? null,
      payloadJson: serializeJson(record.payload)
    });
  }

  getByOrderKey(orderKey: string): OrderStateRecord | undefined {
    const row = this.getByOrderKeyStatement.get(orderKey);
    return row === undefined ? undefined : hydrateOrderStateRecord(row);
  }

  getByOrderId(orderId: number): OrderStateRecord | undefined {
    const row = this.getByOrderIdStatement.get(orderId);
    return row === undefined ? undefined : hydrateOrderStateRecord(row);
  }

  getByClientOrderId(clientOrderId: string): OrderStateRecord | undefined {
    const row = this.getByClientOrderIdStatement.get(clientOrderId);
    return row === undefined ? undefined : hydrateOrderStateRecord(row);
  }
}

function hydrateOrderStateRecord(row: OrderStateRow): OrderStateRecord {
  return {
    orderKey: row.order_key,
    operatorAddress: row.operator_address as OrderStateRecord["operatorAddress"],
    marketSymbol: row.market_symbol,
    assetId: row.asset_id,
    marketType: row.market_type as OrderStateRecord["marketType"],
    state: row.state as OrderStateRecord["state"],
    filledSize: row.filled_size,
    lastSource: row.last_source as OrderStateRecord["lastSource"],
    updatedAt: row.updated_at,
    ...(row.side !== null ? { side: row.side as NonNullable<OrderStateRecord["side"]> } : {}),
    ...(row.order_id !== null ? { orderId: row.order_id } : {}),
    ...(row.client_order_id !== null ? { clientOrderId: row.client_order_id as NonNullable<OrderStateRecord["clientOrderId"]> } : {}),
    ...(row.limit_price !== null ? { limitPrice: row.limit_price } : {}),
    ...(row.original_size !== null ? { originalSize: row.original_size } : {}),
    ...(row.average_fill_price !== null ? { averageFillPrice: row.average_fill_price } : {}),
    ...(row.event_timestamp_ms !== null ? { eventTimestampMs: row.event_timestamp_ms } : {}),
    ...(row.rejection_reason !== null ? { rejectionReason: row.rejection_reason } : {}),
    ...(row.metadata_json !== null ? { metadata: deserializeJson(row.metadata_json)! } : {})
  };
}
