import type { CorrectionFactor } from "./correction";
import type { DecomposeStatus, Task, TaskCategory, TaskSize } from "./types";

export type CreateTaskInput = {
  projectId: string;
  title: string;
  body?: string;
  estimatedMinutes?: number | null;
  stackOrder?: number | null;
  dependsOnEventId?: string | null;
  isInterruption?: boolean;
  parentTaskId?: string | null;
  decomposeStatus?: DecomposeStatus;
  taskCategory?: TaskCategory | null;
  taskSize?: TaskSize | null;
};

export type UpdateTaskInput = {
  projectId?: string;
  title?: string;
  body?: string;
  estimatedMinutes?: number | null;
  status?: Task["status"];
  stackOrder?: number | null;
  dependsOnEventId?: string | null;
  isInterruption?: boolean;
  decomposeStatus?: DecomposeStatus;
  taskCategory?: TaskCategory | null;
  taskSize?: TaskSize | null;
  completedAt?: string | null;
};

/**
 * 判断 5 (auth 隠蔽): `user_id` は interface に現れず、具象実装内で
 * `auth.getUser()` 相当を解決する。
 */
export interface TaskGateway {
  list(): Promise<Task[]>;
  create(input: CreateTaskInput): Promise<Task>;
  update(id: string, patch: UpdateTaskInput): Promise<Task>;
  reorder(entries: readonly { id: string; stackOrder: number | null }[]): Promise<void>;
  delete(id: string): Promise<void>;
  deleteAllForCurrentUser(): Promise<void>;
  /**
   * 見積もり補正倍率の取得 (P3-9 / #93、ADR 0024 / 0025)。
   * Supabase view `task_category_correction_factors` を読む薄ラッパー。
   * 行が無い場合 (= 完了タスクが無い / 全 category が外れ値で除外された) は空配列。
   * 最小サンプル数判定はここでは行わず、呼び出し側 (`correctEstimate`) で判定する。
   */
  listCorrectionFactors(): Promise<CorrectionFactor[]>;
}
