export type TaskStatus = "idle" | "active" | "paused" | "done";

/**
 * DB スキーマ (supabase/migrations/..._initial_schema.sql の tasks) と 1:1 対応。
 * projectId は projects.id を参照する UUID (初回 seed では slug 由来の UUID)。
 * DB 上は project_id が nullable だが、UI では常に割り当てさせる運用なので string を前提とする。
 */
export type Task = {
  id: string;
  projectId: string;
  title: string;
  body: string;
  estimatedMinutes: number | null;
  status: TaskStatus;
  stackOrder: number | null;
  dependsOnEventId: string | null;
  isInterruption: boolean;
  parentTaskId: string | null;
  createdAt: string;
  completedAt: string | null;
};

/**
 * Tree View 用の完了履歴レコード。
 * 本番では `tasks where status='done'` から生成されるが、PoC では mock として持つ。
 */
export type HistoryEntry = {
  id: string;
  projectId: string;
  title: string;
  date: string;
};
