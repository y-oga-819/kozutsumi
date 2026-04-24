import { createClient } from "@/shared/supabase/client";
import type { Json } from "@/shared/types/database";

import type {
  ActionLogEntry,
  ActionMetadataMap,
  ActionType,
} from "./types";

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
  INTERRUPTION_PUSHED: "interruption_pushed",
  INTERRUPTION_COMPLETED: "interruption_completed",
  STACK_PROPOSED: "stack_proposed",
  STACK_PROPOSAL_ACCEPTED: "stack_proposal_accepted",
  CALENDAR_SYNCED: "calendar_synced",
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

function extractTaskId(metadata: Record<string, unknown>): string | null {
  const v = metadata["task_id"];
  return typeof v === "string" ? v : null;
}

async function persist<T extends ActionType>(
  entry: ActionLogEntry<T>,
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
    task_id: extractTaskId(
      entry.metadata as unknown as Record<string, unknown>,
    ),
    metadata: entry.metadata as unknown as Json,
  });
  if (error) {
    console.error("[action-log] insert failed", error);
  }
}

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

  // fire-and-forget: ここで await しないのが肝
  void persist(entry).catch((err) => {
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
