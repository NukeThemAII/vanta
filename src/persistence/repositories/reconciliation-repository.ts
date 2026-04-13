import type Database from "better-sqlite3";
import type { Address } from "viem";

import type {
  ReconciliationIssue,
  ReconciliationSummary,
  ReconciliationTrigger
} from "../../exchange/reconciliation.js";
import { asJsonValue } from "../../core/types.js";
import type { RuntimeTrustState } from "../../core/trust-state.js";
import { deserializeJson, serializeJson } from "./shared.js";

interface LatestReconciliationRunRow {
  readonly id: number;
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly trigger: string;
  readonly status: string;
  readonly operator_address: string | null;
  readonly trust_state_before: string;
  readonly trust_state_after: string | null;
  readonly issue_count: number;
  readonly summary_json: string | null;
  readonly error_message: string | null;
}

export interface ReconciliationRunRecord {
  readonly id: number;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly trigger: string;
  readonly status: string;
  readonly operatorAddress: string | null;
  readonly trustStateBefore: string;
  readonly trustStateAfter: string | null;
  readonly issueCount: number;
  readonly summary?: ReconciliationSummary;
  readonly errorMessage: string | null;
}

export class ReconciliationRepository {
  private readonly insertRunStatement: Database.Statement;
  private readonly completeRunStatement: Database.Statement;
  private readonly insertIssueStatement: Database.Statement;
  private readonly latestRunStatement: Database.Statement<[], LatestReconciliationRunRow>;

  constructor(private readonly db: Database.Database) {
    this.insertRunStatement = this.db.prepare(`
      INSERT INTO reconciliation_runs (
        boot_id,
        started_at,
        trigger,
        status,
        operator_address,
        trust_state_before
      ) VALUES (
        @bootId,
        @startedAt,
        @trigger,
        'running',
        @operatorAddress,
        @trustStateBefore
      )
    `);

    this.completeRunStatement = this.db.prepare(`
      UPDATE reconciliation_runs
      SET
        completed_at = @completedAt,
        status = @status,
        trust_state_after = @trustStateAfter,
        issue_count = @issueCount,
        summary_json = @summaryJson,
        error_message = @errorMessage
      WHERE id = @id
    `);

    this.insertIssueStatement = this.db.prepare(`
      INSERT INTO reconciliation_issues (
        run_id,
        severity,
        issue_type,
        entity_type,
        entity_key,
        message,
        local_json,
        exchange_json
      ) VALUES (
        @runId,
        @severity,
        @issueType,
        @entityType,
        @entityKey,
        @message,
        @localJson,
        @exchangeJson
      )
    `);

    this.latestRunStatement = this.db.prepare(`
      SELECT
        id,
        started_at,
        completed_at,
        trigger,
        status,
        operator_address,
        trust_state_before,
        trust_state_after,
        issue_count,
        summary_json,
        error_message
      FROM reconciliation_runs
      ORDER BY id DESC
      LIMIT 1
    `);
  }

  startRun(input: {
    readonly bootId?: string;
    readonly startedAt: string;
    readonly trigger: ReconciliationTrigger;
    readonly operatorAddress?: Address;
    readonly trustStateBefore: RuntimeTrustState;
  }): number {
    const result = this.insertRunStatement.run({
      bootId: input.bootId ?? null,
      startedAt: input.startedAt,
      trigger: input.trigger,
      operatorAddress: input.operatorAddress ?? null,
      trustStateBefore: input.trustStateBefore
    });

    return Number(result.lastInsertRowid);
  }

  addIssues(runId: number, issues: readonly ReconciliationIssue[]): void {
    const transaction = this.db.transaction(() => {
      for (const issue of issues) {
        this.insertIssueStatement.run({
          runId,
          severity: issue.severity,
          issueType: issue.issueType,
          entityType: issue.entityType,
          entityKey: issue.entityKey,
          message: issue.message,
          localJson: serializeJson(issue.localValue),
          exchangeJson: serializeJson(issue.exchangeValue)
        });
      }
    });

    transaction();
  }

  completeRun(input: {
    readonly id: number;
    readonly completedAt: string;
    readonly status: "succeeded" | "failed";
    readonly trustStateAfter?: RuntimeTrustState;
    readonly issueCount: number;
    readonly summary?: ReconciliationSummary;
    readonly errorMessage?: string;
  }): void {
    this.completeRunStatement.run({
      id: input.id,
      completedAt: input.completedAt,
      status: input.status,
      trustStateAfter: input.trustStateAfter ?? null,
      issueCount: input.issueCount,
      summaryJson: serializeJson(input.summary !== undefined ? asJsonValue(input.summary) : undefined),
      errorMessage: input.errorMessage ?? null
    });
  }

  getLatestRun(): ReconciliationRunRecord | undefined {
    const row = this.latestRunStatement.get();

    if (row === undefined) {
      return undefined;
    }

    return {
      id: row.id,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      trigger: row.trigger,
      status: row.status,
      operatorAddress: row.operator_address,
      trustStateBefore: row.trust_state_before,
      trustStateAfter: row.trust_state_after,
      issueCount: row.issue_count,
      ...(row.summary_json !== null
        ? {
            summary: deserializeJson<ReconciliationSummary>(row.summary_json)!
          }
        : {}),
      errorMessage: row.error_message
    };
  }
}
