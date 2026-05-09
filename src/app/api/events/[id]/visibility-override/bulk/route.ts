import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { logServerSide } from "@/entities/action-log/server";
import { SupabaseCalendarSubscriptionGateway } from "@/entities/calendar-subscription/supabase-gateway";
import { EVENT_SOURCE } from "@/entities/event/types";
import { createClient } from "@/shared/supabase/server";

/**
 * Issue #229 / ADR 0056: recurring event の系列 override (bulk apply + rule 永続化)。
 *
 * - POST /api/events/[id]/visibility-override/bulk
 *   body: { value: 'shown' | 'hidden', scope: 'this_and_following' | 'all' }
 *
 * 操作対象 instance (path param `id`) を起点に:
 *   1. **bulk apply** (ADR 0056 §3 step 1): 該当 instance の `visibility_override` を
 *      `value` に bulk update。**単発 override 済 (visibility_override != 'none') は保護**
 *      (ADR 0056 §5)。`scope='this_and_following'` は target.start_time 以降のみ。
 *   2. **rule 永続化** (ADR 0056 §3 step 2): `event_visibility_override_rules` を upsert
 *      (1 recurring グループ = 1 rule、新しい操作で上書き)。
 *   3. **action_log** (ADR 0056 §8): 影響を受けた各 instance に `event_promoted` /
 *      `event_demoted` を発火 + rule 行に対し `event_visibility_rule_added` を発火。
 *      全て同じ `bulk_operation_id` (uuid) で紐付ける (1 操作 = 1 集計単位)。
 *
 * recurring instance でない event (`recurring_event_id IS NULL`) に対する系列操作は 400 で拒否する
 * (UI で抑止しているはずだが多重防御)。
 */

type RouteContext = { params: Promise<{ id: string }> };

type PostBody = {
  value?: string;
  scope?: string;
};

export async function POST(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const value = body.value;
  const scope = body.scope;
  if (value !== "shown" && value !== "hidden") {
    return NextResponse.json(
      { error: "invalid_input", message: "value は 'shown' | 'hidden' のいずれか" },
      { status: 400 },
    );
  }
  if (scope !== "this_and_following" && scope !== "all") {
    return NextResponse.json(
      { error: "invalid_input", message: "scope は 'this_and_following' | 'all' のいずれか" },
      { status: 400 },
    );
  }

  // 操作対象 (target) instance を読む。recurring_event_id が NULL なら 400 で拒否。
  const { data: target, error: targetErr } = await supabase
    .from("events")
    .select(
      "id, source, external_calendar_id, external_id, recurring_event_id, start_time, visibility_override",
    )
    .eq("id", id)
    .maybeSingle();
  if (targetErr) {
    console.error("[visibility-override/bulk] read target failed", targetErr);
    return NextResponse.json({ error: "read_failed" }, { status: 500 });
  }
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!target.recurring_event_id) {
    return NextResponse.json(
      { error: "not_recurring", message: "単発 event には系列操作はできません" },
      { status: 400 },
    );
  }

  const recurringEventId = target.recurring_event_id;
  const externalCalendarId = target.external_calendar_id;
  const source = target.source;

  // subscription を引いて auto_promote を取る。manual recurring event は実質存在しないが、
  // 防御として manual fallback (subscription 無し → auto_promote=true 扱い) を踏襲する。
  let subscriptionAutoPromote = true;
  let externalAccountIdentifier = "";
  if (source === EVENT_SOURCE.GOOGLE_CALENDAR) {
    const subs = await new SupabaseCalendarSubscriptionGateway(supabase).list();
    const sub = subs.find(
      (s) => s.source === source && s.externalCalendarId === externalCalendarId,
    );
    if (sub) {
      subscriptionAutoPromote = sub.autoPromoteToTimeline;
      externalAccountIdentifier = sub.externalAccountIdentifier;
    }
  }

  // ADR 0056 §5: 単発 override 済 (visibility_override != 'none') instance は除外して
  // 「事実」を保護する。bulk update の WHERE で `visibility_override = 'none'` を絞ることで実現。
  const targetStart = target.start_time;
  let query = supabase
    .from("events")
    .select("id, external_id, start_time")
    .eq("user_id", user.id)
    .eq("source", source)
    .eq("external_calendar_id", externalCalendarId)
    .eq("recurring_event_id", recurringEventId)
    .eq("visibility_override", "none");
  if (scope === "this_and_following") {
    query = query.gte("start_time", targetStart);
  }
  const { data: targets, error: targetsErr } = await query;
  if (targetsErr) {
    console.error("[visibility-override/bulk] fetch targets failed", targetsErr);
    return NextResponse.json({ error: "read_failed" }, { status: 500 });
  }
  const targetIds = (targets ?? []).map((r) => r.id);

  // bulk update: visibility_override を value に揃える。対象 0 件でも rule の永続化は行う
  // (新規取り込み instance に対して方針が効くため)。
  if (targetIds.length > 0) {
    const { error: updateErr } = await supabase
      .from("events")
      .update({ visibility_override: value })
      .in("id", targetIds);
    if (updateErr) {
      console.error("[visibility-override/bulk] bulk update failed", updateErr);
      return NextResponse.json({ error: "update_failed" }, { status: 500 });
    }
  }

  // rule 永続化 (ADR 0056 §3 step 2): 同 recurring グループに既存 rule があれば置き換える
  // (UNIQUE (user_id, source, external_calendar_id, recurring_event_id) を活用)。
  const fromStartTime = scope === "this_and_following" ? targetStart : null;
  const { data: rule, error: ruleErr } = await supabase
    .from("event_visibility_override_rules")
    .upsert(
      {
        user_id: user.id,
        source,
        external_calendar_id: externalCalendarId,
        recurring_event_id: recurringEventId,
        scope,
        override_value: value,
        from_start_time: fromStartTime,
      },
      { onConflict: "user_id,source,external_calendar_id,recurring_event_id" },
    )
    .select("id")
    .single();
  if (ruleErr || !rule) {
    console.error("[visibility-override/bulk] rule upsert failed", ruleErr);
    return NextResponse.json({ error: "rule_upsert_failed" }, { status: 500 });
  }

  // action_log (ADR 0056 §8): bulk_operation_id で全 log を 1 操作として紐付ける。
  const bulkOperationId = randomUUID();
  const tripleBase = {
    source,
    external_account_id: externalAccountIdentifier,
    external_calendar_id: externalCalendarId,
  };

  // 各 instance ごとに 1 件 (event_promoted / event_demoted)。
  // is_override_of_default は to と subscription_auto_promote の関係から計算 (PATCH と同じ式)。
  const isOverrideOfDefault =
    value === "shown" ? !subscriptionAutoPromote : subscriptionAutoPromote;
  for (const r of targets ?? []) {
    if (value === "shown") {
      await logServerSide(
        supabase,
        user.id,
        "event_promoted",
        {
          ...tripleBase,
          external_id: r.external_id ?? "",
          from: "none",
          to: "shown",
          subscription_auto_promote: subscriptionAutoPromote,
          is_override_of_default: isOverrideOfDefault,
          scope,
          recurring_event_id: recurringEventId,
          bulk_operation_id: bulkOperationId,
        },
        "user",
      );
    } else {
      await logServerSide(
        supabase,
        user.id,
        "event_demoted",
        {
          ...tripleBase,
          external_id: r.external_id ?? "",
          from: "none",
          to: "hidden",
          subscription_auto_promote: subscriptionAutoPromote,
          is_override_of_default: isOverrideOfDefault,
          scope,
          recurring_event_id: recurringEventId,
          bulk_operation_id: bulkOperationId,
        },
        "user",
      );
    }
  }

  // rule 永続化を 1 件 log。bulk_operation_id で event_*ed 群と紐付ける。
  await logServerSide(
    supabase,
    user.id,
    "event_visibility_rule_added",
    {
      rule_id: rule.id,
      source,
      external_calendar_id: externalCalendarId,
      recurring_event_id: recurringEventId,
      scope,
      override_value: value,
      from_start_time: fromStartTime,
      bulk_operation_id: bulkOperationId,
    },
    "user",
  );

  return NextResponse.json({
    rule_id: rule.id,
    bulk_operation_id: bulkOperationId,
    scope,
    value,
    affected_event_ids: targetIds,
  });
}
