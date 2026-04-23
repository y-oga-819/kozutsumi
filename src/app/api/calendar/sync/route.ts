import { NextResponse } from "next/server";

import { ProviderTokenMissingError, getValidAccessToken } from "@/shared/google/token";
import { createClient } from "@/shared/supabase/server";

/**
 * Google Calendar 同期エンドポイント。
 *
 * 本 issue (P2-1) では骨格のみ。実同期ロジックは P2-2 で埋める。
 * 401 系の分岐は P2-3 で再ログインバナーを出す側で利用する。
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
    await getValidAccessToken(supabase);
  } catch (error) {
    if (error instanceof ProviderTokenMissingError) {
      return NextResponse.json(
        {
          error: "provider_token_missing",
          message: "Google と連携し直してください",
        },
        { status: 401 },
      );
    }
    throw error;
  }

  // P2-2 で本実装。ここでは骨格として 0 件同期の体を返す。
  return NextResponse.json({ synced: 0, deleted: 0 });
}
