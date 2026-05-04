import type { CorrectionFactor } from "./correction";
import type { DecomposeStatus, Task, TaskCategory, TaskSize } from "./types";

export type CreateTaskInput = {
  /**
   * 所属プロジェクト (#170, ADR 0039)。null は「未指定 (Inbox 的)」。
   * DB 上 `tasks.project_id` は NULLABLE で、TaskForm の project 入力を任意化する方針に対応する。
   */
  projectId: string | null;
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
  /**
   * project の付け替え / 未設定化 (#170, ADR 0039)。null で「未指定」に戻せる。
   */
  projectId?: string | null;
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
 * Issue #171 / ADR 0039: project 編集の伝播モード。
 * - single                       : 単独タスク (親も子もない) で当該行のみ変更
 * - with_children                : 親タスクを変更し、同じ parent_task_id を持つ全子に伝播
 * - with_siblings_and_parent     : 子タスクを変更し、親と全兄弟に伝播
 */
export type ProjectCascadeMode = "single" | "with_children" | "with_siblings_and_parent";

/**
 * 判断 5 (auth 隠蔽): `user_id` は interface に現れず、具象実装内で
 * `auth.getUser()` 相当を解決する。
 */
export interface TaskGateway {
  list(): Promise<Task[]>;
  create(input: CreateTaskInput): Promise<Task>;
  update(id: string, patch: UpdateTaskInput): Promise<Task>;
  /**
   * Issue #171 / ADR 0039: project_id を atomic に変更する。
   * mode で伝播範囲を切り替える (with_children / with_siblings_and_parent は RPC 経由で 1 トランザクション)。
   * 戻り値の affectedTaskIds は変更が走った全 task id (target を含む) で、Phase 4 の
   * action_log payload に詰めて 1 操作 → N 行更新を再構成可能にする。
   */
  updateTaskProjectCascade(
    taskId: string,
    newProjectId: string | null,
    mode: ProjectCascadeMode,
  ): Promise<{ affectedTaskIds: string[] }>;
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
  /**
   * `tasks.depends_on_event_id` が指定 events.id のいずれかに一致する task の id 一覧。
   * ADR 0034 L5/L9: event 物理削除前に「依存を失う」task を action_log に記録するため
   * (`task_event_dependency_lost`)、events FK が SET NULL される前に呼ぶ。
   */
  findTasksDependingOnEvents(
    eventIds: string[],
  ): Promise<Array<{ taskId: string; eventId: string }>>;
}
