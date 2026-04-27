export type ActionType =
  | "task_started"
  | "task_paused"
  | "task_resumed"
  | "task_completed"
  | "task_reordered"
  | "task_deleted"
  | "task_title_changed"
  | "task_category_changed"
  | "task_dependency_set"
  | "task_dependency_cleared"
  | "interruption_pushed"
  | "interruption_completed"
  | "stack_proposed"
  | "stack_proposal_accepted"
  | "calendar_synced"
  | "task_decomposed"
  | "decomposition_modified";

/**
 * `decomposition_modified.kind` の値域。Phase 3 ではこの 1 ACTION_TYPE で
 * 「分解後に親子関係が動いた」事象を総称的に拾い、kind で区別する。
 *
 * - child_deleted : 分解結果の子が削除された (= 分解粒度が細かすぎた示唆)
 * - child_edited  : 分解結果の子のタイトル / 見積もりが書き換えられた
 * - child_resplit : 子に対してさらに AI 分解 / 手動分割が走った
 * - parent_merged : 親が削除されて子が孤児化した (= ADR 0018 の「親統合」)
 *
 * task_merged / task_split を独立 ACTION_TYPE に切り出す判断は P3-7 以降の
 * 操作 UI 設計時に再評価する (issue #88 の非スコープ)。
 */
export type DecompositionModifiedKind =
  | "child_deleted"
  | "child_edited"
  | "child_resplit"
  | "parent_merged";

export type PauseReason = "meeting" | "interruption" | "voluntary";

/** Google Calendar 同期がどの経路でトリガーされたか。Phase 4 の頻度分析に使う (#51)。 */
export type CalendarSyncTrigger = "manual" | "lazy";

export type ActionMetadataMap = {
  task_started: { task_id: string };
  task_paused: { task_id: string; pause_reason: PauseReason };
  task_resumed: { task_id: string };
  task_completed: {
    task_id: string;
    estimated_minutes?: number;
    actual_minutes?: number;
  };
  task_reordered: {
    task_id: string;
    from_position: number;
    to_position: number;
  };
  task_deleted: { task_id: string };
  task_title_changed: {
    task_id: string;
    old_title: string;
    new_title: string;
  };
  // Phase 3 #87 / ADR 0015: 人間が AI 初期ラベル / 既存値を override した時に記録。
  // Phase 4 のラベリング精度改善ループの暗黙フィードバック源。
  // from は AI ラベリング失敗 / 既存タスクで null になり得る。to は user 選択値で必ず存在する。
  task_category_changed: {
    task_id: string;
    from: string | null;
    to: string;
  };
  // Phase 2 #53: 依存イベントの設定 / 解除。Phase 4 で「依存設定が着手順に効いたか」の分析データに使う。
  task_dependency_set: {
    task_id: string;
    event_id: string;
    was: string | null;
  };
  task_dependency_cleared: {
    task_id: string;
    was: string;
  };
  interruption_pushed: { task_id: string };
  interruption_completed: { task_id: string };
  stack_proposed: Record<string, unknown>;
  stack_proposal_accepted: Record<string, unknown>;
  calendar_synced: {
    synced: number;
    deleted: number;
    trigger: CalendarSyncTrigger;
  };
  // Phase 3 #88: AI 分解成功時、子作成と同時に記録 (ADR 0017 / 0018)。
  // task_id は親 = 分解元タスク。child_ids は parent_task_id = task_id で
  // 紐づく子タスクの id 列で、Phase 4 の暗黙フィードバック分析の出発点になる。
  task_decomposed: {
    task_id: string;
    child_ids: string[];
  };
  // Phase 3 #88: 分解後に親子関係が動いた事象の総称 (ADR 0018 Notes)。
  // task_id は当該イベントの主体 (削除された子 / 編集された子 / 削除された親)、
  // parent_id は分解元の親 id。kind で具体イベントを区別する。
  decomposition_modified: {
    task_id: string;
    parent_id: string;
    kind: DecompositionModifiedKind;
  };
};

export type ActionLogEntry<T extends ActionType = ActionType> = {
  action_type: T;
  metadata: ActionMetadataMap[T];
  created_at: string;
};
