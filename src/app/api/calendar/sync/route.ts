import { NextResponse } from "next/server";

import { logServerSide } from "@/entities/action-log/server";
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
 *
 * Issue #144 で primary 固定 → subscription ベースに変更。 sync は subscription 単位で
 * 動き、Google 側で削除されたイベントの snapshot を action_log に記録する (ADR 0034 L5)。
 */
export async function POST() {
  const supabase = await createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncGoogleCalendar(supabase);

    // sync 中に Google 側で消えた event を 1 件 = 1 ログで system actor として記録する
    // (ADR 0034 L5 / ADR 0035 §4)。失敗しても本処理 (sync 結果返却) は止めない。
    for (const outcome of result.outcomes) {
      for (const deletion of outcome.deletions) {
        const ev = deletion.eventSnapshot;
        await logServerSide(
          supabase,
          user.id,
          "event_deleted_by_source",
          {
            source: outcome.source,
            external_account_id: outcome.externalAccountIdentifier,
            external_calendar_id: outcome.externalCalendarId,
            external_id: ev.externalId,
            snapshot: {
              title: ev.title,
              start_time: ev.startTime,
              end_time: ev.endTime,
              visibility_override: ev.visibilityOverride,
            },
          },
          "system",
        );

        // 依存 task ごとに dependency_lost を 1 件記録 (ADR 0034 L5)。
        for (const taskId of deletion.dependentTaskIds) {
          await logServerSide(
            supabase,
            user.id,
            "task_event_dependency_lost",
            {
              task_id: taskId,
              source: outcome.source,
              external_account_id: outcome.externalAccountIdentifier,
              external_calendar_id: outcome.externalCalendarId,
              external_id: ev.externalId,
              deletion_reason: "deleted_by_source",
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
    }

    return NextResponse.json({
      synced: result.synced,
      deleted: result.deleted,
      lastSyncedAt: result.lastSyncedAt,
      // skipped 情報を UI まで持ち出してバナー / トーストの「N 件スキップ」表示に使う (Issue #219 続き)。
      skipped: result.skipped,
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
    console.error("[calendar-sync] unexpected error", error);
    return NextResponse.json(
      { error: "sync_failed", message: "同期中にエラーが発生しました" },
      { status: 500 },
    );
  }
}
