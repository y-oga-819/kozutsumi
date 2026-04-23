import type { SupabaseClient } from "@supabase/supabase-js";

import {
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

import type {
  EventGateway,
  UpsertGoogleCalendarEventInput,
} from "./gateway";
import { SupabaseEventGateway } from "./supabase-gateway";

/**
 * Google Calendar → events テーブル 同期本体 (ADR 0005 / 0006 / 0008 / 0010)。
 *
 * - 対象は primary カレンダーのみ (ADR 0008)
 * - 過去 7 日 〜 未来 30 日 を full sync
 * - 2 回目以降も idempotent: `(source, external_id)` の unique 制約に upsert
 * - Google 側で cancelled になったものはローカルからも削除
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
  listEvents: (
    params: ListEventsParams,
  ) => Promise<GoogleCalendarEventsListResponse>;
  getValidAccessToken: (
    supabase: SupabaseClient<Database>,
  ) => Promise<GoogleProviderAccess>;
  refreshAccessToken: (
    supabase: SupabaseClient<Database>,
  ) => Promise<GoogleProviderAccess>;
  now: () => Date;
};

export async function syncGoogleCalendar(
  supabase: SupabaseClient<Database>,
  overrides: Partial<SyncGoogleCalendarDeps> = {},
): Promise<SyncResult> {
  const deps: SyncGoogleCalendarDeps = {
    gateway: overrides.gateway ?? new SupabaseEventGateway(supabase),
    listEvents: overrides.listEvents ?? defaultListEvents,
    getValidAccessToken:
      overrides.getValidAccessToken ?? defaultGetValidAccessToken,
    refreshAccessToken:
      overrides.refreshAccessToken ?? defaultRefreshAccessToken,
    now: overrides.now ?? (() => new Date()),
  };

  const nowDate = deps.now();
  const timeMin = new Date(
    nowDate.getTime() - SYNC_WINDOW_PAST_DAYS * MS_PER_DAY,
  ).toISOString();
  const timeMax = new Date(
    nowDate.getTime() + SYNC_WINDOW_FUTURE_DAYS * MS_PER_DAY,
  ).toISOString();

  const initial = await deps.getValidAccessToken(supabase);
  let accessToken = initial.accessToken;
  let hasRetriedAuth = false;

  const collected: GoogleCalendarEvent[] = [];
  let pageToken: string | undefined;

  while (true) {
    let page: GoogleCalendarEventsListResponse;
    try {
      page = await deps.listEvents({
        accessToken,
        calendarId: PRIMARY_CALENDAR_ID,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: "startTime",
        pageToken,
      });
    } catch (err) {
      if (err instanceof GoogleApiUnauthorizedError && !hasRetriedAuth) {
        hasRetriedAuth = true;
        const refreshed = await deps.refreshAccessToken(supabase);
        accessToken = refreshed.accessToken;
        continue;
      }
      throw err;
    }

    collected.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
    if (!pageToken) break;
  }

  const { upserts, cancelled } = partitionEvents(collected);

  let synced = 0;
  if (upserts.length > 0) {
    synced = await deps.gateway.upsertFromGoogleCalendar(upserts);
  }
  let deleted = 0;
  if (cancelled.length > 0) {
    deleted = await deps.gateway.deleteByGoogleExternalIds(cancelled);
  }

  return {
    synced,
    deleted,
    lastSyncedAt: nowDate.toISOString(),
  };
}

export function partitionEvents(events: GoogleCalendarEvent[]): {
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
    const mapped = mapGoogleEventToUpsertInput(ev);
    if (mapped) upserts.push(mapped);
  }
  return { upserts, cancelled };
}

export function mapGoogleEventToUpsertInput(
  event: GoogleCalendarEvent,
): UpsertGoogleCalendarEventInput | null {
  const times = resolveEventTimes(event);
  if (!times) return null;

  return {
    externalId: event.id,
    title: event.summary ?? DEFAULT_TITLE,
    startTime: times.start,
    endTime: times.end,
    meetUrl: extractMeetUrl(event),
    hasAttachments:
      Array.isArray(event.attachments) && event.attachments.length > 0,
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
