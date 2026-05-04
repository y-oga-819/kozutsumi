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
import type { DeletedEventSnapshot, EventGateway, UpsertGoogleCalendarEventInput } from "./gateway";
import { SupabaseEventGateway } from "./supabase-gateway";

/**
 * Google Calendar → events テーブル 同期本体 (ADR 0005 / 0006 / 0008 / 0010 / 0031 / 0033 / 0034)。
 *
 * - 対象は user の subscription にある全 calendar (Issue #144)。primary 固定 (旧 ADR 0008) は廃止。
 * - 同期方式 (ADR 0006、calendar 単位):
 *   - syncToken 未保存 → 過去 7 日 〜 未来 30 日を full sync。最終ページの nextSyncToken を保存
 *   - syncToken 保存済み → 期間指定なし incremental sync。最終ページの nextSyncToken で更新
 *   - 410 Gone (syncToken 失効) → syncToken を捨てて full sync に 1 度だけ fallback
 * - 2 回目以降も idempotent: `(source, external_calendar_id, external_id)` の triple で upsert
 * - Google 側で cancelled になったものはローカルからも削除 (incremental でも機能する)
 *   削除前に snapshot を読んで `event_deleted_by_source` (system actor) +
 *   `task_event_dependency_lost` (system actor) を action_log に書く (ADR 0034 L5)
 * - 401 を受けたら `refreshAccessToken` → 1 回だけ retry (ADR 0009)
 *
 * primary 固定の lazy upsert は subscription seed (#159) で済んでいるが、subscription が
 * 1 件もない user (新規 OAuth ユーザー) には primary を 1 行だけ作って続行する。
 */

const SYNC_WINDOW_PAST_DAYS = 7;
const SYNC_WINDOW_FUTURE_DAYS = 30;
const PRIMARY_CALENDAR_ID = "primary";
// 終日イベントを kozutsumi 時刻に落とし込む際のタイムゾーン (JST 固定)。
// マルチタイムゾーン対応は将来スコープ。
const ALL_DAY_TZ_OFFSET_MIN = 9 * 60;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_TITLE = "(タイトルなし)";

/**
 * 1 calendar 分の sync 結果。複数 calendar の集約は呼び出し側で sum する。
 * `triple` は action_log の triple metadata (`event_deleted_by_source` 等) を作るために
 * 呼び出し側へ渡す source-agnostic 識別子。
 */
export type CalendarSyncOutcome = {
  source: "manual" | "google_calendar";
  externalAccountIdentifier: string;
  externalCalendarId: string;
  synced: number;
  deleted: number;
  /** 削除された events の snapshot + 依存していた task ids。action_log に書く材料。 */
  deletions: Array<{
    eventSnapshot: DeletedEventSnapshot;
    dependentTaskIds: string[];
  }>;
};

export type SyncResult = {
  synced: number;
  deleted: number;
  lastSyncedAt: string;
  /** 同期した calendar 単位の outcome 配列。1 calendar = 1 entry。 */
  outcomes: CalendarSyncOutcome[];
};

/**
 * 1 calendar 分の sync で必要な subscription 情報。caller (route handler / subscribe フロー) が解決する。
 */
export type SubscriptionTarget = {
  externalAccountUuid: string;
  externalAccountIdentifier: string;
  externalCalendarId: string;
};

export type SyncGoogleCalendarDeps = {
  gateway: EventGateway;
  syncStateGateway: CalendarSyncStateGateway;
  listEvents: (params: ListEventsParams) => Promise<GoogleCalendarEventsListResponse>;
  getValidAccessToken: (supabase: SupabaseClient<Database>) => Promise<GoogleProviderAccess>;
  refreshAccessToken: (supabase: SupabaseClient<Database>) => Promise<GoogleProviderAccess>;
  /**
   * 認証済 user の sync 対象 subscription を解決する。本 hook が空配列を返す user
   * (subscription 行が無い新規 user) には primary 1 行を seed して返す default 実装が走る。
   */
  resolveSubscriptionTargets: (supabase: SupabaseClient<Database>) => Promise<SubscriptionTarget[]>;
  /**
   * task 側の依存解析: events.id 配列から `tasks.depends_on_event_id` で参照している task の
   * id 配列を返す。`task_event_dependency_lost` を action_log に書く前段で呼ぶ (ADR 0034 L5)。
   */
  findTasksDependingOnEvents: (
    supabase: SupabaseClient<Database>,
    eventIds: string[],
  ) => Promise<Array<{ taskId: string; eventId: string }>>;
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
    resolveSubscriptionTargets:
      overrides.resolveSubscriptionTargets ?? defaultResolveSubscriptionTargets,
    findTasksDependingOnEvents:
      overrides.findTasksDependingOnEvents ?? defaultFindTasksDependingOnEvents,
    now: overrides.now ?? (() => new Date()),
  };

  const targets = await deps.resolveSubscriptionTargets(supabase);

  // 1 sync 全体で provider token は共有 (ADR 0009 / refresh は最大 1 回 / sync まとめて)。
  // 401 retry は calendar 単位のループで完結させる (各 calendar が独立して最大 1 回 refresh する余地を持つ)。
  const initial = await deps.getValidAccessToken(supabase);

  let totalSynced = 0;
  let totalDeleted = 0;
  const outcomes: CalendarSyncOutcome[] = [];
  const lastSyncedAt = deps.now().toISOString();

  for (const target of targets) {
    const result = await syncOneCalendar(supabase, deps, initial.accessToken, target);
    totalSynced += result.synced;
    totalDeleted += result.deleted;
    // 公開 SyncResult.outcomes には nextSyncToken を含めない (内部キャリア用)。
    outcomes.push({
      source: result.source,
      externalAccountIdentifier: result.externalAccountIdentifier,
      externalCalendarId: result.externalCalendarId,
      synced: result.synced,
      deleted: result.deleted,
      deletions: result.deletions,
    });

    // calendar 単位の lastSyncedAt を保存する (1 calendar 失敗 → 他 calendar は完了状態を残す)。
    await deps.syncStateGateway.saveSyncState(
      {
        source: EVENT_SOURCE.GOOGLE_CALENDAR,
        externalAccountId: target.externalAccountUuid,
        externalCalendarId: target.externalCalendarId,
      },
      {
        lastSyncedAt,
        syncToken: result.nextSyncToken ?? null,
      },
    );
  }

  return {
    synced: totalSynced,
    deleted: totalDeleted,
    lastSyncedAt,
    outcomes,
  };
}

/**
 * 1 calendar 分の sync。token refresh + 410 Gone fallback + paging + delete 検出を内包する。
 * `nextSyncToken` は呼び出し側が `saveSyncState` に渡すために返す。
 */
async function syncOneCalendar(
  supabase: SupabaseClient<Database>,
  deps: SyncGoogleCalendarDeps,
  initialAccessToken: string,
  target: SubscriptionTarget,
): Promise<CalendarSyncOutcome & { nextSyncToken: string | undefined }> {
  const syncStateKey: CalendarSyncStateKey = {
    source: EVENT_SOURCE.GOOGLE_CALENDAR,
    externalAccountId: target.externalAccountUuid,
    externalCalendarId: target.externalCalendarId,
  };

  const nowDate = deps.now();
  const timeMin = new Date(nowDate.getTime() - SYNC_WINDOW_PAST_DAYS * MS_PER_DAY).toISOString();
  const timeMax = new Date(nowDate.getTime() + SYNC_WINDOW_FUTURE_DAYS * MS_PER_DAY).toISOString();

  const initialState = await deps.syncStateGateway.get(syncStateKey);
  let activeSyncToken: string | undefined = initialState?.syncToken ?? undefined;

  let accessToken = initialAccessToken;
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
            calendarId: target.externalCalendarId,
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

  const { upserts, cancelled } = partitionEvents(collected, target.externalCalendarId);

  let synced = 0;
  if (upserts.length > 0) {
    synced = await deps.gateway.upsertFromGoogleCalendar(upserts);
  }

  // 削除前に events の snapshot と依存 task を読む (ADR 0034 L5 / ADR 0035 §2 ii)。
  // FK ON DELETE SET NULL なので、events を消した後では tasks 側 join が成立しない。
  const deletions: CalendarSyncOutcome["deletions"] = [];
  let deleted = 0;
  if (cancelled.length > 0) {
    const snapshots = await deps.gateway.findGoogleEventSnapshots(
      target.externalCalendarId,
      cancelled,
    );
    const eventIds = snapshots.map((s) => s.id);
    const dependents = await deps.findTasksDependingOnEvents(supabase, eventIds);
    const taskIdsByEventId = new Map<string, string[]>();
    for (const d of dependents) {
      const list = taskIdsByEventId.get(d.eventId) ?? [];
      list.push(d.taskId);
      taskIdsByEventId.set(d.eventId, list);
    }

    deleted = await deps.gateway.deleteByGoogleExternalIds(target.externalCalendarId, cancelled);

    for (const snapshot of snapshots) {
      deletions.push({
        eventSnapshot: snapshot,
        dependentTaskIds: taskIdsByEventId.get(snapshot.id) ?? [],
      });
    }
  }

  return {
    source: EVENT_SOURCE.GOOGLE_CALENDAR,
    externalAccountIdentifier: target.externalAccountIdentifier,
    externalCalendarId: target.externalCalendarId,
    synced,
    deleted,
    deletions,
    nextSyncToken,
  };
}

/**
 * 認証済 user の subscription 一覧 (google_calendar) を解決する。
 *
 * 既存ユーザーは migration の seed で行が存在する。新規ユーザー (migration 後に Google ログインしたが
 * #159 の seed 対象外) には primary 1 行を seed する。`external_account_id` (text) は
 * auth.users.email を優先、fallback で user.id を使う (migration の seed と同じ規約)。
 */
export async function defaultResolveSubscriptionTargets(
  supabase: SupabaseClient<Database>,
): Promise<SubscriptionTarget[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("not authenticated");

  // subscription 行を join で読む。external_accounts.external_account_id は action_log triple の
  // middle id として下流で必要。
  const { data: subscriptions, error: subErr } = await supabase
    .from("user_calendar_subscriptions")
    .select(
      "external_account_id, external_calendar_id, external_accounts!inner(external_account_id)",
    )
    .eq("user_id", user.id)
    .eq("source", EVENT_SOURCE.GOOGLE_CALENDAR);
  if (subErr) throw subErr;

  if ((subscriptions ?? []).length > 0) {
    return (subscriptions ?? []).map((row) => ({
      externalAccountUuid: row.external_account_id,
      externalAccountIdentifier:
        (row.external_accounts as unknown as { external_account_id: string } | null)
          ?.external_account_id ?? "",
      externalCalendarId: row.external_calendar_id,
    }));
  }

  // subscription が無い user (新規 OAuth ユーザー or seed 漏れ) は primary 1 行を作る。
  const externalAccountIdValue = user.email ?? user.id;
  const { data: existingAccount, error: selectAccErr } = await supabase
    .from("external_accounts")
    .select("id, external_account_id")
    .eq("user_id", user.id)
    .eq("source", EVENT_SOURCE.GOOGLE_CALENDAR)
    .limit(1)
    .maybeSingle();
  if (selectAccErr) throw selectAccErr;

  let accountUuid: string;
  let accountIdentifier: string;
  if (existingAccount) {
    accountUuid = existingAccount.id;
    accountIdentifier = existingAccount.external_account_id;
  } else {
    const { data: insertedAccount, error: insertAccErr } = await supabase
      .from("external_accounts")
      .insert({
        user_id: user.id,
        source: EVENT_SOURCE.GOOGLE_CALENDAR,
        external_account_id: externalAccountIdValue,
        display_name: "(primary)",
      })
      .select("id, external_account_id")
      .single();
    if (insertAccErr) throw insertAccErr;
    accountUuid = insertedAccount.id;
    accountIdentifier = insertedAccount.external_account_id;
  }

  // primary 1 行を upsert (subscription 行)。同じ user/account/calendar が存在すれば no-op。
  await supabase.from("user_calendar_subscriptions").upsert(
    {
      user_id: user.id,
      external_account_id: accountUuid,
      source: EVENT_SOURCE.GOOGLE_CALENDAR,
      external_calendar_id: PRIMARY_CALENDAR_ID,
      auto_promote_to_timeline: true,
      display_name: "(primary)",
    },
    { onConflict: "user_id,external_account_id,external_calendar_id" },
  );

  return [
    {
      externalAccountUuid: accountUuid,
      externalAccountIdentifier: accountIdentifier,
      externalCalendarId: PRIMARY_CALENDAR_ID,
    },
  ];
}

async function defaultFindTasksDependingOnEvents(
  supabase: SupabaseClient<Database>,
  eventIds: string[],
): Promise<Array<{ taskId: string; eventId: string }>> {
  if (eventIds.length === 0) return [];
  const { data, error } = await supabase
    .from("tasks")
    .select("id, depends_on_event_id")
    .in("depends_on_event_id", eventIds);
  if (error) throw error;
  return (data ?? [])
    .filter((row): row is { id: string; depends_on_event_id: string } =>
      Boolean(row.depends_on_event_id),
    )
    .map((row) => ({ taskId: row.id, eventId: row.depends_on_event_id }));
}

/**
 * full / incremental の差分は Google API の制約 (syncToken 併用不可) を埋め込んだ params 構築に閉じる。
 * - syncToken あり: timeMin / timeMax / orderBy は付けない
 * - syncToken なし: 通常の full sync
 */
function buildListParams(args: {
  accessToken: string;
  calendarId: string;
  syncToken: string | undefined;
  timeMin: string;
  timeMax: string;
  pageToken: string | undefined;
}): ListEventsParams {
  if (args.syncToken) {
    return {
      accessToken: args.accessToken,
      calendarId: args.calendarId,
      syncToken: args.syncToken,
      // singleEvents は full sync と同じ値でなければならない (Google API 仕様)
      singleEvents: true,
      pageToken: args.pageToken,
    };
  }
  return {
    accessToken: args.accessToken,
    calendarId: args.calendarId,
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
