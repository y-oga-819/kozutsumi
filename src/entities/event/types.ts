export type EventSource = "manual" | "google_calendar";

/**
 * DB スキーマ (supabase/migrations/..._initial_schema.sql の events) と 1:1 対応。
 * 時刻は ISO 8601 文字列 (timestamptz) として扱う。
 */
export type Event = {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  projectId: string | null;
  meetUrl: string | null;
  hasAttachments: boolean;
  description: string;
  source: EventSource;
  externalId: string | null;
  createdAt: string;
};
