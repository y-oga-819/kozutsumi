import type { SupabaseClient } from "@supabase/supabase-js";

import type { EventSource } from "@/entities/event/types";
import type { Database, TablesInsert } from "@/shared/types/database";

import type { CalendarSubscriptionGateway } from "./gateway";
import type { CalendarSubscription, CreateSubscriptionInput, SetAutoPromoteResult } from "./types";

type Sb = SupabaseClient<Database>;

/**
 * subscription を 1 行 + ネストした external_accounts (external_account_id text) を
 * まとめて取るための joined row 型。Supabase の hint 構文に依存する。
 */
type JoinedSubscriptionRow = {
  id: string;
  external_account_id: string;
  source: EventSource;
  external_calendar_id: string;
  auto_promote_to_timeline: boolean;
  display_name: string | null;
  color: string | null;
  subscribed_at: string;
  external_accounts: {
    external_account_id: string;
  } | null;
};

function fromJoinedRow(row: JoinedSubscriptionRow): CalendarSubscription {
  return {
    id: row.id,
    externalAccountId: row.external_account_id,
    externalAccountIdentifier: row.external_accounts?.external_account_id ?? "",
    source: row.source,
    externalCalendarId: row.external_calendar_id,
    autoPromoteToTimeline: row.auto_promote_to_timeline,
    displayName: row.display_name,
    color: row.color,
    subscribedAt: row.subscribed_at,
  };
}

async function getUserId(supabase: Sb): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("not authenticated");
  return user.id;
}

export class SupabaseCalendarSubscriptionGateway implements CalendarSubscriptionGateway {
  constructor(private readonly supabase: Sb) {}

  async list(): Promise<CalendarSubscription[]> {
    // external_accounts!inner で external_account_id (uuid) FK 経由で join。
    // displayName / source 等は subscription 側にもあるが、action_log triple の
    // external_account_id (text) は external_accounts 側でしか取れない。
    const { data, error } = await this.supabase
      .from("user_calendar_subscriptions")
      .select(
        "id, external_account_id, source, external_calendar_id, auto_promote_to_timeline, display_name, color, subscribed_at, external_accounts!inner(external_account_id)",
      )
      .order("subscribed_at", { ascending: true });
    if (error) throw error;
    // Supabase の型は inner join 時に配列で返るが、!inner かつ FK が単数なのでオブジェクト 1 つ。
    // 型変換コストを避けるため as 経由で受ける。
    return ((data ?? []) as unknown as JoinedSubscriptionRow[]).map(fromJoinedRow);
  }

  async create(input: CreateSubscriptionInput): Promise<CalendarSubscription> {
    const userId = await getUserId(this.supabase);
    const payload: TablesInsert<"user_calendar_subscriptions"> = {
      user_id: userId,
      external_account_id: input.externalAccountId,
      source: input.source,
      external_calendar_id: input.externalCalendarId,
      auto_promote_to_timeline: input.autoPromoteToTimeline ?? true,
      display_name: input.displayName ?? null,
      color: input.color ?? null,
    };
    const { data, error } = await this.supabase
      .from("user_calendar_subscriptions")
      .insert(payload)
      .select(
        "id, external_account_id, source, external_calendar_id, auto_promote_to_timeline, display_name, color, subscribed_at, external_accounts!inner(external_account_id)",
      )
      .single();
    if (error) throw error;
    return fromJoinedRow(data as unknown as JoinedSubscriptionRow);
  }

  async delete(subscriptionId: string): Promise<void> {
    const { error } = await this.supabase
      .from("user_calendar_subscriptions")
      .delete()
      .eq("id", subscriptionId);
    if (error) throw error;
  }

  async setAutoPromote(subscriptionId: string, value: boolean): Promise<SetAutoPromoteResult> {
    const { data, error } = await this.supabase.rpc("fn_set_subscription_auto_promote", {
      p_subscription_id: subscriptionId,
      p_new_value: value,
    });
    if (error) throw error;
    return parseSetAutoPromoteResult(data);
  }
}

/**
 * RPC 戻り値の jsonb (Json 型) を SetAutoPromoteResult に整形する。
 * SQL 側の出力形が崩れたら早めに throw する (frontend 側で曖昧な undefined を扱わせない)。
 */
export function parseSetAutoPromoteResult(raw: unknown): SetAutoPromoteResult {
  if (!raw || typeof raw !== "object") {
    throw new Error("fn_set_subscription_auto_promote: invalid response shape");
  }
  const r = raw as Record<string, unknown>;
  const frozenEventsRaw = Array.isArray(r["frozen_events"]) ? r["frozen_events"] : [];
  return {
    changed: Boolean(r["changed"]),
    from: Boolean(r["from"]),
    to: Boolean(r["to"]),
    source: r["source"] as EventSource,
    externalAccountIdentifier: String(r["external_account_id"] ?? ""),
    externalCalendarId: String(r["external_calendar_id"] ?? ""),
    frozenTo:
      r["frozen_to"] === "shown" || r["frozen_to"] === "hidden"
        ? (r["frozen_to"] as "shown" | "hidden")
        : null,
    frozenEvents: (frozenEventsRaw as Array<Record<string, unknown>>).map((ev) => ({
      externalId: String(ev["external_id"] ?? ""),
      title: String(ev["title"] ?? ""),
      startTime: String(ev["start_time"] ?? ""),
      endTime: String(ev["end_time"] ?? ""),
    })),
  };
}
