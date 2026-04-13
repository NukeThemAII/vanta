import type Database from "better-sqlite3";
import type { Address } from "viem";

import type { AccountMirrorSnapshot } from "../../portfolio/account-mirror.js";
import type { OpenOrderStateSnapshot } from "../../exchange/open-order-mirror.js";
import { deserializeJson } from "./shared.js";

interface SnapshotJsonRow {
  readonly snapshot_json: string;
}

export class StateSnapshotRepository {
  private readonly insertAccountSnapshotStatement: Database.Statement;
  private readonly insertPositionSnapshotStatement: Database.Statement;
  private readonly insertBalanceSnapshotStatement: Database.Statement;
  private readonly insertOpenOrderRunStatement: Database.Statement;
  private readonly insertOpenOrderItemStatement: Database.Statement;
  private readonly latestAccountSnapshotStatement: Database.Statement<[string], SnapshotJsonRow>;
  private readonly latestOpenOrderSnapshotStatement: Database.Statement<[string], SnapshotJsonRow>;

  constructor(private readonly db: Database.Database) {
    this.insertAccountSnapshotStatement = this.db.prepare(`
      INSERT INTO account_snapshots (
        boot_id,
        created_at,
        source,
        operator_address,
        network,
        snapshot_json
      ) VALUES (
        @bootId,
        @createdAt,
        @source,
        @operatorAddress,
        @network,
        @snapshotJson
      )
    `);

    this.insertPositionSnapshotStatement = this.db.prepare(`
      INSERT INTO position_snapshots (
        account_snapshot_id,
        asset_id,
        market_symbol,
        direction,
        size,
        leverage_type,
        leverage_value,
        status_json
      ) VALUES (
        @accountSnapshotId,
        @assetId,
        @marketSymbol,
        @direction,
        @size,
        @leverageType,
        @leverageValue,
        @statusJson
      )
    `);

    this.insertBalanceSnapshotStatement = this.db.prepare(`
      INSERT INTO balance_snapshots (
        account_snapshot_id,
        token_index,
        coin,
        total,
        hold,
        entry_ntl
      ) VALUES (
        @accountSnapshotId,
        @tokenIndex,
        @coin,
        @total,
        @hold,
        @entryNtl
      )
    `);

    this.insertOpenOrderRunStatement = this.db.prepare(`
      INSERT INTO open_order_snapshot_runs (
        boot_id,
        created_at,
        source,
        operator_address,
        network,
        snapshot_json
      ) VALUES (
        @bootId,
        @createdAt,
        @source,
        @operatorAddress,
        @network,
        @snapshotJson
      )
    `);

    this.insertOpenOrderItemStatement = this.db.prepare(`
      INSERT INTO open_order_snapshot_items (
        snapshot_run_id,
        order_id,
        client_order_id,
        market_symbol,
        asset_id,
        market_type,
        side,
        limit_price,
        size,
        original_size,
        status,
        status_timestamp_ms,
        placed_timestamp_ms,
        raw_json
      ) VALUES (
        @snapshotRunId,
        @orderId,
        @clientOrderId,
        @marketSymbol,
        @assetId,
        @marketType,
        @side,
        @limitPrice,
        @size,
        @originalSize,
        @status,
        @statusTimestampMs,
        @placedTimestampMs,
        @rawJson
      )
    `);

    this.latestAccountSnapshotStatement = this.db.prepare(`
      SELECT snapshot_json
      FROM account_snapshots
      WHERE operator_address = ?
      ORDER BY id DESC
      LIMIT 1
    `);

    this.latestOpenOrderSnapshotStatement = this.db.prepare(`
      SELECT snapshot_json
      FROM open_order_snapshot_runs
      WHERE operator_address = ?
      ORDER BY id DESC
      LIMIT 1
    `);
  }

  saveAccountSnapshot(snapshot: AccountMirrorSnapshot, bootId?: string): number {
    const transaction = this.db.transaction(() => {
      const result = this.insertAccountSnapshotStatement.run({
        bootId: bootId ?? null,
        createdAt: snapshot.syncedAt,
        source: snapshot.source,
        operatorAddress: snapshot.operatorAddress,
        network: snapshot.network,
        snapshotJson: JSON.stringify(snapshot)
      });

      const accountSnapshotId = Number(result.lastInsertRowid);

      for (const position of snapshot.positions) {
        this.insertPositionSnapshotStatement.run({
          accountSnapshotId,
          assetId: position.assetId,
          marketSymbol: position.marketSymbol,
          direction: position.direction,
          size: position.size,
          leverageType: position.leverageType,
          leverageValue: position.leverageValue,
          statusJson: JSON.stringify(position)
        });
      }

      for (const balance of snapshot.spotBalances) {
        this.insertBalanceSnapshotStatement.run({
          accountSnapshotId,
          tokenIndex: balance.tokenIndex,
          coin: balance.coin,
          total: balance.total,
          hold: balance.hold,
          entryNtl: balance.entryNotional
        });
      }

      return accountSnapshotId;
    });

    return transaction();
  }

  saveOpenOrderSnapshot(snapshot: OpenOrderStateSnapshot, bootId?: string): number {
    const transaction = this.db.transaction(() => {
      const result = this.insertOpenOrderRunStatement.run({
        bootId: bootId ?? null,
        createdAt: snapshot.syncedAt,
        source: snapshot.source,
        operatorAddress: snapshot.operatorAddress,
        network: snapshot.network,
        snapshotJson: JSON.stringify(snapshot)
      });

      const snapshotRunId = Number(result.lastInsertRowid);

      for (const order of snapshot.orders) {
        this.insertOpenOrderItemStatement.run({
          snapshotRunId,
          orderId: order.orderId,
          clientOrderId: order.clientOrderId,
          marketSymbol: order.marketSymbol,
          assetId: order.assetId,
          marketType: order.marketType,
          side: order.side,
          limitPrice: order.limitPrice,
          size: order.size,
          originalSize: order.originalSize,
          status: order.status,
          statusTimestampMs: order.statusTimestampMs,
          placedTimestampMs: order.placedTimestampMs,
          rawJson: JSON.stringify(order)
        });
      }

      return snapshotRunId;
    });

    return transaction();
  }

  getLatestAccountSnapshot(operatorAddress: Address): AccountMirrorSnapshot | undefined {
    const row = this.latestAccountSnapshotStatement.get(operatorAddress);
    return deserializeJson<AccountMirrorSnapshot>(row?.snapshot_json ?? null);
  }

  getLatestOpenOrderSnapshot(operatorAddress: Address): OpenOrderStateSnapshot | undefined {
    const row = this.latestOpenOrderSnapshotStatement.get(operatorAddress);
    return deserializeJson<OpenOrderStateSnapshot>(row?.snapshot_json ?? null);
  }
}
