import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Tables, TablesInsert, TablesUpdate } from "@/shared/types/database";

import type {
  CreateEventInput,
  DeletedEventSnapshot,
  EventGateway,
  UpdateEventInput,
  UpsertGoogleCalendarEventInput,
} from "./gateway";
import { EVENT_SOURCE, type Event, type EventVisibilityOverride } from "./types";

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
    recurringEventId: row.recurring_event_id,
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

    // ADR 0056 §2: 新規 instance 取り込み時に該当 rule があれば visibility_override を
    // rule.override_value で初期化する。既存 instance は visibility_override を触らない
    // (ADR 0034 L4 / ADR 0056 §5: 単発 override 保護)。
    //
    // 「新規 / 既存」を split して 2 段階の upsert を行う:
    //   - 新規:   visibility_override を payload に含めて INSERT (rule 由来 or 'none')
    //   - 既存:   visibility_override を payload に含めず ON CONFLICT DO UPDATE で保持
    //
    // 1 つの upsert にまとめると、既存行に対して payload の visibility_override で
    // 上書きしてしまう (ON CONFLICT DO UPDATE SET の挙動)。

    const externalIds = inputs.map((i) => i.externalId);
    const { data: existingRows, error: selErr } = await this.supabase
      .from("events")
      .select("external_calendar_id, external_id")
      .eq("user_id", user_id)
      .eq("source", EVENT_SOURCE.GOOGLE_CALENDAR)
      .in("external_id", externalIds);
    if (selErr) throw selErr;
    const existingKeys = new Set(
      (existingRows ?? []).map((r) => `${r.external_calendar_id}::${r.external_id}`),
    );
    const isNew = (input: UpsertGoogleCalendarEventInput) =>
      !existingKeys.has(`${input.externalCalendarId}::${input.externalId}`);

    const newInputs = inputs.filter(isNew);
    const existingInputs = inputs.filter((i) => !isNew(i));

    const initialOverrides = await this.resolveInitialOverridesForNewInstances(user_id, newInputs);

    const basePayload = (input: UpsertGoogleCalendarEventInput): TablesInsert<"events"> => ({
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
      recurring_event_id: input.recurringEventId,
    });

    if (newInputs.length > 0) {
      const newPayloads: TablesInsert<"events">[] = newInputs.map((input) => ({
        ...basePayload(input),
        visibility_override:
          initialOverrides.get(`${input.externalCalendarId}::${input.externalId}`) ?? "none",
      }));
      // ignoreDuplicates: 並走 sync で他経路から先行 INSERT された場合に既存値を上書きしない安全弁。
      const { error } = await this.supabase.from("events").upsert(newPayloads, {
        onConflict: "source,external_calendar_id,external_id",
        ignoreDuplicates: true,
      });
      if (error) throw error;
    }

    if (existingInputs.length > 0) {
      const existingPayloads: TablesInsert<"events">[] = existingInputs.map(basePayload);
      // visibility_override は payload に含めないので ON CONFLICT DO UPDATE SET から除外され、
      // 既存値が保持される (ADR 0034 L4)。
      const { error } = await this.supabase
        .from("events")
        .upsert(existingPayloads, { onConflict: "source,external_calendar_id,external_id" });
      if (error) throw error;
    }

    return inputs.length;
  }

  /**
   * ADR 0056 §2: 新規 instance に対し、該当する rule があれば visibility_override の初期値を
   * rule.override_value に解決する。recurring_event_id が無い (= 単発) instance は対象外。
   *
   * 戻り値の Map key は `${external_calendar_id}::${external_id}`。値が無い instance は
   * default の `'none'` で insert する (ADR 0032)。
   */
  private async resolveInitialOverridesForNewInstances(
    userId: string,
    newInputs: UpsertGoogleCalendarEventInput[],
  ): Promise<Map<string, EventVisibilityOverride>> {
    const result = new Map<string, EventVisibilityOverride>();
    if (newInputs.length === 0) return result;

    // (external_calendar_id, recurring_event_id) のユニーク集合を作って 1 query にまとめる。
    const calendarToRecurringIds = new Map<string, Set<string>>();
    for (const input of newInputs) {
      if (!input.recurringEventId) continue;
      let set = calendarToRecurringIds.get(input.externalCalendarId);
      if (!set) {
        set = new Set();
        calendarToRecurringIds.set(input.externalCalendarId, set);
      }
      set.add(input.recurringEventId);
    }
    if (calendarToRecurringIds.size === 0) return result;

    // calendar 単位で rules を batch fetch (PostgREST の `.in()` を使う)。
    type RuleRow = {
      external_calendar_id: string;
      recurring_event_id: string;
      scope: "this_and_following" | "all";
      override_value: "shown" | "hidden";
      from_start_time: string | null;
    };
    const rulesByKey = new Map<string, RuleRow>();
    for (const [calendarId, recurringIds] of calendarToRecurringIds) {
      const { data, error } = await this.supabase
        .from("event_visibility_override_rules")
        .select("external_calendar_id, recurring_event_id, scope, override_value, from_start_time")
        .eq("user_id", userId)
        .eq("source", EVENT_SOURCE.GOOGLE_CALENDAR)
        .eq("external_calendar_id", calendarId)
        .in("recurring_event_id", Array.from(recurringIds));
      if (error) throw error;
      for (const r of (data as RuleRow[] | null) ?? []) {
        rulesByKey.set(`${r.external_calendar_id}::${r.recurring_event_id}`, r);
      }
    }
    if (rulesByKey.size === 0) return result;

    for (const input of newInputs) {
      if (!input.recurringEventId) continue;
      const rule = rulesByKey.get(`${input.externalCalendarId}::${input.recurringEventId}`);
      if (!rule) continue;
      // scope='all' は全 instance に適用、'this_and_following' は from_start_time 以降のみ適用
      // (ADR 0056 §4: 操作対象 instance の start_time 起点)。
      const applies =
        rule.scope === "all" ||
        (rule.scope === "this_and_following" &&
          rule.from_start_time !== null &&
          Date.parse(input.startTime) >= Date.parse(rule.from_start_time));
      if (applies) {
        result.set(`${input.externalCalendarId}::${input.externalId}`, rule.override_value);
      }
    }
    return result;
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

  async findGoogleEventSnapshots(
    externalCalendarId: string,
    externalIds: string[],
  ): Promise<DeletedEventSnapshot[]> {
    if (externalIds.length === 0) return [];
    const uid = await getUserId(this.supabase);
    const { data, error } = await this.supabase
      .from("events")
      .select("id, external_id, title, start_time, end_time, visibility_override")
      .eq("user_id", uid)
      .eq("source", EVENT_SOURCE.GOOGLE_CALENDAR)
      .eq("external_calendar_id", externalCalendarId)
      .in("external_id", externalIds);
    if (error) throw error;
    return (data ?? []).map(toDeletedSnapshot);
  }

  async findAllGoogleEventsByCalendar(externalCalendarId: string): Promise<DeletedEventSnapshot[]> {
    const uid = await getUserId(this.supabase);
    const { data, error } = await this.supabase
      .from("events")
      .select("id, external_id, title, start_time, end_time, visibility_override")
      .eq("user_id", uid)
      .eq("source", EVENT_SOURCE.GOOGLE_CALENDAR)
      .eq("external_calendar_id", externalCalendarId);
    if (error) throw error;
    return (data ?? []).map(toDeletedSnapshot);
  }

  async deleteAllGoogleEventsByCalendar(externalCalendarId: string): Promise<number> {
    const uid = await getUserId(this.supabase);
    const { error, count } = await this.supabase
      .from("events")
      .delete({ count: "exact" })
      .eq("user_id", uid)
      .eq("source", EVENT_SOURCE.GOOGLE_CALENDAR)
      .eq("external_calendar_id", externalCalendarId);
    if (error) throw error;
    return count ?? 0;
  }

  async setVisibilityOverride(id: string, value: EventVisibilityOverride): Promise<Event> {
    const { data, error } = await this.supabase
      .from("events")
      .update({ visibility_override: value })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return fromRow(data);
  }
}

function toDeletedSnapshot(row: {
  id: string;
  external_id: string | null;
  title: string;
  start_time: string;
  end_time: string;
  visibility_override: "none" | "shown" | "hidden";
}): DeletedEventSnapshot {
  return {
    id: row.id,
    externalId: row.external_id ?? "",
    title: row.title,
    startTime: row.start_time,
    endTime: row.end_time,
    visibilityOverride: row.visibility_override,
  };
}
