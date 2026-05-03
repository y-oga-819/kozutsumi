import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/shared/types/database";

import type { ActionMetadataMap, ActionType, ActorType } from "./types";

/**
 * Server 側 (Route Handler 内) からの action_logs 書き込み helper。
 *
 * client 側 logger (`./logger.ts`) は `typeof window === "undefined"` を返却条件にしており
 * server からの呼び出しでは no-op になる (browser session 前提の supabase client を使う)。
 * Route Handler では server supabase client (`@/shared/supabase/server`) と認証済み userId を
 * 持っているので、ここでは props で受け取って直接 INSERT する。
 *
 * 設計原則は client 側と同じ:
 * - INSERT 失敗は `console.error` に留め、呼び出し元のロジックは止めない (ADR 0001)
 * - `task_deleted` / `decomposition_modified` は FK 違反を避けるため column の task_id を
 *   null にする。metadata.task_id は一次の真実として残す
 * - `actor_type` (ADR 0035) は明示渡しに変更。default 'user' は手動連打安全のため残すが、
 *   system actor の type を発火する箇所では必ず 'system' を渡す
 */

function extractTaskId(actionType: ActionType, metadata: Record<string, unknown>): string | null {
  if (actionType === "task_deleted" || actionType === "decomposition_modified") {
    return null;
  }
  const v = metadata["task_id"];
  return typeof v === "string" ? v : null;
}

export async function logServerSide<T extends ActionType>(
  supabase: SupabaseClient<Database>,
  userId: string,
  actionType: T,
  metadata: ActionMetadataMap[T],
  actorType: ActorType = "user",
): Promise<void> {
  const { error } = await supabase.from("action_logs").insert({
    user_id: userId,
    action_type: actionType,
    task_id: extractTaskId(actionType, metadata as unknown as Record<string, unknown>),
    metadata: metadata as unknown as Json,
    actor_type: actorType,
  });
  if (error) {
    console.error("[action-log/server] insert failed", error);
  }
}
