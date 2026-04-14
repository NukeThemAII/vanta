import type { Logger } from "pino";

import type { RetentionConfig } from "../core/types.js";
import type { RetentionRepository, RetentionTargetResult } from "../persistence/repositories/retention-repository.js";

export interface RetentionRunSummary {
  readonly checkedAt: string;
  readonly mode: "preview" | "apply";
  readonly vacuumed: boolean;
  readonly policies: RetentionConfig;
  readonly targets: readonly RetentionTargetResult[];
  readonly totalMatchedRows: number;
  readonly totalDeletedRows: number;
}

export class RetentionService {
  constructor(
    private readonly retentionConfig: RetentionConfig,
    private readonly repository: RetentionRepository,
    private readonly logger: Logger
  ) {}

  preview(now = new Date()): RetentionRunSummary {
    const targets = this.repository.preview(this.retentionConfig, now);
    const summary = this.buildSummary("preview", false, targets, now);

    this.logger.info(summary, "Retention preview completed");
    return summary;
  }

  apply(options?: {
    readonly now?: Date;
    readonly vacuum?: boolean;
  }): RetentionRunSummary {
    const now = options?.now ?? new Date();
    const targets = this.repository.apply(this.retentionConfig, now);

    if (options?.vacuum === true) {
      this.repository.checkpointWal();
      this.repository.vacuum();
    }

    const summary = this.buildSummary("apply", options?.vacuum === true, targets, now);
    this.logger.info(summary, "Retention cleanup completed");
    return summary;
  }

  private buildSummary(
    mode: "preview" | "apply",
    vacuumed: boolean,
    targets: readonly RetentionTargetResult[],
    now: Date
  ): RetentionRunSummary {
    return {
      checkedAt: now.toISOString(),
      mode,
      vacuumed,
      policies: this.retentionConfig,
      targets,
      totalMatchedRows: targets.reduce((sum, target) => sum + target.matchedRows, 0),
      totalDeletedRows: targets.reduce((sum, target) => sum + target.deletedRows, 0)
    };
  }
}
