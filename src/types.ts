export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  ANTHROPIC_API_KEY: string;
  ALLOWED_TELEGRAM_USER_ID: string;
  WEBHOOK_SECRET: string;
  CLAUDE_MODEL: string;
  TIMEZONE: string;
  QUIET_START_HOUR: string;
  QUIET_END_HOUR: string;
}

export type Recurrence = "daily" | "weekly" | "monthly";

export interface ExtractedTask {
  title: string;
  due_date: string | null;
  recurrence: Recurrence | null;
}

export interface ExtractedDecision {
  summary: string;
  context: string;
}

export interface ExtractionResult {
  decisions: ExtractedDecision[];
  tasks: ExtractedTask[];
  reply_bn: string;
}

export interface TaskRow {
  id: number;
  title: string;
  due_date: string | null;
  status: string;
  created_at: string;
  completed_at?: string | null;
  reminded_at?: string | null;
  recurrence?: Recurrence | null;
}

export interface DecisionRow {
  id: number;
  summary: string;
  context: string | null;
  created_at: string;
}
