import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { createClient } from "@/shared/supabase/server";
import type { Database } from "@/shared/types/database";

import { isAiEnabled } from "./env";

/**
 * `/api/ai/*` Route Handler 共通 helper (ADR 0012 / 0013 / 0014)。
 *
 * 順序:
 * 1. `AI_ENABLED` kill-switch — false なら 200 `{ skipped: true }` で early return。
 *    e2e (`AI_ENABLED=false`)・障害時 kill・env 設定漏れ (fail-soft) はここで吸収する。
 * 2. auth — `getUser()` で Supabase Auth サーバーに token を検証させ、user が無ければ 401。
 *    `getSession()` は cookie 由来データをそのまま返すため auth 境界に置かない (Supabase の警告)。
 * 3. handler — 例外は 500 `{ error: "ai_failed" }`。client は fire-and-forget で握り潰す前提。
 *
 * 本番 / e2e で同じコードパスが走る (ADR 0014)。`if (e2e)` のような専用分岐は作らない。
 */
export type AiRouteContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
  request: Request;
};

export type AiSkippedResponse = {
  skipped: true;
  reason: "ai_disabled";
};

const SKIPPED_BODY: AiSkippedResponse = { skipped: true, reason: "ai_disabled" };

export async function withAiRoute(
  request: Request,
  handler: (ctx: AiRouteContext) => Promise<unknown>,
): Promise<NextResponse> {
  if (!isAiEnabled()) {
    return NextResponse.json(SKIPPED_BODY, { status: 200 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await handler({
      supabase: supabase as unknown as SupabaseClient<Database>,
      userId: user.id,
      request,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[ai] unexpected error", error);
    return NextResponse.json(
      { error: "ai_failed", message: "AI 呼び出しでエラーが発生しました" },
      { status: 500 },
    );
  }
}
