import { NextResponse } from "next/server";

import { createClient } from "@/shared/supabase/server";

/**
 * Issue #229 / ADR 0056 §7: 系列 override の rule 一覧を返す。
 *
 * - GET /api/events/visibility-override-rules
 *   → { rules: EventVisibilityOverrideRule[] }
 *
 * 認証済 user の rules を全件返す。RLS が user_id = auth.uid() で絞っているので
 * service_role でない限り他ユーザーの rule は読めない。
 *
 * UI (SettingsPanel rules セクション) で「方針」一覧 + 単独削除導線を提供するために使う
 * (孤立 rule の手動削除も同経路、ADR 0056 §7)。
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("event_visibility_override_rules")
    .select(
      "id, source, external_calendar_id, recurring_event_id, scope, override_value, from_start_time, created_at",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[visibility-override-rules] list failed", error);
    return NextResponse.json({ error: "read_failed" }, { status: 500 });
  }

  return NextResponse.json({
    rules: (data ?? []).map((r) => ({
      id: r.id,
      source: r.source,
      externalCalendarId: r.external_calendar_id,
      recurringEventId: r.recurring_event_id,
      scope: r.scope,
      overrideValue: r.override_value,
      fromStartTime: r.from_start_time,
      createdAt: r.created_at,
    })),
  });
}
