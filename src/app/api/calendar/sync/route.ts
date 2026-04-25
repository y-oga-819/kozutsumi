import { NextResponse } from "next/server";

import { syncGoogleCalendar } from "@/entities/event/sync";
import { ProviderTokenMissingError, RefreshTokenExpiredError } from "@/shared/google/token";
import { createClient } from "@/shared/supabase/server";

/**
 * Google Calendar 同期エンドポイント (ADR 0005)。
 *
 * 認証層:
 * - Supabase session 無し → 401 unauthorized
 * - provider_token / refresh_token が無い or 失効 → 401 provider_token_missing
 *   (UI 側でバナーを出し、再ログイン (= calendar.readonly scope 再付与) に誘導する。P2-3)
 */
export async function POST() {
  const supabase = await createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncGoogleCalendar(supabase);
    return NextResponse.json(result);
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
    console.error("[calendar-sync] unexpected error", error);
    return NextResponse.json(
      { error: "sync_failed", message: "同期中にエラーが発生しました" },
      { status: 500 },
    );
  }
}
