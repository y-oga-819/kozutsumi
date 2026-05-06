import { createClient } from "@/shared/supabase/client";
import type { Json } from "@/shared/types/database";

import type { ActionLogEntry, ActionMetadataMap, ActionType, ActorType } from "./types";

/**
 * action-log logger
 *
 * kozutsumi の差別化の核である行動ログを Supabase に永続化する。
 * docs/adr/0001-action-logs-from-phase1.md / docs/design/vision.md 参照。
 *
 * 設計原則:
 * - fire-and-forget: log() は呼び出し元を絶対に await させない
 *   (DnD や完了操作のレイテンシは UX 直結)
 * - ログ欠損 < UI 停止: insert 失敗は console.error に留める
 * - getLog()/clearLog() は開発・テスト時のデバッグ用
 */

export const ACTION_TYPES = Object.freeze({
  TASK_STARTED: "task_started",
  TASK_PAUSED: "task_paused",
  TASK_RESUMED: "task_resumed",
  TASK_COMPLETED: "task_completed",
  TASK_REORDERED: "task_reordered",
  TASK_DELETED: "task_deleted",
  TASK_TITLE_CHANGED: "task_title_changed",
  TASK_CATEGORY_CHANGED: "task_category_changed",
  TASK_PROJECT_CHANGED: "task_project_changed",
  TASK_DEPENDENCY_SET: "task_dependency_set",
  TASK_DEPENDENCY_CLEARED: "task_dependency_cleared",
  INTERRUPTION_PUSHED: "interruption_pushed",
  INTERRUPTION_COMPLETED: "interruption_completed",
  STACK_PROPOSED: "stack_proposed",
  STACK_PROPOSAL_ACCEPTED: "stack_proposal_accepted",
  CALENDAR_SYNCED: "calendar_synced",
  TASK_DECOMPOSED: "task_decomposed",
  TASK_DECOMPOSE_FAILED: "task_decompose_failed",
  TASK_DECOMPOSE_SKIPPED: "task_decompose_skipped",
  TASK_CHILD_RESPLIT: "task_child_resplit",
  DECOMPOSITION_MODIFIED: "decomposition_modified",
  // ADR 0034 / 0035: calendar / event 関連 type。
  // 値は ADR 0035 §4 で確定済みだが、発火実装は #144 / #145 / #146 のスコープ。
  CALENDAR_SUBSCRIBED: "calendar_subscribed",
  CALENDAR_UNSUBSCRIBED: "calendar_unsubscribed",
  CALENDAR_AUTO_PROMOTE_CHANGED: "calendar_auto_promote_changed",
  EVENT_PROMOTED: "event_promoted",
  EVENT_DEMOTED: "event_demoted",
  EVENT_OVERRIDE_CLEARED: "event_override_cleared",
  EVENT_VISIBILITY_RULE_ADDED: "event_visibility_rule_added",
  EVENT_VISIBILITY_RULE_REMOVED: "event_visibility_rule_removed",
  EXTERNAL_ACCOUNT_ADDED: "external_account_added",
  EXTERNAL_ACCOUNT_REMOVED: "external_account_removed",
  EVENT_VISIBILITY_FROZEN_BY_SUBSCRIPTION_TOGGLE: "event_visibility_frozen_by_subscription_toggle",
  EVENT_DELETED_BY_SOURCE: "event_deleted_by_source",
  TASK_EVENT_DEPENDENCY_LOST: "task_event_dependency_lost",
  EXTERNAL_ACCOUNT_REAUTH_REQUIRED: "external_account_reauth_required",
}) satisfies Readonly<Record<string, ActionType>>;

const KNOWN_TYPES = new Set<ActionType>(Object.values(ACTION_TYPES));

let memoryLog: ActionLogEntry[] = [];

type SupabaseClientLike = ReturnType<typeof createClient>;
let cachedClient: SupabaseClientLike | null = null;

function getClient(): SupabaseClientLike | null {
  if (typeof window === "undefined") {
    return null;
  }
  if (!cachedClient) {
    try {
      cachedClient = createClient();
    } catch (err) {
      console.error("[action-log] failed to init supabase client", err);
      return null;
    }
  }
  return cachedClient;
}

/**
 * action_logs.task_id 列に書く値を決める。
 *
 * task_deleted のとき: 削除済みの task を参照する column 値を書くと
 *   action_logs.task_id → tasks.id の FK 制約に違反して insert 自体が
 *   失敗する (ON DELETE SET NULL は既存行向けで、INSERT 時には適用されない)。
 *   metadata.task_id を一次の真実として残しつつ column は null で書く。
 *   Phase 3 学習では metadata 経由で相関を取る前提 (vision.md / ADR 0001)。
 *
 * それ以外: metadata.task_id があればそれを column 値にする。
 */
function extractTaskId(actionType: ActionType, metadata: Record<string, unknown>): string | null {
  // task_deleted と同じく、対象 task が削除されている可能性があるものは
  // FK 違反を避けるため column 値を null にし、metadata.task_id を一次の真実とする。
  // decomposition_modified.kind が child_deleted / parent_merged の時は
  // task_id が削除済みなので、kind に依らず一律 null にしておく方が安全。
  if (actionType === "task_deleted" || actionType === "decomposition_modified") {
    return null;
  }
  const v = metadata["task_id"];
  return typeof v === "string" ? v : null;
}

async function persist<T extends ActionType>(
  entry: ActionLogEntry<T>,
  actorType: ActorType,
): Promise<void> {
  const supabase = getClient();
  if (!supabase) return;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // 未ログイン時は RLS に引っかかるので送らない
    return;
  }

  const { error } = await supabase.from("action_logs").insert({
    user_id: user.id,
    action_type: entry.action_type,
    task_id: extractTaskId(entry.action_type, entry.metadata as unknown as Record<string, unknown>),
    metadata: entry.metadata as unknown as Json,
    actor_type: actorType,
  });
  if (error) {
    console.error("[action-log] insert failed", error);
  }
}

export function log<T extends ActionType>(
  actionType: T,
  metadata?: ActionMetadataMap[T],
  actorType: ActorType = "user",
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

  // fire-and-forget: ここで await しないのが肝 (ADR 0035: actor_type は明示渡し、default 'user')
  void persist(entry, actorType).catch((err) => {
    console.error("[action-log] persist error", err);
  });

  return entry;
}

export function getLog(): ActionLogEntry[] {
  return [...memoryLog];
}

export function clearLog(): void {
  memoryLog = [];
}

/** test 専用: cached client をリセット */
export function __resetLoggerClientForTest(): void {
  cachedClient = null;
}
