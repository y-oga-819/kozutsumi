import { NextResponse } from "next/server";

import { logServerSide } from "@/entities/action-log/server";
import { SupabaseCalendarSubscriptionGateway } from "@/entities/calendar-subscription/supabase-gateway";
import { SupabaseEventGateway } from "@/entities/event/supabase-gateway";
import { EVENT_SOURCE, type EventVisibilityOverride } from "@/entities/event/types";
import { createClient } from "@/shared/supabase/server";

/**
 * Issue #145 / ADR 0031 Layer 3 / ADR 0032 / ADR 0034 / ADR 0035:
 * 個別 event の `visibility_override` を更新する。
 *
 * - PATCH /api/events/[id]/visibility-override
 *   body: { value: 'shown' | 'hidden' | 'none' }
 *
 * 値ごとの action_log:
 *   - 'shown'  → event_promoted (user actor)
 *   - 'hidden' → event_demoted  (user actor)
 *   - 'none'   → event_override_cleared (user actor) — 設定画面の override 一覧 reset 専用導線
 *                (ADR 0032: 日常 UI から none への reset は不可)
 *
 * `is_override_of_default` の計算 (ADR 0035 §4 の event_promoted / event_demoted):
 *   subscription.auto_promote_to_timeline と to の関係から、ユーザーが default に
 *   逆らった操作だったかを判定する。Phase 4 学習素材の核シグナル。
 *   - to='shown'  かつ auto_promote=true  → false (default に従っただけ)
 *   - to='shown'  かつ auto_promote=false → true  (default に逆らった)
 *   - to='hidden' かつ auto_promote=true  → true
 *   - to='hidden' かつ auto_promote=false → false
 *   manual event は subscription を持たないが、`auto_promote=true` (= default 表示)
 *   と同等扱いにして同じ式を適用する (ADR 0032 で manual も visibility_override を持つ)。
 */

type RouteContext = { params: Promise<{ id: string }> };

type PatchBody = {
  value?: string;
};

const VALID_VALUES = new Set<EventVisibilityOverride>(["none", "shown", "hidden"]);

export async function PATCH(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const next = body.value as EventVisibilityOverride | undefined;
  if (!next || !VALID_VALUES.has(next)) {
    return NextResponse.json(
      { error: "invalid_input", message: "value は 'none' | 'shown' | 'hidden' のいずれか" },
      { status: 400 },
    );
  }

  // 現状の event を読む。RLS 違反 / 見つからない場合は 404 で早期 return。
  const { data: row, error: readErr } = await supabase
    .from("events")
    .select(
      "id, source, external_id, external_calendar_id, visibility_override, recurring_event_id, user_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (readErr) {
    console.error("[events/visibility-override] read failed", readErr);
    return NextResponse.json({ error: "read_failed" }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const from = row.visibility_override as EventVisibilityOverride;
  if (from === next) {
    // 値に変化が無ければ DB 更新も action_log も書かない (連打 / 再送に強い)。
    return NextResponse.json({ from, to: next, changed: false });
  }

  // subscription を引いて auto_promote を取る (manual は null)。
  let subscriptionAutoPromote = true;
  let externalAccountIdentifier = "";
  if (row.source === EVENT_SOURCE.GOOGLE_CALENDAR) {
    const subs = await new SupabaseCalendarSubscriptionGateway(supabase).list();
    const sub = subs.find(
      (s) => s.source === row.source && s.externalCalendarId === row.external_calendar_id,
    );
    if (sub) {
      subscriptionAutoPromote = sub.autoPromoteToTimeline;
      externalAccountIdentifier = sub.externalAccountIdentifier;
    }
  }

  // 物理更新
  try {
    const gateway = new SupabaseEventGateway(supabase);
    await gateway.setVisibilityOverride(id, next);
  } catch (error) {
    console.error("[events/visibility-override] update failed", error);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  // action_log 発火
  const tripleBase = {
    source: row.source,
    external_account_id: externalAccountIdentifier,
    external_calendar_id: row.external_calendar_id,
    external_id: row.external_id ?? "",
  };

  // ADR 0056 §8: 単発操作でも recurring instance なら recurring_event_id を log に残す。
  // scope='single' を明示することで Phase 4 が「単発 / 系列」を一目で区別できる。
  const recurringEventId = row.recurring_event_id ?? null;

  if (next === "shown") {
    // to='shown' かつ default が auto_promote=true (= 表示) なら is_override_of_default=false。
    // to='shown' かつ default が auto_promote=false (= 非表示) なら是 default 逸脱。
    const isOverrideOfDefault = !subscriptionAutoPromote;
    await logServerSide(
      supabase,
      user.id,
      "event_promoted",
      {
        ...tripleBase,
        from,
        to: "shown",
        subscription_auto_promote: subscriptionAutoPromote,
        is_override_of_default: isOverrideOfDefault,
        scope: "single",
        recurring_event_id: recurringEventId,
      },
      "user",
    );
  } else if (next === "hidden") {
    const isOverrideOfDefault = subscriptionAutoPromote;
    await logServerSide(
      supabase,
      user.id,
      "event_demoted",
      {
        ...tripleBase,
        from,
        to: "hidden",
        subscription_auto_promote: subscriptionAutoPromote,
        is_override_of_default: isOverrideOfDefault,
        scope: "single",
        recurring_event_id: recurringEventId,
      },
      "user",
    );
  } else {
    // next === 'none': override 解除 (ADR 0032: 設定画面 reset 専用導線)
    if (from !== "none") {
      await logServerSide(
        supabase,
        user.id,
        "event_override_cleared",
        {
          ...tripleBase,
          from,
          subscription_auto_promote: subscriptionAutoPromote,
        },
        "user",
      );
    }
  }

  return NextResponse.json({ from, to: next, changed: true });
}
