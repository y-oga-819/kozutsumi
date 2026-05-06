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
  type GoogleCalendarListResponse,
  type ListEventsParams,
  listCalendars as defaultListCalendars,
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
 * Google Calendar → events テーブル 同期本体 (ADR 0005 / 0006 / 0010 / 0031 / 0033 / 0034 / 0049)。
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
 * subscription が 1 件もない user (新規 OAuth ユーザー) は、Google `calendarList.list` を叩いて
 * `primary: true` な calendar の **実 id** (= ユーザーのメールアドレス) を解決し、その id で
 * subscription を 1 行 seed する (ADR 0049)。リテラル `'primary'` を保存しない。
 */

const SYNC_WINDOW_PAST_DAYS = 7;
const SYNC_WINDOW_FUTURE_DAYS = 30;
// 終日イベントを kozutsumi 時刻に落とし込む際のタイムゾーン (JST 固定)。
// マルチタイムゾーン対応は将来スコープ。
const ALL_DAY_TZ_OFFSET_MIN = 9 * 60;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_TITLE = "(タイトルなし)";

/**
 * 取り込みをスキップした 1 件分の情報。Issue #219 の events_time_order 違反、または時刻情報欠損などで
 * mapper が `null` を返したものをまとめて UI に伝える (バナー / トーストの「N 件スキップ」表示)。
 */
export type SkippedEvent = {
  externalCalendarId: string;
  externalId: string;
  /** Google から取れたタイトル。`undefined` の場合は UI 側で「(タイトルなし)」にフォールバックする。 */
  title: string | undefined;
  reason: "invalid_time_range" | "missing_time";
};

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
  /** 取り込みをスキップした event 一覧。空配列なら全件取り込み済み。 */
  skipped: SkippedEvent[];
};

export type SyncResult = {
  synced: number;
  deleted: number;
  lastSyncedAt: string;
  /** 同期した calendar 単位の outcome 配列。1 calendar = 1 entry。 */
  outcomes: CalendarSyncOutcome[];
  /** 全 calendar 集約後のスキップ予定。UI が件数 / 詳細を表示する材料。 */
  skipped: SkippedEvent[];
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
  /**
   * Google `calendarList.list` の薄ラッパー。新規 OAuth ユーザーの primary calendar 実 id 解決に使う
   * (ADR 0049)。test では mock を注入する。
   */
  listCalendars: (params: {
    accessToken: string;
    pageToken?: string;
    minAccessRole?: "freeBusyReader" | "reader" | "writer" | "owner";
  }) => Promise<GoogleCalendarListResponse>;
  getValidAccessToken: (supabase: SupabaseClient<Database>) => Promise<GoogleProviderAccess>;
  refreshAccessToken: (supabase: SupabaseClient<Database>) => Promise<GoogleProviderAccess>;
  /**
   * 認証済 user の sync 対象 subscription を解決する。本 hook が空配列を返した場合、syncGoogleCalendar 本体が
   * Google API で primary calendar の実 id を解決して subscription を 1 行 seed する (ADR 0049)。
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
    listCalendars: overrides.listCalendars ?? defaultListCalendars,
    getValidAccessToken: overrides.getValidAccessToken ?? defaultGetValidAccessToken,
    refreshAccessToken: overrides.refreshAccessToken ?? defaultRefreshAccessToken,
    resolveSubscriptionTargets:
      overrides.resolveSubscriptionTargets ?? defaultResolveSubscriptionTargets,
    findTasksDependingOnEvents:
      overrides.findTasksDependingOnEvents ?? defaultFindTasksDependingOnEvents,
    now: overrides.now ?? (() => new Date()),
  };

  // 1 sync 全体で provider token は共有 (ADR 0009 / refresh は最大 1 回 / sync まとめて)。
  // 401 retry は calendar 単位のループで完結させる (各 calendar が独立して最大 1 回 refresh する余地を持つ)。
  const initial = await deps.getValidAccessToken(supabase);

  let targets = await deps.resolveSubscriptionTargets(supabase);
  if (targets.length === 0) {
    // ADR 0049: 新規 OAuth ユーザー / subscription 未保有ユーザーには primary calendar の
    // 実 id (= メールアドレス) で subscription を 1 行 seed する。リテラル 'primary' は保存しない。
    targets = await seedPrimarySubscriptionFromApi(supabase, initial.accessToken, deps);
  }

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
      skipped: result.skipped,
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
    skipped: outcomes.flatMap((o) => o.skipped),
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

  const { upserts, cancelled, skipped } = partitionEvents(collected, target.externalCalendarId);

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
    skipped,
    nextSyncToken,
  };
}

/**
 * 認証済 user の既存 subscription 一覧 (google_calendar) を読み取って返す。
 *
 * subscription が 1 件もない (新規 OAuth ユーザー / 全部 unsubscribe したユーザー) は空配列を返す。
 * 呼び出し側 (`syncGoogleCalendar`) が必要に応じて Google API resolve 経由の lazy seed を行う (ADR 0049)。
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

  return (subscriptions ?? []).map((row) => ({
    externalAccountUuid: row.external_account_id,
    externalAccountIdentifier:
      (row.external_accounts as unknown as { external_account_id: string } | null)
        ?.external_account_id ?? "",
    externalCalendarId: row.external_calendar_id,
  }));
}

/**
 * subscription が 1 件もない user の primary calendar を Google API resolve して seed する (ADR 0049)。
 *
 * - Google `calendarList.list` を叩いて `primary: true` な entry の `id` (= メールアドレス) を取得
 * - `external_accounts` を upsert (既存なら再利用)
 * - `user_calendar_subscriptions` を実 id で upsert (UNIQUE 違反は no-op)
 *
 * 401 を受けたら `refreshAccessToken` で 1 回だけ retry する (ADR 0009 と同じ流儀)。
 */
async function seedPrimarySubscriptionFromApi(
  supabase: SupabaseClient<Database>,
  initialAccessToken: string,
  deps: SyncGoogleCalendarDeps,
): Promise<SubscriptionTarget[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("not authenticated");

  const primaryCalendarId = await resolvePrimaryCalendarId(supabase, initialAccessToken, deps);

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

  await supabase.from("user_calendar_subscriptions").upsert(
    {
      user_id: user.id,
      external_account_id: accountUuid,
      source: EVENT_SOURCE.GOOGLE_CALENDAR,
      external_calendar_id: primaryCalendarId,
      auto_promote_to_timeline: true,
      display_name: "(primary)",
    },
    { onConflict: "user_id,external_account_id,external_calendar_id" },
  );

  return [
    {
      externalAccountUuid: accountUuid,
      externalAccountIdentifier: accountIdentifier,
      externalCalendarId: primaryCalendarId,
    },
  ];
}

async function resolvePrimaryCalendarId(
  supabase: SupabaseClient<Database>,
  initialAccessToken: string,
  deps: SyncGoogleCalendarDeps,
): Promise<string> {
  let accessToken = initialAccessToken;
  let hasRetriedAuth = false;
  let pageToken: string | undefined;

  while (true) {
    let page: GoogleCalendarListResponse;
    try {
      page = await deps.listCalendars({ accessToken, pageToken, minAccessRole: "reader" });
    } catch (err) {
      if (err instanceof GoogleApiUnauthorizedError && !hasRetriedAuth) {
        hasRetriedAuth = true;
        const refreshed = await deps.refreshAccessToken(supabase);
        accessToken = refreshed.accessToken;
        continue;
      }
      throw err;
    }
    const primary = (page.items ?? []).find((c) => c.primary);
    if (primary) return primary.id;
    pageToken = page.nextPageToken;
    if (!pageToken) {
      throw new Error("primary calendar not found in Google calendarList");
    }
  }
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
  skipped: SkippedEvent[];
} {
  const upserts: UpsertGoogleCalendarEventInput[] = [];
  const cancelled: string[] = [];
  const skipped: SkippedEvent[] = [];
  for (const ev of events) {
    if (ev.status === "cancelled") {
      cancelled.push(ev.id);
      continue;
    }
    const mapped = mapGoogleEventToUpsertInput(ev, externalCalendarId);
    if (mapped) {
      upserts.push(mapped);
      continue;
    }
    skipped.push({
      externalCalendarId,
      externalId: ev.id,
      title: ev.summary,
      reason: classifySkipReason(ev),
    });
  }
  return { upserts, cancelled, skipped };
}

/**
 * `mapGoogleEventToUpsertInput` が `null` を返した event の理由を分類する。
 * - 時刻情報が片側欠損 / 両側欠損 → `missing_time`
 * - 時刻はあるが end < start (逆順) → `invalid_time_range` (events_time_order 違反 / Issue #219)
 *
 * ゼロ長 (`end === start`) は ADR-0050 / Issue #222 により締切系として取り込むので
 * skip 対象から外している。
 */
function classifySkipReason(event: GoogleCalendarEvent): SkippedEvent["reason"] {
  const hasDateTimePair = Boolean(event.start?.dateTime && event.end?.dateTime);
  const hasDatePair = Boolean(event.start?.date && event.end?.date);
  if (!hasDateTimePair && !hasDatePair) return "missing_time";
  return "invalid_time_range";
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
  let times: { start: string; end: string } | null = null;
  if (event.start?.dateTime && event.end?.dateTime) {
    times = {
      start: new Date(event.start.dateTime).toISOString(),
      end: new Date(event.end.dateTime).toISOString(),
    };
  } else if (event.start?.date && event.end?.date) {
    times = {
      start: allDayDateToJstUtc(event.start.date),
      end: allDayDateToJstUtc(event.end.date),
    };
  }
  if (!times) return null;
  // events_time_order check (end_time >= start_time) を満たさない event は丸ごとスキップする。
  // 1 件でも違反があると Supabase の batch upsert が calendar 単位で全件ロールバックされ、
  // その calendar の取り込みが完全に失われるため (Issue #219)。
  // ゼロ長 (end === start) は ADR-0050 / Issue #222 により締切系として取り込む。
  if (Date.parse(times.end) < Date.parse(times.start)) return null;
  return times;
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
