import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  CalendarSyncStateGateway,
  CalendarSyncStateKey,
} from "@/entities/calendar-sync/gateway";
import { SupabaseCalendarSyncStateGateway } from "@/entities/calendar-sync/supabase-gateway";
import {
  GoogleApiError,
  GoogleApiUnauthorizedError,
  type GoogleCalendarEvent,
  type GoogleCalendarEventsListResponse,
  type ListEventsParams,
  listEvents as defaultListEvents,
} from "@/shared/google/calendar";
import {
  getValidAccessToken as defaultGetValidAccessToken,
  refreshAccessToken as defaultRefreshAccessToken,
  type GoogleProviderAccess,
} from "@/shared/google/token";
import type { Database } from "@/shared/types/database";

import { EVENT_SOURCE } from "./types";
import type { EventGateway, UpsertGoogleCalendarEventInput } from "./gateway";
import { SupabaseEventGateway } from "./supabase-gateway";

/**
 * Google Calendar → events テーブル 同期本体 (ADR 0005 / 0006 / 0008 / 0010)。
 *
 * - 対象は primary カレンダーのみ (ADR 0008)
 * - 同期方式 (ADR 0006):
 *   - syncToken 未保存 → 過去 7 日 〜 未来 30 日を full sync。最終ページの nextSyncToken を保存
 *   - syncToken 保存済み → 期間指定なし incremental sync。最終ページの nextSyncToken で更新
 *   - 410 Gone (syncToken 失効) → syncToken を捨てて full sync に 1 度だけ fallback
 * - 2 回目以降も idempotent: `(source, external_id)` の unique 制約に upsert
 * - Google 側で cancelled になったものはローカルからも削除 (incremental でも機能する)
 * - 401 を受けたら `refreshAccessToken` → 1 回だけ retry (ADR 0009)
 */

const SYNC_WINDOW_PAST_DAYS = 7;
const SYNC_WINDOW_FUTURE_DAYS = 30;
const PRIMARY_CALENDAR_ID = "primary";
// 終日イベントを kozutsumi 時刻に落とし込む際のタイムゾーン (JST 固定)。
// マルチタイムゾーン対応は将来スコープ。
const ALL_DAY_TZ_OFFSET_MIN = 9 * 60;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_TITLE = "(タイトルなし)";

export type SyncResult = {
  synced: number;
  deleted: number;
  lastSyncedAt: string;
};

export type SyncGoogleCalendarDeps = {
  gateway: EventGateway;
  syncStateGateway: CalendarSyncStateGateway;
  listEvents: (params: ListEventsParams) => Promise<GoogleCalendarEventsListResponse>;
  getValidAccessToken: (supabase: SupabaseClient<Database>) => Promise<GoogleProviderAccess>;
  refreshAccessToken: (supabase: SupabaseClient<Database>) => Promise<GoogleProviderAccess>;
  /**
   * 現在ユーザーの primary Google account に対応する `external_accounts.id` を返す。
   * 未存在なら lazy upsert する (Issue #159 §8 の最小コード変更スコープ)。
   * Issue #144 / #146 で複数 account / 複数 calendar 対応時に置き換える。
   */
  resolvePrimaryExternalAccountId: (supabase: SupabaseClient<Database>) => Promise<string>;
  now: () => Date;
};

export async function syncGoogleCalendar(
  supabase: SupabaseClient<Database>,
  overrides: Partial<SyncGoogleCalendarDeps> = {},
): Promise<SyncResult> {
  const deps: SyncGoogleCalendarDeps = {
    gateway: overrides.gateway ?? new SupabaseEventGateway(supabase),
    syncStateGateway: overrides.syncStateGateway ?? new SupabaseCalendarSyncStateGateway(supabase),
    listEvents: overrides.listEvents ?? defaultListEvents,
    getValidAccessToken: overrides.getValidAccessToken ?? defaultGetValidAccessToken,
    refreshAccessToken: overrides.refreshAccessToken ?? defaultRefreshAccessToken,
    resolvePrimaryExternalAccountId:
      overrides.resolvePrimaryExternalAccountId ?? defaultResolvePrimaryExternalAccountId,
    now: overrides.now ?? (() => new Date()),
  };

  const externalAccountId = await deps.resolvePrimaryExternalAccountId(supabase);
  const syncStateKey: CalendarSyncStateKey = {
    source: EVENT_SOURCE.GOOGLE_CALENDAR,
    externalAccountId,
    externalCalendarId: PRIMARY_CALENDAR_ID,
  };

  const nowDate = deps.now();
  const timeMin = new Date(nowDate.getTime() - SYNC_WINDOW_PAST_DAYS * MS_PER_DAY).toISOString();
  const timeMax = new Date(nowDate.getTime() + SYNC_WINDOW_FUTURE_DAYS * MS_PER_DAY).toISOString();

  const initialState = await deps.syncStateGateway.get(syncStateKey);
  let activeSyncToken: string | undefined = initialState?.syncToken ?? undefined;

  const initial = await deps.getValidAccessToken(supabase);
  let accessToken = initial.accessToken;
  let hasRetriedAuth = false;
  let hasFallenBackFromGone = false;

  let collected: GoogleCalendarEvent[] = [];
  let nextSyncToken: string | undefined;

  // 外側ループは 410 Gone fallback のリトライ。inner ループで最終ページまで到達したら break。
  outer: while (true) {
    collected = [];
    nextSyncToken = undefined;
    let pageToken: string | undefined;

    while (true) {
      let page: GoogleCalendarEventsListResponse;
      try {
        page = await deps.listEvents(
          buildListParams({
            accessToken,
            syncToken: activeSyncToken,
            timeMin,
            timeMax,
            pageToken,
          }),
        );
      } catch (err) {
        if (err instanceof GoogleApiUnauthorizedError && !hasRetriedAuth) {
          hasRetriedAuth = true;
          const refreshed = await deps.refreshAccessToken(supabase);
          accessToken = refreshed.accessToken;
          continue;
        }
        // 410 Gone: syncToken 失効 → token を捨てて full sync に 1 回だけ fallback
        if (
          err instanceof GoogleApiError &&
          err.status === 410 &&
          activeSyncToken !== undefined &&
          !hasFallenBackFromGone
        ) {
          hasFallenBackFromGone = true;
          activeSyncToken = undefined;
          continue outer;
        }
        throw err;
      }

      collected.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
      if (!pageToken) {
        // 最終ページの nextSyncToken のみが次回の incremental に使える (中間ページのものは無効)。
        nextSyncToken = page.nextSyncToken;
        break;
      }
    }

    break;
  }

  const { upserts, cancelled } = partitionEvents(collected, PRIMARY_CALENDAR_ID);

  let synced = 0;
  if (upserts.length > 0) {
    synced = await deps.gateway.upsertFromGoogleCalendar(upserts);
  }
  let deleted = 0;
  if (cancelled.length > 0) {
    deleted = await deps.gateway.deleteByGoogleExternalIds(PRIMARY_CALENDAR_ID, cancelled);
  }

  const lastSyncedAt = nowDate.toISOString();
  // 成功したときだけ atomic に lastSyncedAt + syncToken を記録する。
  // listEvents が最後まで throw した経路ではここに来ないので、stale な syncToken は上書きされない。
  await deps.syncStateGateway.saveSyncState(syncStateKey, {
    lastSyncedAt,
    syncToken: nextSyncToken ?? null,
  });

  return {
    synced,
    deleted,
    lastSyncedAt,
  };
}

/**
 * 現在ユーザーの primary Google account を `external_accounts` で確保する (lazy upsert)。
 *
 * - 既存ユーザーは migration の seed で行が存在する。
 * - 新規ユーザー (migration 後に Google ログインしたが #159 の seed 対象外) はここで作る。
 * - `external_account_id` (text) は auth.users.email を優先、fallback で user.id を使う
 *   (migration の seed と同じ規約)。Google API で google_user_id を取得する経路は #146 で扱う。
 */
async function defaultResolvePrimaryExternalAccountId(
  supabase: SupabaseClient<Database>,
): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("not authenticated");

  // 既存行を探す: (user_id, source) で limit 1 (現状 1 user に primary 1 account)
  const { data: existing, error: selectErr } = await supabase
    .from("external_accounts")
    .select("id")
    .eq("user_id", user.id)
    .eq("source", EVENT_SOURCE.GOOGLE_CALENDAR)
    .limit(1)
    .maybeSingle();
  if (selectErr) throw selectErr;
  if (existing) return existing.id;

  // 無ければ作る (UNIQUE (user_id, source, external_account_id) の重複は起きない前提)
  const externalAccountIdValue = user.email ?? user.id;
  const { data: inserted, error: insertErr } = await supabase
    .from("external_accounts")
    .insert({
      user_id: user.id,
      source: EVENT_SOURCE.GOOGLE_CALENDAR,
      external_account_id: externalAccountIdValue,
      display_name: "(primary)",
    })
    .select("id")
    .single();
  if (insertErr) throw insertErr;
  return inserted.id;
}

/**
 * full / incremental の差分は Google API の制約 (syncToken 併用不可) を埋め込んだ params 構築に閉じる。
 * - syncToken あり: timeMin / timeMax / orderBy は付けない
 * - syncToken なし: 通常の full sync
 */
function buildListParams(args: {
  accessToken: string;
  syncToken: string | undefined;
  timeMin: string;
  timeMax: string;
  pageToken: string | undefined;
}): ListEventsParams {
  if (args.syncToken) {
    return {
      accessToken: args.accessToken,
      calendarId: PRIMARY_CALENDAR_ID,
      syncToken: args.syncToken,
      // singleEvents は full sync と同じ値でなければならない (Google API 仕様)
      singleEvents: true,
      pageToken: args.pageToken,
    };
  }
  return {
    accessToken: args.accessToken,
    calendarId: PRIMARY_CALENDAR_ID,
    timeMin: args.timeMin,
    timeMax: args.timeMax,
    singleEvents: true,
    orderBy: "startTime",
    pageToken: args.pageToken,
  };
}

export function partitionEvents(
  events: GoogleCalendarEvent[],
  externalCalendarId: string,
): {
  upserts: UpsertGoogleCalendarEventInput[];
  cancelled: string[];
} {
  const upserts: UpsertGoogleCalendarEventInput[] = [];
  const cancelled: string[] = [];
  for (const ev of events) {
    if (ev.status === "cancelled") {
      cancelled.push(ev.id);
      continue;
    }
    const mapped = mapGoogleEventToUpsertInput(ev, externalCalendarId);
    if (mapped) upserts.push(mapped);
  }
  return { upserts, cancelled };
}

export function mapGoogleEventToUpsertInput(
  event: GoogleCalendarEvent,
  externalCalendarId: string,
): UpsertGoogleCalendarEventInput | null {
  const times = resolveEventTimes(event);
  if (!times) return null;

  return {
    externalCalendarId,
    externalId: event.id,
    title: event.summary ?? DEFAULT_TITLE,
    startTime: times.start,
    endTime: times.end,
    meetUrl: extractMeetUrl(event),
    hasAttachments: Array.isArray(event.attachments) && event.attachments.length > 0,
    description: event.description ?? "",
  };
}

export function resolveEventTimes(
  event: GoogleCalendarEvent,
): { start: string; end: string } | null {
  if (event.start?.dateTime && event.end?.dateTime) {
    return {
      start: new Date(event.start.dateTime).toISOString(),
      end: new Date(event.end.dateTime).toISOString(),
    };
  }
  if (event.start?.date && event.end?.date) {
    return {
      start: allDayDateToJstUtc(event.start.date),
      end: allDayDateToJstUtc(event.end.date),
    };
  }
  return null;
}

export function extractMeetUrl(event: GoogleCalendarEvent): string | null {
  if (event.hangoutLink) return event.hangoutLink;
  const video = event.conferenceData?.entryPoints?.find(
    (ep) => ep.entryPointType === "video" && typeof ep.uri === "string",
  );
  return video?.uri ?? null;
}

function allDayDateToJstUtc(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  if (!y || !m || !d) {
    throw new Error(`Invalid all-day date: ${yyyymmdd}`);
  }
  // JST の 00:00 を UTC に変換 (UTC 基準で -9h)
  const utcMillis = Date.UTC(y, m - 1, d) - ALL_DAY_TZ_OFFSET_MIN * 60 * 1000;
  return new Date(utcMillis).toISOString();
}
