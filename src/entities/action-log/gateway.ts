import type { ActionLogEntry } from "./types";

/**
 * 詳細パネル (P3-15 / ADR 0021) で参照する、AI 分解の終端 action_type 群。
 * `task_decomposed` / `task_decompose_failed` / `task_decompose_skipped` の最新 1 件で
 * raw response や reason を表示する。
 */
export type DecomposeActionType =
  | "task_decomposed"
  | "task_decompose_failed"
  | "task_decompose_skipped";

export type LatestDecomposeLog =
  | ActionLogEntry<"task_decomposed">
  | ActionLogEntry<"task_decompose_failed">
  | ActionLogEntry<"task_decompose_skipped">;

/**
 * action_logs を Phase 3 詳細パネル用途で読み出す Gateway。
 * 書き込みは fire-and-forget の `entities/action-log/logger` が担当するので、
 * ここでは「詳細パネルから 1 タスク分の最新試行を取る」という限定された read に絞る。
 */
export interface ActionLogGateway {
  /**
   * 指定タスクの AI 分解結果 (decomposed / failed / skipped) のうち最新 1 件を返す。
   * 履歴が無い (none / decomposing で固有のログ未生成) 場合は `null`。
   */
  getLatestDecomposeForTask(taskId: string): Promise<LatestDecomposeLog | null>;
}
