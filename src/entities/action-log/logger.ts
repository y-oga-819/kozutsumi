import type {
  ActionLogEntry,
  ActionMetadataMap,
  ActionType,
} from "./types";

/**
 * action-log logger
 *
 * Phase 3-4 で差別化の核となる行動ログのひな形。
 * 現時点ではメモリ配列 + console 出力のみ。Phase 1 本実装で Supabase 連携に差し替える。
 *
 * 参照: docs/specs/phase1.md Step 4 (action_logs)
 */

export const ACTION_TYPES = Object.freeze({
  TASK_STARTED: "task_started",
  TASK_PAUSED: "task_paused",
  TASK_RESUMED: "task_resumed",
  TASK_COMPLETED: "task_completed",
  TASK_REORDERED: "task_reordered",
  TASK_DELETED: "task_deleted",
  TASK_TITLE_CHANGED: "task_title_changed",
  INTERRUPTION_PUSHED: "interruption_pushed",
  INTERRUPTION_COMPLETED: "interruption_completed",
  STACK_PROPOSED: "stack_proposed",
  STACK_PROPOSAL_ACCEPTED: "stack_proposal_accepted",
}) satisfies Readonly<Record<string, ActionType>>;

const KNOWN_TYPES = new Set<ActionType>(Object.values(ACTION_TYPES));

let memoryLog: ActionLogEntry[] = [];

export function log<T extends ActionType>(
  actionType: T,
  metadata?: ActionMetadataMap[T],
): ActionLogEntry<T> {
  if (!KNOWN_TYPES.has(actionType)) {
    throw new Error(`unknown action_type: ${actionType}`);
  }
  const entry: ActionLogEntry<T> = {
    action_type: actionType,
    metadata: metadata ?? ({} as ActionMetadataMap[T]),
    created_at: new Date().toISOString(),
  };
  memoryLog.push(entry);
  console.log("[action-log]", actionType, entry.metadata);
  return entry;
}

export function getLog(): ActionLogEntry[] {
  return [...memoryLog];
}

export function clearLog(): void {
  memoryLog = [];
}
