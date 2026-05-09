import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, test, vi } from "vitest";

import type { CalendarSyncStateGateway } from "@/entities/calendar-sync/gateway";
import {
  GoogleApiError,
  GoogleApiUnauthorizedError,
  type GoogleCalendarEvent,
  type GoogleCalendarEventsListResponse,
  type ListEventsParams,
} from "@/shared/google/calendar";
import { RefreshTokenExpiredError } from "@/shared/google/token";
import type { Database } from "@/shared/types/database";

import type { DeletedEventSnapshot, EventGateway, UpsertGoogleCalendarEventInput } from "./gateway";
import {
  extractMeetUrl,
  mapGoogleEventToUpsertInput,
  partitionEvents,
  resolveEventTimes,
  syncGoogleCalendar,
} from "./sync";

// =====================================================================
// 純粋関数のテスト
// =====================================================================

describe("resolveEventTimes", () => {
  test("dateTime が両端にあれば ISO 文字列に正規化する", () => {
    const result = resolveEventTimes({
      id: "e1",
      start: { dateTime: "2026-04-23T10:00:00+09:00" },
      end: { dateTime: "2026-04-23T11:00:00+09:00" },
    });

    expect(result).toEqual({
      start: "2026-04-23T01:00:00.000Z",
      end: "2026-04-23T02:00:00.000Z",
    });
  });

  test("終日イベントは JST の 00:00 として UTC に変換する", () => {
    const result = resolveEventTimes({
      id: "e2",
      start: { date: "2026-04-23" },
      end: { date: "2026-04-24" },
    });

    // 2026-04-23 JST 00:00 = 2026-04-22 15:00 UTC、exclusive end は 2026-04-24 JST 00:00
    expect(result).toEqual({
      start: "2026-04-22T15:00:00.000Z",
      end: "2026-04-23T15:00:00.000Z",
    });
  });

  test("start/end が欠けている不正イベントは null を返す", () => {
    expect(resolveEventTimes({ id: "e3", start: {}, end: {} })).toBeNull();
  });

  test("end === start のゼロ長イベントは取り込む (ADR-0050 / Issue #222 締切系)", () => {
    expect(
      resolveEventTimes({
        id: "zero-length",
        start: { dateTime: "2026-04-23T10:00:00+09:00" },
        end: { dateTime: "2026-04-23T10:00:00+09:00" },
      }),
    ).toEqual({
      start: "2026-04-23T01:00:00.000Z",
      end: "2026-04-23T01:00:00.000Z",
    });
  });

  test("end < start の逆順イベントは null を返す (events_time_order 違反回避 / Issue #219)", () => {
    expect(
      resolveEventTimes({
        id: "reversed",
        start: { dateTime: "2026-04-23T11:00:00+09:00" },
        end: { dateTime: "2026-04-23T10:00:00+09:00" },
      }),
    ).toBeNull();
  });

  test("終日イベントで start.date === end.date のゼロ日終日も取り込む (ADR-0050)", () => {
    expect(
      resolveEventTimes({
        id: "all-day-zero",
        start: { date: "2026-04-23" },
        end: { date: "2026-04-23" },
      }),
    ).toEqual({
      start: "2026-04-22T15:00:00.000Z",
      end: "2026-04-22T15:00:00.000Z",
    });
  });
});

describe("extractMeetUrl", () => {
  test("hangoutLink があればそれを使う", () => {
    expect(
      extractMeetUrl({
        id: "e1",
        hangoutLink: "https://meet.google.com/abc-defg-hij",
        conferenceData: {
          entryPoints: [{ entryPointType: "video", uri: "https://other.example/video" }],
        },
      }),
    ).toBe("https://meet.google.com/abc-defg-hij");
  });

  test("hangoutLink が無ければ conferenceData の video entryPoint を使う", () => {
    expect(
      extractMeetUrl({
        id: "e1",
        conferenceData: {
          entryPoints: [
            { entryPointType: "phone", uri: "tel:+81-3-1234-5678" },
            { entryPointType: "video", uri: "https://zoom.example/j/123" },
          ],
        },
      }),
    ).toBe("https://zoom.example/j/123");
  });

  test("候補がなければ null を返す", () => {
    expect(extractMeetUrl({ id: "e1" })).toBeNull();
  });
});

describe("mapGoogleEventToUpsertInput", () => {
  test("必要フィールドをすべてマップする", () => {
    const result = mapGoogleEventToUpsertInput(
      {
        id: "evt-1",
        summary: "1on1",
        description: "議題: 進捗",
        start: { dateTime: "2026-04-23T10:00:00+09:00" },
        end: { dateTime: "2026-04-23T11:00:00+09:00" },
        hangoutLink: "https://meet.google.com/xyz",
        attachments: [{ fileUrl: "https://drive.example/abc" }],
      },
      "primary",
    );

    expect(result).toEqual<UpsertGoogleCalendarEventInput>({
      externalCalendarId: "primary",
      externalId: "evt-1",
      title: "1on1",
      startTime: "2026-04-23T01:00:00.000Z",
      endTime: "2026-04-23T02:00:00.000Z",
      meetUrl: "https://meet.google.com/xyz",
      hasAttachments: true,
      description: "議題: 進捗",
      recurringEventId: null,
    });
  });

  test("summary が無い場合はデフォルトタイトル、description / meet_url が無ければ空 / null", () => {
    const result = mapGoogleEventToUpsertInput(
      {
        id: "evt-2",
        start: { dateTime: "2026-04-23T10:00:00Z" },
        end: { dateTime: "2026-04-23T11:00:00Z" },
      },
      "primary",
    );

    expect(result).toEqual<UpsertGoogleCalendarEventInput>({
      externalCalendarId: "primary",
      externalId: "evt-2",
      title: "(タイトルなし)",
      startTime: "2026-04-23T10:00:00.000Z",
      endTime: "2026-04-23T11:00:00.000Z",
      meetUrl: null,
      hasAttachments: false,
      description: "",
      recurringEventId: null,
    });
  });

  test("recurring instance: recurringEventId を保持する (ADR 0056)", () => {
    const result = mapGoogleEventToUpsertInput(
      {
        id: "evt-instance-3",
        recurringEventId: "evt-master-1",
        summary: "毎週 1on1",
        start: { dateTime: "2026-04-23T10:00:00+09:00" },
        end: { dateTime: "2026-04-23T11:00:00+09:00" },
      },
      "primary",
    );

    expect(result).toEqual<UpsertGoogleCalendarEventInput>({
      externalCalendarId: "primary",
      externalId: "evt-instance-3",
      title: "毎週 1on1",
      startTime: "2026-04-23T01:00:00.000Z",
      endTime: "2026-04-23T02:00:00.000Z",
      meetUrl: null,
      hasAttachments: false,
      description: "",
      recurringEventId: "evt-master-1",
    });
  });

  test("時刻が無い壊れたイベントは null を返す", () => {
    expect(mapGoogleEventToUpsertInput({ id: "bad", start: {}, end: {} }, "primary")).toBeNull();
  });
});

describe("partitionEvents", () => {
  test("cancelled は external_id 配列、それ以外は upsert 入力にまとめる", () => {
    const events: GoogleCalendarEvent[] = [
      {
        id: "active-1",
        summary: "meeting",
        start: { dateTime: "2026-04-23T10:00:00Z" },
        end: { dateTime: "2026-04-23T11:00:00Z" },
      },
      { id: "deleted-1", status: "cancelled" },
      {
        id: "active-2",
        summary: "lunch",
        start: { dateTime: "2026-04-23T12:00:00Z" },
        end: { dateTime: "2026-04-23T13:00:00Z" },
      },
      { id: "deleted-2", status: "cancelled" },
      // 壊れたイベントは skipped に分類する
      { id: "broken", start: {}, end: {} },
    ];

    const result = partitionEvents(events, "primary");

    expect(result.cancelled).toEqual(["deleted-1", "deleted-2"]);
    expect(result.upserts.map((u) => u.externalId)).toEqual(["active-1", "active-2"]);
    expect(result.skipped).toEqual([
      {
        externalCalendarId: "primary",
        externalId: "broken",
        title: undefined,
        reason: "missing_time",
      },
    ]);
  });

  test("ゼロ長は upsert に乗り、逆順だけ skipped に invalid_time_range として残る (ADR-0050)", () => {
    const events: GoogleCalendarEvent[] = [
      {
        id: "ok",
        summary: "通常",
        start: { dateTime: "2026-04-23T10:00:00Z" },
        end: { dateTime: "2026-04-23T11:00:00Z" },
      },
      {
        id: "zero",
        summary: "ゼロ長",
        start: { dateTime: "2026-04-23T12:00:00Z" },
        end: { dateTime: "2026-04-23T12:00:00Z" },
      },
      {
        id: "reversed",
        summary: "逆順",
        start: { dateTime: "2026-04-23T13:00:00Z" },
        end: { dateTime: "2026-04-23T12:30:00Z" },
      },
    ];

    const result = partitionEvents(events, "shared");

    expect(result.upserts.map((u) => u.externalId)).toEqual(["ok", "zero"]);
    expect(result.skipped).toEqual([
      {
        externalCalendarId: "shared",
        externalId: "reversed",
        title: "逆順",
        reason: "invalid_time_range",
      },
    ]);
  });
});

// =====================================================================
// syncGoogleCalendar orchestration
// =====================================================================

type ListEventsFn = (params: ListEventsParams) => Promise<GoogleCalendarEventsListResponse>;

function makeFakeGateway(opts: { snapshots?: DeletedEventSnapshot[] } = {}) {
  const upsertCalls: UpsertGoogleCalendarEventInput[][] = [];
  const deleteCalls: { externalCalendarId: string; ids: string[] }[] = [];
  const gateway: EventGateway = {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteAllForCurrentUser: vi.fn(),
    setVisibilityOverride: vi.fn(),
    upsertFromGoogleCalendar: vi.fn(async (inputs) => {
      upsertCalls.push(inputs);
      return inputs.length;
    }),
    deleteByGoogleExternalIds: vi.fn(async (externalCalendarId, ids) => {
      deleteCalls.push({ externalCalendarId, ids });
      return ids.length;
    }),
    findGoogleEventSnapshots: vi.fn(
      async (externalCalendarId, externalIds): Promise<DeletedEventSnapshot[]> => {
        const provided = opts.snapshots ?? [];
        // 引数 calendarId / externalIds に一致するものだけ返す (テストの意図とずれを早期に弾く)
        return provided.filter(
          (s) => externalIds.includes(s.externalId) && externalCalendarId.length > 0,
        );
      },
    ),
    findAllGoogleEventsByCalendar: vi.fn(async () => opts.snapshots ?? []),
    deleteAllGoogleEventsByCalendar: vi.fn(async () => (opts.snapshots ?? []).length),
  };
  return { gateway, upsertCalls, deleteCalls };
}

function makeFakeSyncStateGateway(
  initial: {
    lastSyncedAt: string;
    syncToken: string | null;
  } | null = null,
) {
  const get = vi.fn(async () => initial);
  const saveSyncState = vi.fn(async () => {});
  const gateway: CalendarSyncStateGateway = {
    get: get as unknown as CalendarSyncStateGateway["get"],
    saveSyncState: saveSyncState as unknown as CalendarSyncStateGateway["saveSyncState"],
  };
  return { gateway, get, saveSyncState };
}

function makeActiveEvent(id: string): GoogleCalendarEvent {
  return {
    id,
    summary: `event-${id}`,
    start: { dateTime: "2026-04-23T10:00:00Z" },
    end: { dateTime: "2026-04-23T11:00:00Z" },
  };
}

const FAKE_SUPABASE = {} as SupabaseClient<Database>;
const DEFAULT_NOW = () => new Date("2026-04-23T00:00:00.000Z");

/** テスト共通の DI overrides。`listEvents` / `refreshAccessToken` はテスト側で差し替える */
function makeDeps(overrides: {
  gateway: EventGateway;
  syncStateGateway?: CalendarSyncStateGateway;
  listEvents: ListEventsFn;
  refreshAccessToken?: () => Promise<{
    accessToken: string;
    refreshToken: string;
  }>;
  now?: () => Date;
  accessToken?: string;
  /** sync 対象 calendar list (default: primary 1 件)。複数 calendar テスト用に上書き可 */
  targets?: Array<{
    externalAccountUuid: string;
    externalAccountIdentifier: string;
    externalCalendarId: string;
  }>;
  /** events.id 配列 → tasks の依存解析。default は空 */
  findTasksDependingOnEvents?: (eventIds: string[]) => Promise<
    Array<{
      taskId: string;
      eventId: string;
    }>
  >;
}) {
  return {
    gateway: overrides.gateway,
    syncStateGateway: overrides.syncStateGateway ?? makeFakeSyncStateGateway().gateway,
    listEvents: overrides.listEvents,
    getValidAccessToken: vi.fn(async () => ({
      accessToken: overrides.accessToken ?? "t",
      refreshToken: "r",
    })),
    refreshAccessToken: overrides.refreshAccessToken
      ? vi.fn(overrides.refreshAccessToken)
      : vi.fn(),
    resolveSubscriptionTargets: vi.fn(
      async () =>
        overrides.targets ?? [
          {
            externalAccountUuid: "ext-acc-id",
            externalAccountIdentifier: "user@example.com",
            externalCalendarId: "primary",
          },
        ],
    ),
    findTasksDependingOnEvents: vi.fn(
      async (_supabase: SupabaseClient<Database>, eventIds: string[]) => {
        if (overrides.findTasksDependingOnEvents) {
          return overrides.findTasksDependingOnEvents(eventIds);
        }
        return [];
      },
    ),
    now: overrides.now ?? DEFAULT_NOW,
  };
}

describe("syncGoogleCalendar (full sync)", () => {
  test("syncToken 未保存なら primary の timeMin/timeMax を now±window で計算し full sync する", async () => {
    const { gateway, upsertCalls, deleteCalls } = makeFakeGateway();
    const listEvents = vi.fn<ListEventsFn>(async () => ({
      items: [makeActiveEvent("a"), makeActiveEvent("b")],
      nextSyncToken: "tok-after-full",
    }));

    const result = await syncGoogleCalendar(
      FAKE_SUPABASE,
      makeDeps({
        gateway,
        listEvents,
        accessToken: "fresh",
        now: () => new Date("2026-04-23T12:00:00.000Z"),
      }),
    );

    expect(result).toMatchObject({
      synced: 2,
      deleted: 0,
      lastSyncedAt: "2026-04-23T12:00:00.000Z",
    });
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]).toMatchObject({
      source: "google_calendar",
      externalCalendarId: "primary",
      synced: 2,
      deleted: 0,
      deletions: [],
    });
    expect(listEvents).toHaveBeenCalledTimes(1);
    const call = listEvents.mock.calls[0]![0];
    expect(call).toMatchObject({
      accessToken: "fresh",
      calendarId: "primary",
      singleEvents: true,
      orderBy: "startTime",
      timeMin: "2026-04-16T12:00:00.000Z", // now - 7d
      timeMax: "2026-05-23T12:00:00.000Z", // now + 30d
    });
    expect(call.syncToken).toBeUndefined();
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]!.map((e) => e.externalId)).toEqual(["a", "b"]);
    expect(deleteCalls).toHaveLength(0);
  });

  test("ページングで nextPageToken を繰り返し、全件を集約する", async () => {
    const { gateway, upsertCalls } = makeFakeGateway();
    const listEvents = vi.fn<ListEventsFn>();
    listEvents
      .mockResolvedValueOnce({
        items: [makeActiveEvent("p1-a"), makeActiveEvent("p1-b")],
        nextPageToken: "tok-2",
      })
      .mockResolvedValueOnce({
        items: [makeActiveEvent("p2-a")],
        nextPageToken: "tok-3",
      })
      .mockResolvedValueOnce({
        items: [makeActiveEvent("p3-a")],
        nextSyncToken: "final-sync",
      });

    const result = await syncGoogleCalendar(FAKE_SUPABASE, makeDeps({ gateway, listEvents }));

    expect(result.synced).toBe(4);
    expect(listEvents).toHaveBeenCalledTimes(3);
    expect(listEvents.mock.calls[1]![0].pageToken).toBe("tok-2");
    expect(listEvents.mock.calls[2]![0].pageToken).toBe("tok-3");
    expect(upsertCalls[0]!.map((e) => e.externalId)).toEqual(["p1-a", "p1-b", "p2-a", "p3-a"]);
  });

  test("cancelled イベントは delete 側に集約される", async () => {
    const { gateway, upsertCalls, deleteCalls } = makeFakeGateway();
    const listEvents = vi.fn<ListEventsFn>(async () => ({
      items: [
        makeActiveEvent("keep"),
        { id: "gone-1", status: "cancelled" },
        { id: "gone-2", status: "cancelled" },
      ],
    }));

    const result = await syncGoogleCalendar(FAKE_SUPABASE, makeDeps({ gateway, listEvents }));

    expect(result.synced).toBe(1);
    expect(result.deleted).toBe(2);
    expect(upsertCalls[0]!.map((e) => e.externalId)).toEqual(["keep"]);
    expect(deleteCalls[0]).toEqual({
      externalCalendarId: "primary",
      ids: ["gone-1", "gone-2"],
    });
  });

  test("削除対象 event の snapshot と依存 task が outcomes.deletions に紐づく (#144)", async () => {
    const snapshots: DeletedEventSnapshot[] = [
      {
        id: "uuid-gone-1",
        externalId: "gone-1",
        title: "removed mtg",
        startTime: "2026-05-04T00:00:00.000Z",
        endTime: "2026-05-04T01:00:00.000Z",
        visibilityOverride: "shown",
      },
    ];
    const { gateway } = makeFakeGateway({ snapshots });
    const listEvents = vi.fn<ListEventsFn>(async () => ({
      items: [{ id: "gone-1", status: "cancelled" }],
    }));

    const result = await syncGoogleCalendar(
      FAKE_SUPABASE,
      makeDeps({
        gateway,
        listEvents,
        findTasksDependingOnEvents: async (eventIds) => {
          if (!eventIds.includes("uuid-gone-1")) return [];
          return [{ taskId: "task-A", eventId: "uuid-gone-1" }];
        },
      }),
    );

    expect(result.outcomes).toHaveLength(1);
    const out = result.outcomes[0]!;
    expect(out.deletions).toHaveLength(1);
    expect(out.deletions[0]!.eventSnapshot.externalId).toBe("gone-1");
    expect(out.deletions[0]!.eventSnapshot.visibilityOverride).toBe("shown");
    expect(out.deletions[0]!.dependentTaskIds).toEqual(["task-A"]);
  });

  test("複数 calendar が targets にあるとそれぞれ sync + outcomes が並ぶ", async () => {
    const { gateway } = makeFakeGateway();
    const listEvents = vi.fn<ListEventsFn>(async (params) => ({
      items: [makeActiveEvent(`evt-${params.calendarId}`)],
      nextSyncToken: `tok-${params.calendarId}`,
    }));

    const result = await syncGoogleCalendar(
      FAKE_SUPABASE,
      makeDeps({
        gateway,
        listEvents,
        targets: [
          {
            externalAccountUuid: "acc-uuid",
            externalAccountIdentifier: "user@example.com",
            externalCalendarId: "primary",
          },
          {
            externalAccountUuid: "acc-uuid",
            externalAccountIdentifier: "user@example.com",
            externalCalendarId: "team@x.com",
          },
        ],
      }),
    );

    expect(result.outcomes.map((o) => o.externalCalendarId)).toEqual(["primary", "team@x.com"]);
    expect(listEvents).toHaveBeenCalledTimes(2);
  });

  test("逆順の予定は upsert からスキップされ SyncResult.skipped に集約される (Issue #219 / ADR-0050)", async () => {
    const { gateway, upsertCalls } = makeFakeGateway();
    const listEvents = vi.fn<ListEventsFn>(async (params) => {
      if (params.calendarId === "primary") {
        return {
          items: [makeActiveEvent("ok-1")],
          nextSyncToken: "tok-primary",
        };
      }
      return {
        items: [
          makeActiveEvent("shared-ok"),
          {
            id: "shared-reversed",
            summary: "逆順",
            start: { dateTime: "2026-04-23T13:00:00Z" },
            end: { dateTime: "2026-04-23T12:30:00Z" },
          },
        ],
        nextSyncToken: "tok-shared",
      };
    });

    const result = await syncGoogleCalendar(
      FAKE_SUPABASE,
      makeDeps({
        gateway,
        listEvents,
        targets: [
          {
            externalAccountUuid: "acc-uuid",
            externalAccountIdentifier: "user@example.com",
            externalCalendarId: "primary",
          },
          {
            externalAccountUuid: "acc-uuid",
            externalAccountIdentifier: "user@example.com",
            externalCalendarId: "shared@group.calendar.google.com",
          },
        ],
      }),
    );

    expect(result.synced).toBe(2);
    expect(upsertCalls.flatMap((c) => c.map((e) => e.externalId))).toEqual(["ok-1", "shared-ok"]);
    expect(result.skipped).toEqual([
      {
        externalCalendarId: "shared@group.calendar.google.com",
        externalId: "shared-reversed",
        title: "逆順",
        reason: "invalid_time_range",
      },
    ]);
    expect(result.outcomes.find((o) => o.externalCalendarId === "primary")?.skipped).toEqual([]);
  });

  test("空結果の時は upsert/delete を呼ばない", async () => {
    const { gateway, upsertCalls, deleteCalls } = makeFakeGateway();
    const listEvents = vi.fn<ListEventsFn>(async () => ({ items: [] }));

    const result = await syncGoogleCalendar(FAKE_SUPABASE, makeDeps({ gateway, listEvents }));

    expect(result).toMatchObject({ synced: 0, deleted: 0 });
    expect(upsertCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
  });

  test("401 を受けたら refresh して 1 回だけ retry する", async () => {
    const { gateway } = makeFakeGateway();
    const listEvents = vi.fn<ListEventsFn>();
    listEvents
      .mockRejectedValueOnce(new GoogleApiUnauthorizedError())
      .mockResolvedValueOnce({ items: [makeActiveEvent("after-refresh")] });
    const refreshAccessToken = async () => ({
      accessToken: "new-token",
      refreshToken: "r",
    });

    const result = await syncGoogleCalendar(
      FAKE_SUPABASE,
      makeDeps({
        gateway,
        listEvents,
        accessToken: "stale",
        refreshAccessToken,
      }),
    );

    expect(result.synced).toBe(1);
    expect(listEvents).toHaveBeenCalledTimes(2);
    expect(listEvents.mock.calls[0]![0].accessToken).toBe("stale");
    expect(listEvents.mock.calls[1]![0].accessToken).toBe("new-token");
  });

  test("401 retry 後も 401 なら throw する (無限ループしない)", async () => {
    const { gateway } = makeFakeGateway();
    const listEvents = vi.fn<ListEventsFn>(async () => {
      throw new GoogleApiUnauthorizedError();
    });
    const refreshAccessToken = async () => ({
      accessToken: "new-token",
      refreshToken: "r",
    });

    await expect(
      syncGoogleCalendar(
        FAKE_SUPABASE,
        makeDeps({
          gateway,
          listEvents,
          accessToken: "stale",
          refreshAccessToken,
        }),
      ),
    ).rejects.toBeInstanceOf(GoogleApiUnauthorizedError);

    expect(listEvents).toHaveBeenCalledTimes(2);
  });

  test("refresh が RefreshTokenExpiredError を投げたら伝播する", async () => {
    const { gateway } = makeFakeGateway();
    const listEvents = vi.fn<ListEventsFn>(async () => {
      throw new GoogleApiUnauthorizedError();
    });
    const refreshAccessToken = async () => {
      throw new RefreshTokenExpiredError("expired");
    };

    await expect(
      syncGoogleCalendar(
        FAKE_SUPABASE,
        makeDeps({
          gateway,
          listEvents,
          accessToken: "stale",
          refreshAccessToken,
        }),
      ),
    ).rejects.toBeInstanceOf(RefreshTokenExpiredError);
  });

  test("成功時は last_synced_at + nextSyncToken を atomic に永続化する", async () => {
    const { gateway } = makeFakeGateway();
    const { gateway: syncStateGateway, saveSyncState } = makeFakeSyncStateGateway();
    const listEvents = vi.fn<ListEventsFn>(async () => ({
      items: [makeActiveEvent("a")],
      nextSyncToken: "fresh-tok",
    }));

    const result = await syncGoogleCalendar(
      FAKE_SUPABASE,
      makeDeps({
        gateway,
        syncStateGateway,
        listEvents,
        now: () => new Date("2026-04-24T01:30:00.000Z"),
      }),
    );

    expect(result.lastSyncedAt).toBe("2026-04-24T01:30:00.000Z");
    expect(saveSyncState).toHaveBeenCalledTimes(1);
    expect(saveSyncState).toHaveBeenCalledWith(
      {
        source: "google_calendar",
        externalAccountId: "ext-acc-id",
        externalCalendarId: "primary",
      },
      { lastSyncedAt: "2026-04-24T01:30:00.000Z", syncToken: "fresh-tok" },
    );
  });

  test("nextSyncToken が無いレスポンスは syncToken: null で保存する", async () => {
    const { gateway } = makeFakeGateway();
    const { gateway: syncStateGateway, saveSyncState } = makeFakeSyncStateGateway();
    const listEvents = vi.fn<ListEventsFn>(async () => ({ items: [] }));

    await syncGoogleCalendar(FAKE_SUPABASE, makeDeps({ gateway, syncStateGateway, listEvents }));

    expect(saveSyncState).toHaveBeenCalledWith(
      {
        source: "google_calendar",
        externalAccountId: "ext-acc-id",
        externalCalendarId: "primary",
      },
      { lastSyncedAt: expect.any(String), syncToken: null },
    );
  });

  test("401 retry 後も失敗する場合は sync state を上書きしない (stale syncToken を保持)", async () => {
    const { gateway } = makeFakeGateway();
    const { gateway: syncStateGateway, saveSyncState } = makeFakeSyncStateGateway({
      lastSyncedAt: "2026-04-23T00:00:00.000Z",
      syncToken: "previous",
    });
    const listEvents = vi.fn<ListEventsFn>(async () => {
      throw new GoogleApiUnauthorizedError();
    });
    const refreshAccessToken = async () => ({
      accessToken: "new-token",
      refreshToken: "r",
    });

    await expect(
      syncGoogleCalendar(
        FAKE_SUPABASE,
        makeDeps({
          gateway,
          syncStateGateway,
          listEvents,
          refreshAccessToken,
        }),
      ),
    ).rejects.toBeInstanceOf(GoogleApiUnauthorizedError);

    expect(saveSyncState).not.toHaveBeenCalled();
  });
});

describe("syncGoogleCalendar (incremental sync via syncToken)", () => {
  test("syncToken が DB にあれば incremental として呼び出す (timeMin/timeMax/orderBy を送らない)", async () => {
    const { gateway, upsertCalls } = makeFakeGateway();
    const { gateway: syncStateGateway, saveSyncState } = makeFakeSyncStateGateway({
      lastSyncedAt: "2026-04-23T00:00:00.000Z",
      syncToken: "tok-prev",
    });
    const listEvents = vi.fn<ListEventsFn>(async () => ({
      items: [makeActiveEvent("incr-1")],
      nextSyncToken: "tok-next",
    }));

    const result = await syncGoogleCalendar(
      FAKE_SUPABASE,
      makeDeps({
        gateway,
        syncStateGateway,
        listEvents,
        accessToken: "fresh",
        now: () => new Date("2026-04-24T00:00:00.000Z"),
      }),
    );

    expect(result.synced).toBe(1);
    expect(listEvents).toHaveBeenCalledTimes(1);
    const call = listEvents.mock.calls[0]![0];
    expect(call.syncToken).toBe("tok-prev");
    expect(call.singleEvents).toBe(true);
    expect(call.timeMin).toBeUndefined();
    expect(call.timeMax).toBeUndefined();
    expect(call.orderBy).toBeUndefined();
    expect(upsertCalls[0]!.map((e) => e.externalId)).toEqual(["incr-1"]);
    expect(saveSyncState).toHaveBeenCalledWith(
      {
        source: "google_calendar",
        externalAccountId: "ext-acc-id",
        externalCalendarId: "primary",
      },
      { lastSyncedAt: "2026-04-24T00:00:00.000Z", syncToken: "tok-next" },
    );
  });

  test("incremental sync でも cancelled は削除に回る (差分削除が機能する)", async () => {
    const { gateway, deleteCalls } = makeFakeGateway();
    const { gateway: syncStateGateway } = makeFakeSyncStateGateway({
      lastSyncedAt: "2026-04-23T00:00:00.000Z",
      syncToken: "tok-prev",
    });
    const listEvents = vi.fn<ListEventsFn>(async () => ({
      items: [{ id: "gone-incr", status: "cancelled" }, makeActiveEvent("kept")],
      nextSyncToken: "tok-next",
    }));

    const result = await syncGoogleCalendar(
      FAKE_SUPABASE,
      makeDeps({ gateway, syncStateGateway, listEvents }),
    );

    expect(result.deleted).toBe(1);
    expect(deleteCalls[0]).toEqual({
      externalCalendarId: "primary",
      ids: ["gone-incr"],
    });
  });

  test("incremental sync のページングは中間ページの nextSyncToken を無視し最終ページのみ採用する", async () => {
    const { gateway } = makeFakeGateway();
    const { gateway: syncStateGateway, saveSyncState } = makeFakeSyncStateGateway({
      lastSyncedAt: "2026-04-23T00:00:00.000Z",
      syncToken: "tok-prev",
    });
    const listEvents = vi.fn<ListEventsFn>();
    listEvents
      .mockResolvedValueOnce({
        items: [makeActiveEvent("p1")],
        nextPageToken: "page-2",
        // 中間ページにも nextSyncToken が来るケース (Google の挙動として無効)
        nextSyncToken: "intermediate-should-be-ignored",
      })
      .mockResolvedValueOnce({
        items: [makeActiveEvent("p2")],
        nextSyncToken: "final-only",
      });

    await syncGoogleCalendar(FAKE_SUPABASE, makeDeps({ gateway, syncStateGateway, listEvents }));

    expect(saveSyncState).toHaveBeenCalledWith(
      {
        source: "google_calendar",
        externalAccountId: "ext-acc-id",
        externalCalendarId: "primary",
      },
      { lastSyncedAt: expect.any(String), syncToken: "final-only" },
    );
  });

  test("410 Gone を受けたら syncToken を捨てて full sync に fallback する", async () => {
    const { gateway, upsertCalls } = makeFakeGateway();
    const { gateway: syncStateGateway, saveSyncState } = makeFakeSyncStateGateway({
      lastSyncedAt: "2026-04-23T00:00:00.000Z",
      syncToken: "tok-stale",
    });
    const listEvents = vi.fn<ListEventsFn>();
    listEvents
      .mockRejectedValueOnce(new GoogleApiError("Gone", 410, { error: "fullSyncRequired" }))
      .mockResolvedValueOnce({
        items: [makeActiveEvent("after-fallback")],
        nextSyncToken: "fresh-after-fallback",
      });

    const result = await syncGoogleCalendar(
      FAKE_SUPABASE,
      makeDeps({
        gateway,
        syncStateGateway,
        listEvents,
        now: () => new Date("2026-04-24T05:00:00.000Z"),
      }),
    );

    expect(result.synced).toBe(1);
    expect(listEvents).toHaveBeenCalledTimes(2);
    // 1 回目は incremental
    expect(listEvents.mock.calls[0]![0].syncToken).toBe("tok-stale");
    expect(listEvents.mock.calls[0]![0].timeMin).toBeUndefined();
    // 2 回目は full sync (timeMin/timeMax/orderBy 復活、syncToken 無し)
    expect(listEvents.mock.calls[1]![0].syncToken).toBeUndefined();
    expect(listEvents.mock.calls[1]![0].timeMin).toBeDefined();
    expect(listEvents.mock.calls[1]![0].timeMax).toBeDefined();
    expect(listEvents.mock.calls[1]![0].orderBy).toBe("startTime");
    expect(upsertCalls[0]!.map((e) => e.externalId)).toEqual(["after-fallback"]);
    // fallback 後の full sync で得た新しい syncToken を保存
    expect(saveSyncState).toHaveBeenCalledWith(
      {
        source: "google_calendar",
        externalAccountId: "ext-acc-id",
        externalCalendarId: "primary",
      },
      { lastSyncedAt: "2026-04-24T05:00:00.000Z", syncToken: "fresh-after-fallback" },
    );
  });

  test("full sync 中の 410 は fallback せず素通しで throw (syncToken なしの 410 は想定外)", async () => {
    const { gateway } = makeFakeGateway();
    const { gateway: syncStateGateway } = makeFakeSyncStateGateway(null);
    const listEvents = vi.fn<ListEventsFn>(async () => {
      throw new GoogleApiError("Gone", 410, { error: "x" });
    });

    await expect(
      syncGoogleCalendar(FAKE_SUPABASE, makeDeps({ gateway, syncStateGateway, listEvents })),
    ).rejects.toBeInstanceOf(GoogleApiError);

    expect(listEvents).toHaveBeenCalledTimes(1);
  });

  test("fallback 後にも 410 が出続けたら 2 度目は throw する (無限ループ防止)", async () => {
    const { gateway } = makeFakeGateway();
    const { gateway: syncStateGateway } = makeFakeSyncStateGateway({
      lastSyncedAt: "2026-04-23T00:00:00.000Z",
      syncToken: "tok-stale",
    });
    const listEvents = vi.fn<ListEventsFn>(async () => {
      throw new GoogleApiError("Gone", 410, { error: "x" });
    });

    await expect(
      syncGoogleCalendar(FAKE_SUPABASE, makeDeps({ gateway, syncStateGateway, listEvents })),
    ).rejects.toBeInstanceOf(GoogleApiError);

    // 1 回目 incremental → 410, 2 回目 full → また 410 で throw
    expect(listEvents).toHaveBeenCalledTimes(2);
  });
});
