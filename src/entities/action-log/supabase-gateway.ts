import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/shared/types/database";

import type {
  ActionLogGateway,
  DecomposeActionType,
  LatestDecomposeLog,
} from "./gateway";
import type { ActionMetadataMap } from "./types";

const DECOMPOSE_ACTION_TYPES: readonly DecomposeActionType[] = [
  "task_decomposed",
  "task_decompose_failed",
  "task_decompose_skipped",
];

export class SupabaseActionLogGateway implements ActionLogGateway {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async getLatestDecomposeForTask(taskId: string): Promise<LatestDecomposeLog | null> {
    const { data, error } = await this.supabase
      .from("action_logs")
      .select("action_type, metadata, created_at")
      .eq("task_id", taskId)
      .in("action_type", DECOMPOSE_ACTION_TYPES as unknown as string[])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const actionType = data.action_type as DecomposeActionType;
    return {
      action_type: actionType,
      metadata: data.metadata as ActionMetadataMap[DecomposeActionType],
      created_at: data.created_at,
    } as LatestDecomposeLog;
  }
}
