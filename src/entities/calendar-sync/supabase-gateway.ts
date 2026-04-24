import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, TablesInsert } from "@/shared/types/database";

import type {
  CalendarSyncState,
  CalendarSyncStateGateway,
} from "./gateway";

type Sb = SupabaseClient<Database>;

export class SupabaseCalendarSyncStateGateway
  implements CalendarSyncStateGateway
{
  constructor(private readonly supabase: Sb) {}

  async get(): Promise<CalendarSyncState | null> {
    const {
      data: { user },
    } = await this.supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await this.supabase
      .from("user_calendar_sync_state")
      .select("user_id, last_synced_at, sync_token, updated_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      lastSyncedAt: data.last_synced_at,
      syncToken: data.sync_token,
    };
  }

  async upsertLastSyncedAt(lastSyncedAt: string): Promise<void> {
    const {
      data: { user },
    } = await this.supabase.auth.getUser();
    if (!user) throw new Error("not authenticated");

    // sync_token は payload から外すことで既存値を保持する (P2-6 で使う予約枠)。
    const payload: TablesInsert<"user_calendar_sync_state"> = {
      user_id: user.id,
      last_synced_at: lastSyncedAt,
    };
    const { error } = await this.supabase
      .from("user_calendar_sync_state")
      .upsert(payload, { onConflict: "user_id" });
    if (error) throw error;
  }
}
