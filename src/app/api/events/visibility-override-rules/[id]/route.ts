import { NextResponse } from "next/server";

import { logServerSide } from "@/entities/action-log/server";
import { createClient } from "@/shared/supabase/server";

/**
 * Issue #229 / ADR 0056 §7: 系列 override の rule 単独削除。
 *
 * - DELETE /api/events/visibility-override-rules/[id]
 *
 * rule を削除しても既存 instance の `visibility_override` (= 事実) は触らない (ADR 0056 §7)。
 * 削除以降に取り込まれる新規 instance は default 動作 (subscription.auto_promote) に戻る。
 *
 * action_log: `event_visibility_rule_removed` を 1 件発火。
 */

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // 削除前に rule の snapshot を取って action_log に残す (ADR 0035 §2 ii: 削除系は snapshot 必須)。
  const { data: rule, error: readErr } = await supabase
    .from("event_visibility_override_rules")
    .select(
      "id, source, external_calendar_id, recurring_event_id, scope, override_value, from_start_time",
    )
    .eq("id", id)
    .maybeSingle();
  if (readErr) {
    console.error("[visibility-override-rules] read failed", readErr);
    return NextResponse.json({ error: "read_failed" }, { status: 500 });
  }
  if (!rule) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { error: delErr } = await supabase
    .from("event_visibility_override_rules")
    .delete()
    .eq("id", id);
  if (delErr) {
    console.error("[visibility-override-rules] delete failed", delErr);
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }

  await logServerSide(
    supabase,
    user.id,
    "event_visibility_rule_removed",
    {
      rule_id: rule.id,
      source: rule.source,
      external_calendar_id: rule.external_calendar_id,
      recurring_event_id: rule.recurring_event_id,
      scope: rule.scope as "this_and_following" | "all",
      override_value: rule.override_value as "shown" | "hidden",
      from_start_time: rule.from_start_time,
    },
    "user",
  );

  return NextResponse.json({ deleted: true });
}
