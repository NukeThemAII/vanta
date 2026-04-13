import type Database from "better-sqlite3";

import type { ExecutionActionRecord } from "../../exchange/execution-types.js";
import { deserializeJson, serializeJson } from "./shared.js";

interface ExecutionActionRow {
  readonly action_id: string;
  readonly created_at: string;
  readonly completed_at: string | null;
  readonly action_type: string;
  readonly operator_address: string;
  readonly signer_address: string;
  readonly vault_address: string | null;
  readonly status: string;
  readonly trust_state: string;
  readonly market_symbol: string | null;
  readonly asset_id: number | null;
  readonly order_id: number | null;
  readonly client_order_id: string | null;
  readonly correlation_id: string | null;
  readonly exchange_nonce: number | null;
  readonly request_json: string;
  readonly normalized_request_json: string | null;
  readonly response_json: string | null;
  readonly error_message: string | null;
}

export class ExecutionActionRepository {
  private readonly insertStatement: Database.Statement;
  private readonly updateStatement: Database.Statement;
  private readonly getByActionIdStatement: Database.Statement<[string], ExecutionActionRow>;

  constructor(private readonly db: Database.Database) {
    this.insertStatement = this.db.prepare(`
      INSERT INTO execution_actions (
        boot_id,
        action_id,
        created_at,
        completed_at,
        action_type,
        operator_address,
        signer_address,
        vault_address,
        status,
        trust_state,
        market_symbol,
        asset_id,
        order_id,
        client_order_id,
        correlation_id,
        exchange_nonce,
        request_json,
        normalized_request_json,
        response_json,
        error_message
      ) VALUES (
        @bootId,
        @actionId,
        @createdAt,
        @completedAt,
        @actionType,
        @operatorAddress,
        @signerAddress,
        @vaultAddress,
        @status,
        @trustState,
        @marketSymbol,
        @assetId,
        @orderId,
        @clientOrderId,
        @correlationId,
        @exchangeNonce,
        @requestJson,
        @normalizedRequestJson,
        @responseJson,
        @errorMessage
      )
    `);

    this.updateStatement = this.db.prepare(`
      UPDATE execution_actions
      SET
        completed_at = @completedAt,
        status = @status,
        order_id = @orderId,
        client_order_id = @clientOrderId,
        exchange_nonce = @exchangeNonce,
        normalized_request_json = @normalizedRequestJson,
        response_json = @responseJson,
        error_message = @errorMessage
      WHERE action_id = @actionId
    `);

    this.getByActionIdStatement = this.db.prepare(`
      SELECT
        action_id,
        created_at,
        completed_at,
        action_type,
        operator_address,
        signer_address,
        vault_address,
        status,
        trust_state,
        market_symbol,
        asset_id,
        order_id,
        client_order_id,
        correlation_id,
        exchange_nonce,
        request_json,
        normalized_request_json,
        response_json,
        error_message
      FROM execution_actions
      WHERE action_id = ?
      LIMIT 1
    `);
  }

  insert(record: ExecutionActionRecord, bootId?: string): void {
    this.insertStatement.run({
      bootId: bootId ?? null,
      actionId: record.actionId,
      createdAt: record.createdAt,
      completedAt: record.completedAt ?? null,
      actionType: record.actionType,
      operatorAddress: record.operatorAddress,
      signerAddress: record.signerAddress,
      vaultAddress: record.vaultAddress ?? null,
      status: record.status,
      trustState: record.trustState,
      marketSymbol: record.marketSymbol ?? null,
      assetId: record.assetId ?? null,
      orderId: record.orderId ?? null,
      clientOrderId: record.clientOrderId ?? null,
      correlationId: record.correlationId ?? null,
      exchangeNonce: record.exchangeNonce ?? null,
      requestJson: JSON.stringify(record.request),
      normalizedRequestJson: serializeJson(record.normalizedRequest),
      responseJson: serializeJson(record.response),
      errorMessage: record.errorMessage ?? null
    });
  }

  update(record: ExecutionActionRecord): void {
    this.updateStatement.run({
      actionId: record.actionId,
      completedAt: record.completedAt ?? null,
      status: record.status,
      orderId: record.orderId ?? null,
      clientOrderId: record.clientOrderId ?? null,
      exchangeNonce: record.exchangeNonce ?? null,
      normalizedRequestJson: serializeJson(record.normalizedRequest),
      responseJson: serializeJson(record.response),
      errorMessage: record.errorMessage ?? null
    });
  }

  getByActionId(actionId: string): ExecutionActionRecord | undefined {
    const row = this.getByActionIdStatement.get(actionId);

    if (row === undefined) {
      return undefined;
    }

    return {
      actionId: row.action_id,
      createdAt: row.created_at,
      actionType: row.action_type as ExecutionActionRecord["actionType"],
      operatorAddress: row.operator_address as ExecutionActionRecord["operatorAddress"],
      signerAddress: row.signer_address as ExecutionActionRecord["signerAddress"],
      status: row.status as ExecutionActionRecord["status"],
      trustState: row.trust_state as ExecutionActionRecord["trustState"],
      request: JSON.parse(row.request_json) as ExecutionActionRecord["request"],
      ...(row.completed_at !== null ? { completedAt: row.completed_at } : {}),
      ...(row.vault_address !== null ? { vaultAddress: row.vault_address as NonNullable<ExecutionActionRecord["vaultAddress"]> } : {}),
      ...(row.market_symbol !== null ? { marketSymbol: row.market_symbol } : {}),
      ...(row.asset_id !== null ? { assetId: row.asset_id } : {}),
      ...(row.order_id !== null ? { orderId: row.order_id } : {}),
      ...(row.client_order_id !== null ? { clientOrderId: row.client_order_id as NonNullable<ExecutionActionRecord["clientOrderId"]> } : {}),
      ...(row.correlation_id !== null ? { correlationId: row.correlation_id } : {}),
      ...(row.exchange_nonce !== null ? { exchangeNonce: row.exchange_nonce } : {}),
      ...(row.normalized_request_json !== null
        ? { normalizedRequest: deserializeJson(row.normalized_request_json)! }
        : {}),
      ...(row.response_json !== null ? { response: deserializeJson(row.response_json)! } : {}),
      ...(row.error_message !== null ? { errorMessage: row.error_message } : {})
    };
  }
}
