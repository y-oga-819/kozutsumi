export type ActionType =
  | "task_started"
  | "task_paused"
  | "task_resumed"
  | "task_completed"
  | "task_reordered"
  | "task_deleted"
  | "task_title_changed"
  | "task_dependency_set"
  | "task_dependency_cleared"
  | "interruption_pushed"
  | "interruption_completed"
  | "stack_proposed"
  | "stack_proposal_accepted"
  | "calendar_synced";

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
};

export type ActionLogEntry<T extends ActionType = ActionType> = {
  action_type: T;
  metadata: ActionMetadataMap[T];
  created_at: string;
};
