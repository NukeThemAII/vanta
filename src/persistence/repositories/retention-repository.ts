import type Database from "better-sqlite3";

import type { RetentionConfig } from "../../core/types.js";

export interface RetentionTargetResult {
  readonly target: string;
  readonly cutoffIso: string;
  readonly matchedRows: number;
  readonly deletedRows: number;
}

interface RetentionDefinition {
  readonly target: string;
  readonly table: string;
  readonly timestampColumn: string;
  readonly retentionDays: (config: RetentionConfig) => number;
}

const RETENTION_DEFINITIONS: readonly RetentionDefinition[] = [
  {
    target: "market_events",
    table: "market_events",
    timestampColumn: "received_at",
    retentionDays: (config) => config.marketEventsDays
  },
  {
    target: "app_events",
    table: "app_events",
    timestampColumn: "event_time",
    retentionDays: (config) => config.runtimeStateDays
  },
  {
    target: "app_boots",
    table: "app_boots",
    timestampColumn: "started_at",
    retentionDays: (config) => config.runtimeStateDays
  },
  {
    target: "asset_registry_snapshots",
    table: "asset_registry_snapshots",
    timestampColumn: "created_at",
    retentionDays: (config) => config.runtimeStateDays
  },
  {
    target: "account_snapshots",
    table: "account_snapshots",
    timestampColumn: "created_at",
    retentionDays: (config) => config.runtimeStateDays
  },
  {
    target: "open_order_snapshot_runs",
    table: "open_order_snapshot_runs",
    timestampColumn: "created_at",
    retentionDays: (config) => config.runtimeStateDays
  },
  {
    target: "reconciliation_runs",
    table: "reconciliation_runs",
    timestampColumn: "started_at",
    retentionDays: (config) => config.runtimeStateDays
  },
  {
    target: "user_event_records",
    table: "user_event_records",
    timestampColumn: "received_at",
    retentionDays: (config) => config.runtimeStateDays
  },
  {
    target: "runtime_state_transitions",
    table: "runtime_state_transitions",
    timestampColumn: "changed_at",
    retentionDays: (config) => config.runtimeStateDays
  },
  {
    target: "fill_records",
    table: "fill_records",
    timestampColumn: "recorded_at",
    retentionDays: (config) => config.executionAuditDays
  },
  {
    target: "execution_actions",
    table: "execution_actions",
    timestampColumn: "created_at",
    retentionDays: (config) => config.executionAuditDays
  },
  {
    target: "risk_event_records",
    table: "risk_event_records",
    timestampColumn: "occurred_at",
    retentionDays: (config) => config.executionAuditDays
  },
  {
    target: "order_state_transitions",
    table: "order_state_transitions",
    timestampColumn: "occurred_at",
    retentionDays: (config) => config.executionAuditDays
  }
] as const;

export class RetentionRepository {
  private readonly countStatements = new Map<string, Database.Statement<[string], { count: number }>>();
  private readonly deleteStatements = new Map<string, Database.Statement<[string], Database.RunResult>>();

  constructor(private readonly db: Database.Database) {
    for (const definition of RETENTION_DEFINITIONS) {
      this.countStatements.set(
        definition.target,
        this.db.prepare(`
          SELECT COUNT(*) AS count
          FROM ${definition.table}
          WHERE ${definition.timestampColumn} < ?
        `)
      );
      this.deleteStatements.set(
        definition.target,
        this.db.prepare(`
          DELETE FROM ${definition.table}
          WHERE ${definition.timestampColumn} < ?
        `)
      );
    }
  }

  preview(config: RetentionConfig, now = new Date()): readonly RetentionTargetResult[] {
    return RETENTION_DEFINITIONS.map((definition) => {
      const cutoffIso = cutoffIsoForDays(definition.retentionDays(config), now);
      const matchedRows = this.countRows(definition.target, cutoffIso);

      return {
        target: definition.target,
        cutoffIso,
        matchedRows,
        deletedRows: 0
      };
    });
  }

  apply(config: RetentionConfig, now = new Date()): readonly RetentionTargetResult[] {
    const transaction = this.db.transaction(() =>
      RETENTION_DEFINITIONS.map((definition) => {
        const cutoffIso = cutoffIsoForDays(definition.retentionDays(config), now);
        const matchedRows = this.countRows(definition.target, cutoffIso);
        const deleteResult = this.requireDeleteStatement(definition.target).run(cutoffIso);

        return {
          target: definition.target,
          cutoffIso,
          matchedRows,
          deletedRows: deleteResult.changes
        } satisfies RetentionTargetResult;
      })
    );

    return transaction();
  }

  checkpointWal(): void {
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }

  vacuum(): void {
    this.db.exec("VACUUM");
  }

  private requireCountStatement(target: string): Database.Statement<[string], { count: number }> {
    const statement = this.countStatements.get(target);
    if (statement === undefined) {
      throw new Error(`Retention count statement is unavailable for target ${target}`);
    }

    return statement;
  }

  private requireDeleteStatement(target: string): Database.Statement<[string], Database.RunResult> {
    const statement = this.deleteStatements.get(target);
    if (statement === undefined) {
      throw new Error(`Retention delete statement is unavailable for target ${target}`);
    }

    return statement;
  }

  private countRows(target: string, cutoffIso: string): number {
    const row = this.requireCountStatement(target).get(cutoffIso);
    return row?.count ?? 0;
  }
}

function cutoffIsoForDays(days: number, now: Date): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}
