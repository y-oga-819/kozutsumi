import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Tables, TablesInsert, TablesUpdate } from "@/shared/types/database";

import type {
  CreateEventInput,
  EventGateway,
  UpdateEventInput,
  UpsertGoogleCalendarEventInput,
} from "./gateway";
import { EVENT_SOURCE, type Event } from "./types";

type Sb = SupabaseClient<Database>;

/** manual event の external_calendar_id 固定値 (ADR 0033 backfill 規約と一致)。 */
const MANUAL_EXTERNAL_CALENDAR_ID = "manual";

function fromRow(row: Tables<"events">): Event {
  return {
    id: row.id,
    title: row.title,
    startTime: row.start_time,
    endTime: row.end_time,
    projectId: row.project_id,
    meetUrl: row.meet_url,
    hasAttachments: row.has_attachments,
    description: row.description,
    source: row.source,
    externalId: row.external_id,
    externalCalendarId: row.external_calendar_id,
    visibilityOverride: row.visibility_override,
    createdAt: row.created_at,
  };
}

async function getUserId(supabase: Sb): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("not authenticated");
  return user.id;
}

export class SupabaseEventGateway implements EventGateway {
  constructor(private readonly supabase: Sb) {}

  async list(): Promise<Event[]> {
    const { data, error } = await this.supabase
      .from("events")
      .select("*")
      .order("start_time", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(fromRow);
  }

  async create(input: CreateEventInput): Promise<Event> {
    const user_id = await getUserId(this.supabase);
    // ADR 0033: source-agnostic な triple uniqueness。manual event は固定値で埋める。
    const payload: TablesInsert<"events"> = {
      user_id,
      title: input.title,
      start_time: input.startTime,
      end_time: input.endTime,
      project_id: input.projectId ?? null,
      meet_url: input.meetUrl ?? null,
      has_attachments: input.hasAttachments ?? false,
      description: input.description ?? "",
      source: input.source ?? EVENT_SOURCE.MANUAL,
      external_id: input.externalId ?? null,
      external_calendar_id: MANUAL_EXTERNAL_CALENDAR_ID,
    };
    const { data, error } = await this.supabase.from("events").insert(payload).select("*").single();
    if (error) throw error;
    return fromRow(data);
  }

  async update(id: string, patch: UpdateEventInput): Promise<Event> {
    // ADR 0010: source='google_calendar' の行は project_id 以外を kozutsumi 側で更新不可。
    // UI を bypass されてもガードできるよう、ここでも source を確認する。
    const touchesGoogleOwned =
      patch.title !== undefined ||
      patch.startTime !== undefined ||
      patch.endTime !== undefined ||
      patch.meetUrl !== undefined ||
      patch.hasAttachments !== undefined ||
      patch.description !== undefined;
    if (touchesGoogleOwned) {
      const source = await this.fetchSource(id);
      if (source === EVENT_SOURCE.GOOGLE_CALENDAR) {
        throw new Error("google_calendar event is read-only (only project_id can be updated)");
      }
    }
    const update: TablesUpdate<"events"> = {};
    if (patch.title !== undefined) update.title = patch.title;
    if (patch.startTime !== undefined) update.start_time = patch.startTime;
    if (patch.endTime !== undefined) update.end_time = patch.endTime;
    if (patch.projectId !== undefined) update.project_id = patch.projectId;
    if (patch.meetUrl !== undefined) update.meet_url = patch.meetUrl;
    if (patch.hasAttachments !== undefined) update.has_attachments = patch.hasAttachments;
    if (patch.description !== undefined) update.description = patch.description;
    const { data, error } = await this.supabase
      .from("events")
      .update(update)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return fromRow(data);
  }

  async delete(id: string): Promise<void> {
    // ADR 0010: source='google_calendar' の行は UI からは削除不可
    // (Google 側で削除すれば次回同期で消える)。
    const source = await this.fetchSource(id);
    if (source === EVENT_SOURCE.GOOGLE_CALENDAR) {
      throw new Error(
        "google_calendar event cannot be deleted from kozutsumi (delete it on Google Calendar)",
      );
    }
    const { error } = await this.supabase.from("events").delete().eq("id", id);
    if (error) throw error;
  }

  /**
   * 単一行の source だけを取得する。RLS 違反 / 行未発見時は null を返す。
   */
  private async fetchSource(id: string): Promise<Event["source"] | null> {
    const { data, error } = await this.supabase
      .from("events")
      .select("source")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data?.source ?? null;
  }

  async deleteAllForCurrentUser(): Promise<void> {
    const uid = await getUserId(this.supabase);
    const { error } = await this.supabase.from("events").delete().eq("user_id", uid);
    if (error) throw error;
  }

  async upsertFromGoogleCalendar(inputs: UpsertGoogleCalendarEventInput[]): Promise<number> {
    if (inputs.length === 0) return 0;
    const user_id = await getUserId(this.supabase);
    // project_id / visibility_override を payload に含めないことで、ON CONFLICT DO UPDATE SET ... から
    // 除外され、既存行の値が保持される (kozutsumi 側の拡張、ADR 0010 / ADR 0034 L4)
    const payloads: TablesInsert<"events">[] = inputs.map((input) => ({
      user_id,
      title: input.title,
      start_time: input.startTime,
      end_time: input.endTime,
      meet_url: input.meetUrl,
      has_attachments: input.hasAttachments,
      description: input.description,
      source: EVENT_SOURCE.GOOGLE_CALENDAR,
      external_id: input.externalId,
      external_calendar_id: input.externalCalendarId,
    }));
    // ADR 0033: triple uniqueness `(source, external_calendar_id, external_id)`
    const { error } = await this.supabase
      .from("events")
      .upsert(payloads, { onConflict: "source,external_calendar_id,external_id" });
    if (error) throw error;
    // upsert は全 input に対して insert または update を実行するため、affected = inputs.length
    return inputs.length;
  }

  async deleteByGoogleExternalIds(
    externalCalendarId: string,
    externalIds: string[],
  ): Promise<number> {
    if (externalIds.length === 0) return 0;
    const uid = await getUserId(this.supabase);
    // count のみ欲しいので head: true で row を返させない
    const { error, count } = await this.supabase
      .from("events")
      .delete({ count: "exact" })
      .eq("user_id", uid)
      .eq("source", EVENT_SOURCE.GOOGLE_CALENDAR)
      .eq("external_calendar_id", externalCalendarId)
      .in("external_id", externalIds);
    if (error) throw error;
    return count ?? 0;
  }
}
