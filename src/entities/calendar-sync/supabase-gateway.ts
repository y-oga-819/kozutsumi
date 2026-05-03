import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, TablesInsert } from "@/shared/types/database";

import type { CalendarSyncState, CalendarSyncStateGateway, CalendarSyncStateKey } from "./gateway";

type Sb = SupabaseClient<Database>;

export class SupabaseCalendarSyncStateGateway implements CalendarSyncStateGateway {
  constructor(private readonly supabase: Sb) {}

  async get(key: CalendarSyncStateKey): Promise<CalendarSyncState | null> {
    const {
      data: { user },
    } = await this.supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await this.supabase
      .from("user_calendar_sync_state")
      .select("user_id, last_synced_at, sync_token, updated_at")
      .eq("user_id", user.id)
      .eq("source", key.source)
      .eq("external_account_id", key.externalAccountId)
      .eq("external_calendar_id", key.externalCalendarId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      lastSyncedAt: data.last_synced_at,
      syncToken: data.sync_token,
    };
  }

  async saveSyncState(
    key: CalendarSyncStateKey,
    input: { lastSyncedAt: string; syncToken: string | null },
  ): Promise<void> {
    const {
      data: { user },
    } = await this.supabase.auth.getUser();
    if (!user) throw new Error("not authenticated");

    const payload: TablesInsert<"user_calendar_sync_state"> = {
      user_id: user.id,
      source: key.source,
      external_account_id: key.externalAccountId,
      external_calendar_id: key.externalCalendarId,
      last_synced_at: input.lastSyncedAt,
      sync_token: input.syncToken,
    };
    // ADR 0031/0033: 複合 PK `(user_id, source, external_account_id, external_calendar_id)`
    const { error } = await this.supabase.from("user_calendar_sync_state").upsert(payload, {
      onConflict: "user_id,source,external_account_id,external_calendar_id",
    });
    if (error) throw error;
  }
}
