import type { RetentionConfig } from "../core/types.js";

export const DEFAULT_RETENTION_CONFIG: RetentionConfig = {
  marketEventsDays: 7,
  runtimeStateDays: 30,
  executionAuditDays: 90
};
