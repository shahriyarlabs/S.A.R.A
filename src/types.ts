export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  GEMINI_API_KEY: string;
  ALLOWED_TELEGRAM_USER_ID: string;
  WEBHOOK_SECRET: string;
  GEMINI_MODEL: string;
  TIMEZONE: string;
  QUIET_START_HOUR: string;
  QUIET_END_HOUR: string;
}

export interface ExtractedTask {
  title: string;
  due_date: string | null;
}

export interface ExtractedDecision {
  summary: string;
  context: string;
}

export interface GeminiExtractionResult {
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
}

export interface DecisionRow {
  id: number;
  summary: string;
  context: string | null;
  created_at: string;
}
