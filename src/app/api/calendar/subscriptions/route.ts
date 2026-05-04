import { NextResponse } from "next/server";

import { logServerSide } from "@/entities/action-log/server";
import { SupabaseCalendarSubscriptionGateway } from "@/entities/calendar-subscription/supabase-gateway";
import { SupabaseEventGateway } from "@/entities/event/supabase-gateway";
import { syncGoogleCalendar } from "@/entities/event/sync";
import { EVENT_SOURCE } from "@/entities/event/types";
import { ProviderTokenMissingError, RefreshTokenExpiredError } from "@/shared/google/token";
import { createClient } from "@/shared/supabase/server";

/**
 * Calendar subscription の CRUD route handler (Issue #144 Layer 1/2)。
 *
 * - GET    /api/calendar/subscriptions          : 認証済 user の subscription 一覧
 * - POST   /api/calendar/subscriptions          : 新規 subscribe (ADR 0034 L1: 過去 N 日 sync を発火)
 *
 * 個別 subscription への削除 / toggle は /api/calendar/subscriptions/[id]/route.ts に分離。
 */

export async function GET() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const gateway = new SupabaseCalendarSubscriptionGateway(supabase);
    const subscriptions = await gateway.list();
    return NextResponse.json({ subscriptions });
  } catch (error) {
    console.error("[calendar-subscriptions] list failed", error);
    return NextResponse.json(
      { error: "list_failed", message: "subscription 一覧の取得に失敗しました" },
      { status: 500 },
    );
  }
}

type SubscribeRequestBody = {
  externalAccountId?: string;
  externalCalendarId?: string;
  autoPromoteToTimeline?: boolean;
  displayName?: string | null;
  color?: string | null;
};

export async function POST(req: Request) {
  const supabase = await createClient();
  const { session, user } = await sessionAndUser(supabase);
  if (!session || !user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: SubscribeRequestBody;
  try {
    body = (await req.json()) as SubscribeRequestBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.externalAccountId || !body.externalCalendarId) {
    return NextResponse.json(
      { error: "invalid_input", message: "externalAccountId と externalCalendarId は必須です" },
      { status: 400 },
    );
  }

  try {
    const gateway = new SupabaseCalendarSubscriptionGateway(supabase);
    const subscription = await gateway.create({
      externalAccountId: body.externalAccountId,
      source: EVENT_SOURCE.GOOGLE_CALENDAR,
      externalCalendarId: body.externalCalendarId,
      autoPromoteToTimeline: body.autoPromoteToTimeline ?? true,
      displayName: body.displayName ?? null,
      color: body.color ?? null,
    });

    // ADR 0034 L1: 初回 subscribe で過去 N 日分を取り込む。default の sync window と
    // 同じ実装を流用 (resolveSubscriptionTargets で当該 subscription だけ返す形)。
    const eventGateway = new SupabaseEventGateway(supabase);
    let syncOutcome: Awaited<ReturnType<typeof syncGoogleCalendar>> | null = null;
    try {
      syncOutcome = await syncGoogleCalendar(supabase, {
        gateway: eventGateway,
        resolveSubscriptionTargets: async () => [
          {
            externalAccountUuid: subscription.externalAccountId,
            externalAccountIdentifier: subscription.externalAccountIdentifier,
            externalCalendarId: subscription.externalCalendarId,
          },
        ],
      });
    } catch (syncError) {
      // sync 失敗は subscription 行を消さない (ユーザーは再 sync で復旧できる)。
      // ただしログには残す。
      console.error("[calendar-subscriptions] initial sync failed", syncError);
    }

    // action_log: calendar_subscribed (user actor)
    await logServerSide(
      supabase,
      user.id,
      "calendar_subscribed",
      {
        source: subscription.source,
        external_account_id: subscription.externalAccountIdentifier,
        external_calendar_id: subscription.externalCalendarId,
        auto_promote_to_timeline: subscription.autoPromoteToTimeline,
      },
      "user",
    );

    return NextResponse.json({
      subscription,
      sync: syncOutcome
        ? {
            synced: syncOutcome.synced,
            deleted: syncOutcome.deleted,
            lastSyncedAt: syncOutcome.lastSyncedAt,
          }
        : null,
    });
  } catch (error) {
    if (error instanceof ProviderTokenMissingError || error instanceof RefreshTokenExpiredError) {
      return NextResponse.json(
        { error: "provider_token_missing", message: "Google と連携し直してください" },
        { status: 401 },
      );
    }
    // PostgREST: 23505 = UNIQUE 違反 (既に subscribe 済)
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return NextResponse.json(
        { error: "already_subscribed", message: "既に取り込み中のカレンダーです" },
        { status: 409 },
      );
    }
    console.error("[calendar-subscriptions] subscribe failed", error);
    return NextResponse.json(
      { error: "subscribe_failed", message: "カレンダーの取り込みに失敗しました" },
      { status: 500 },
    );
  }
}

async function sessionAndUser(supabase: Awaited<ReturnType<typeof createClient>>) {
  const [{ data: sessionData }, { data: userData }] = await Promise.all([
    supabase.auth.getSession(),
    supabase.auth.getUser(),
  ]);
  return { session: sessionData.session, user: userData.user };
}
