import { NextResponse } from "next/server";

import { logServerSide } from "@/entities/action-log/server";
import { SupabaseCalendarSubscriptionGateway } from "@/entities/calendar-subscription/supabase-gateway";
import { SupabaseEventGateway } from "@/entities/event/supabase-gateway";
import { SupabaseTaskGateway } from "@/entities/task/supabase-gateway";
import { createClient } from "@/shared/supabase/server";

/**
 * 個別 subscription への操作 (Issue #144 Layer 1/2):
 *
 * - PATCH /api/calendar/subscriptions/[id]   : auto_promote_to_timeline 切替 (ADR 0034 L6/L7)
 * - DELETE /api/calendar/subscriptions/[id]  : unsubscribe (ADR 0034 L9 events 物理削除 + snapshot)
 *
 * 切替は `fn_set_subscription_auto_promote` で atomic に subscription update +
 * 過去 event 旧 default 固定を実行する。
 *
 * unsubscribe は events 物理削除 + 関連 tasks の依存断絶を action_log に記録する。
 * subscription 行は最後に削除する。
 */

type RouteContext = { params: Promise<{ id: string }> };

type PatchBody = {
  autoPromoteToTimeline?: boolean;
};

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
  if (typeof body.autoPromoteToTimeline !== "boolean") {
    return NextResponse.json(
      { error: "invalid_input", message: "autoPromoteToTimeline (boolean) が必須です" },
      { status: 400 },
    );
  }

  try {
    const gateway = new SupabaseCalendarSubscriptionGateway(supabase);
    const result = await gateway.setAutoPromote(id, body.autoPromoteToTimeline);

    if (!result.changed) {
      // 値に変化が無ければ action_log には書かない (連打 / 再送に強い)。
      return NextResponse.json({ result });
    }

    // user actor: 切替操作そのもの
    await logServerSide(
      supabase,
      user.id,
      "calendar_auto_promote_changed",
      {
        source: result.source,
        external_account_id: result.externalAccountIdentifier,
        external_calendar_id: result.externalCalendarId,
        from: result.from,
        to: result.to,
      },
      "user",
    );

    // system actor: 過去 event を旧 default で固定した副作用を 1 event = 1 ログで残す
    if (result.frozenTo) {
      for (const ev of result.frozenEvents) {
        await logServerSide(
          supabase,
          user.id,
          "event_visibility_frozen_by_subscription_toggle",
          {
            source: result.source,
            external_account_id: result.externalAccountIdentifier,
            external_calendar_id: result.externalCalendarId,
            external_id: ev.externalId,
            frozen_to: result.frozenTo,
            triggered_by: id,
          },
          "system",
        );
      }
    }

    return NextResponse.json({ result });
  } catch (error) {
    console.error("[calendar-subscriptions] toggle failed", error);
    return NextResponse.json(
      { error: "toggle_failed", message: "auto_promote の切替に失敗しました" },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const subGateway = new SupabaseCalendarSubscriptionGateway(supabase);
    const subscriptions = await subGateway.list();
    const target = subscriptions.find((s) => s.id === id);
    if (!target) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    // 1. 削除前に events snapshot + 依存 task を読む (FK ON DELETE SET NULL の前)
    const eventGateway = new SupabaseEventGateway(supabase);
    const eventSnapshots = await eventGateway.findAllGoogleEventsByCalendar(
      target.externalCalendarId,
    );
    const eventIds = eventSnapshots.map((e) => e.id);
    const taskGateway = new SupabaseTaskGateway(supabase);
    const dependents = await taskGateway.findTasksDependingOnEvents(eventIds);
    const dependentByEventId = new Map<string, string[]>();
    for (const d of dependents) {
      const list = dependentByEventId.get(d.eventId) ?? [];
      list.push(d.taskId);
      dependentByEventId.set(d.eventId, list);
    }

    // 2. events 物理削除
    await eventGateway.deleteAllGoogleEventsByCalendar(target.externalCalendarId);

    // 3. subscription 行削除
    await subGateway.delete(id);

    // 4. action_log: calendar_unsubscribed (user actor、削除済 events の snapshot list)
    await logServerSide(
      supabase,
      user.id,
      "calendar_unsubscribed",
      {
        source: target.source,
        external_account_id: target.externalAccountIdentifier,
        external_calendar_id: target.externalCalendarId,
        deleted_events: eventSnapshots.map((e) => ({
          external_id: e.externalId,
          title: e.title,
          start_time: e.startTime,
          end_time: e.endTime,
          visibility_override: e.visibilityOverride,
        })),
      },
      "user",
    );

    // 5. action_log: task_event_dependency_lost (system actor、1 task = 1 行)
    for (const ev of eventSnapshots) {
      const taskIds = dependentByEventId.get(ev.id) ?? [];
      for (const taskId of taskIds) {
        await logServerSide(
          supabase,
          user.id,
          "task_event_dependency_lost",
          {
            task_id: taskId,
            source: target.source,
            external_account_id: target.externalAccountIdentifier,
            external_calendar_id: target.externalCalendarId,
            external_id: ev.externalId,
            deletion_reason: "unsubscribed",
            event_snapshot: {
              title: ev.title,
              start_time: ev.startTime,
              end_time: ev.endTime,
            },
          },
          "system",
        );
      }
    }

    return NextResponse.json({
      deleted_events: eventSnapshots.length,
      affected_tasks: dependents.length,
    });
  } catch (error) {
    console.error("[calendar-subscriptions] unsubscribe failed", error);
    return NextResponse.json(
      { error: "unsubscribe_failed", message: "カレンダーの取り込み解除に失敗しました" },
      { status: 500 },
    );
  }
}
