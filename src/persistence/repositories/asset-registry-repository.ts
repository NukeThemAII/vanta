import type Database from "better-sqlite3";

import type { AssetRegistrySnapshot } from "../../exchange/asset-registry.js";
import { deserializeJson } from "./shared.js";

interface AssetRegistrySnapshotRow {
  readonly snapshot_json: string;
}

export class AssetRegistryRepository {
  private readonly insertSnapshotStatement: Database.Statement;
  private readonly insertEntryStatement: Database.Statement;
  private readonly latestSnapshotStatement: Database.Statement<[], AssetRegistrySnapshotRow>;

  constructor(private readonly db: Database.Database) {
    this.insertSnapshotStatement = this.db.prepare(`
      INSERT INTO asset_registry_snapshots (
        boot_id,
        created_at,
        network,
        snapshot_json
      ) VALUES (
        @bootId,
        @createdAt,
        @network,
        @snapshotJson
      )
    `);

    this.insertEntryStatement = this.db.prepare(`
      INSERT INTO asset_registry_entries (
        snapshot_id,
        asset_kind,
        asset_id,
        symbol,
        display_name,
        size_decimals,
        price_max_decimals,
        base_symbol,
        quote_symbol,
        token_index,
        pair_index,
        raw_json
      ) VALUES (
        @snapshotId,
        @assetKind,
        @assetId,
        @symbol,
        @displayName,
        @sizeDecimals,
        @priceMaxDecimals,
        @baseSymbol,
        @quoteSymbol,
        @tokenIndex,
        @pairIndex,
        @rawJson
      )
    `);

    this.latestSnapshotStatement = this.db.prepare(`
      SELECT snapshot_json
      FROM asset_registry_snapshots
      ORDER BY id DESC
      LIMIT 1
    `);
  }

  saveSnapshot(snapshot: AssetRegistrySnapshot, bootId?: string): number {
    const transaction = this.db.transaction(() => {
      const result = this.insertSnapshotStatement.run({
        bootId: bootId ?? null,
        createdAt: snapshot.createdAt,
        network: snapshot.network,
        snapshotJson: JSON.stringify(snapshot)
      });

      const snapshotId = Number(result.lastInsertRowid);

      for (const entry of snapshot.perps) {
        this.insertEntryStatement.run({
          snapshotId,
          assetKind: entry.kind,
          assetId: entry.assetId,
          symbol: entry.symbol,
          displayName: entry.name,
          sizeDecimals: entry.precision.sizeDecimals,
          priceMaxDecimals: entry.precision.priceMaxDecimals,
          baseSymbol: null,
          quoteSymbol: null,
          tokenIndex: null,
          pairIndex: null,
          rawJson: JSON.stringify(entry)
        });
      }

      for (const entry of snapshot.spots) {
        this.insertEntryStatement.run({
          snapshotId,
          assetKind: entry.kind,
          assetId: entry.assetId,
          symbol: entry.symbol,
          displayName: entry.name,
          sizeDecimals: entry.precision.sizeDecimals,
          priceMaxDecimals: entry.precision.priceMaxDecimals,
          baseSymbol: entry.baseSymbol,
          quoteSymbol: entry.quoteSymbol,
          tokenIndex: entry.baseTokenIndex,
          pairIndex: entry.pairIndex,
          rawJson: JSON.stringify(entry)
        });
      }

      return snapshotId;
    });

    return transaction();
  }

  getLatestSnapshot(): AssetRegistrySnapshot | undefined {
    const row = this.latestSnapshotStatement.get();
    return deserializeJson<AssetRegistrySnapshot>(row?.snapshot_json ?? null);
  }
}
