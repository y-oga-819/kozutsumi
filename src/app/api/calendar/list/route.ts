import { NextResponse } from "next/server";

import {
  GoogleApiError,
  GoogleApiUnauthorizedError,
  type GoogleCalendarListEntry,
  listCalendars,
} from "@/shared/google/calendar";
import {
  ProviderTokenMissingError,
  RefreshTokenExpiredError,
  getValidAccessToken,
  refreshAccessToken,
} from "@/shared/google/token";
import { createClient } from "@/shared/supabase/server";

/**
 * Google `calendarList.list` を proxy する route handler (Issue #144 Layer 1)。
 *
 * 認証層は /api/calendar/sync と同じ:
 * - Supabase session 無し → 401 unauthorized
 * - provider_token / refresh_token が無い or 失効 → 401 provider_token_missing
 *
 * 取り込み対象 calendar の選択 UI で叩く想定。kozutsumi 側の subscription 行は
 * 別エンドポイント (POST /api/calendar/subscriptions) で作る。
 */
export async function GET() {
  const supabase = await createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const initial = await getValidAccessToken(supabase);
    let accessToken = initial.accessToken;
    let hasRetried = false;

    const items: GoogleCalendarListEntry[] = [];
    let pageToken: string | undefined;
    while (true) {
      try {
        const page = await listCalendars({
          accessToken,
          pageToken,
          minAccessRole: "reader",
        });
        items.push(...(page.items ?? []));
        pageToken = page.nextPageToken;
        if (!pageToken) break;
      } catch (err) {
        if (err instanceof GoogleApiUnauthorizedError && !hasRetried) {
          hasRetried = true;
          const refreshed = await refreshAccessToken(supabase);
          accessToken = refreshed.accessToken;
          continue;
        }
        throw err;
      }
    }

    return NextResponse.json({
      items: items.map((c) => ({
        id: c.id,
        summary: c.summaryOverride ?? c.summary ?? c.id,
        description: c.description ?? null,
        backgroundColor: c.backgroundColor ?? null,
        foregroundColor: c.foregroundColor ?? null,
        primary: Boolean(c.primary),
        accessRole: c.accessRole ?? "reader",
      })),
    });
  } catch (error) {
    if (error instanceof ProviderTokenMissingError || error instanceof RefreshTokenExpiredError) {
      return NextResponse.json(
        {
          error: "provider_token_missing",
          message: "Google と連携し直してください",
        },
        { status: 401 },
      );
    }
    if (error instanceof GoogleApiError) {
      console.error("[calendar-list] google api error", error.status, error.body);
      return NextResponse.json(
        { error: "google_api_error", message: "カレンダー一覧を取得できませんでした" },
        { status: 502 },
      );
    }
    console.error("[calendar-list] unexpected error", error);
    return NextResponse.json(
      { error: "list_failed", message: "カレンダー一覧の取得中にエラーが発生しました" },
      { status: 500 },
    );
  }
}
