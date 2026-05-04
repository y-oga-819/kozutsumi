import type { TaskCategoryValue, TaskSizeValue } from "@/shared/types/database";

export type TaskStatus = "idle" | "active" | "paused" | "done";

/**
 * AI 分解 (ADR 0017 / 0018 / 0021) における親タスクの状態。
 * - none        : 分解未試行 (Phase 1〜2 由来の既存タスク含む)
 * - decomposing : AI 分解 fire-and-forget 中
 * - decomposed  : 子レコードが parent_task_id 経由で存在
 * - skipped     : AI が分解不要と判断 / AI_ENABLED=false 等
 * - failed      : AI 分解失敗 (ADR 0021)。終端 status、再実行で decomposing に戻る
 *
 * Stack View (ADR 0016 Variant E) は decomposed の親を出さず、子だけを並べる。
 */
export type DecomposeStatus = "none" | "decomposing" | "decomposed" | "skipped" | "failed";

/**
 * タスク種別 (ADR 0015 / #87)。
 * AI が初期ラベル、人間は override で暗黙的フィードバックを残す。
 * AI ラベリング失敗時 / 既存タスクは null。
 */
export type TaskCategory = TaskCategoryValue;

/**
 * 主観タスクサイズ (ADR 0036 / 0038, #169)。
 * ユーザーが登録時に「これくらい」と感じた粗いサイズ感。AI 推定の estimatedMinutes
 * とは別軸で蓄積する (Phase 4 行動分析の独立シグナル)。
 * 値域: '15m' / '30m' / '1h' / '2h' / '4h' / '1d' / 'large'。
 * 既存タスク・未設定は null (後方互換: estimated_minutes ベースに倒れる)。
 */
export type TaskSize = TaskSizeValue;

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
  decomposeStatus: DecomposeStatus;
  taskCategory: TaskCategory | null;
  taskSize: TaskSize | null;
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
