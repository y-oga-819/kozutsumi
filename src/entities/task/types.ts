import type { ProjectKey } from "../project/types";

export type TaskStatus = "idle" | "active" | "paused" | "done";

/**
 * DB スキーマ (supabase/migrations/..._initial_schema.sql の tasks) と 1:1 対応。
 * PoC では projectId に ProjectKey(slug) を入れ、本番では UUID を入れる。
 */
export type Task = {
  id: string;
  projectId: ProjectKey;
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
  projectId: ProjectKey;
  title: string;
  date: string;
};
