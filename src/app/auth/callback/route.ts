import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/shared/supabase/server";

/**
 * Supabase OAuth コールバック。
 *
 * Google OAuth から code を受け取ってセッションに交換する。
 * エラー時は /login に戻し、query に理由を付ける。
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const reason = encodeURIComponent(error.message);
    return NextResponse.redirect(`${origin}/login?error=${reason}`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
