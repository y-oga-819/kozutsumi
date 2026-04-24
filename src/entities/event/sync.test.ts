import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, test, vi } from "vitest";

import type { CalendarSyncStateGateway } from "@/entities/calendar-sync/gateway";
import {
  GoogleApiUnauthorizedError,
  type GoogleCalendarEvent,
  type GoogleCalendarEventsListResponse,
  type ListEventsParams,
} from "@/shared/google/calendar";
import { RefreshTokenExpiredError } from "@/shared/google/token";
import type { Database } from "@/shared/types/database";

import type {
  EventGateway,
  UpsertGoogleCalendarEventInput,
} from "./gateway";
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
});

describe("extractMeetUrl", () => {
  test("hangoutLink があればそれを使う", () => {
    expect(
      extractMeetUrl({
        id: "e1",
        hangoutLink: "https://meet.google.com/abc-defg-hij",
        conferenceData: {
          entryPoints: [
            { entryPointType: "video", uri: "https://other.example/video" },
          ],
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
    const result = mapGoogleEventToUpsertInput({
      id: "evt-1",
      summary: "1on1",
      description: "議題: 進捗",
      start: { dateTime: "2026-04-23T10:00:00+09:00" },
      end: { dateTime: "2026-04-23T11:00:00+09:00" },
      hangoutLink: "https://meet.google.com/xyz",
      attachments: [{ fileUrl: "https://drive.example/abc" }],
    });

    expect(result).toEqual<UpsertGoogleCalendarEventInput>({
      externalId: "evt-1",
      title: "1on1",
      startTime: "2026-04-23T01:00:00.000Z",
      endTime: "2026-04-23T02:00:00.000Z",
      meetUrl: "https://meet.google.com/xyz",
      hasAttachments: true,
      description: "議題: 進捗",
    });
  });

  test("summary が無い場合はデフォルトタイトル、description / meet_url が無ければ空 / null", () => {
    const result = mapGoogleEventToUpsertInput({
      id: "evt-2",
      start: { dateTime: "2026-04-23T10:00:00Z" },
      end: { dateTime: "2026-04-23T11:00:00Z" },
    });

    expect(result).toEqual<UpsertGoogleCalendarEventInput>({
      externalId: "evt-2",
      title: "(タイトルなし)",
      startTime: "2026-04-23T10:00:00.000Z",
      endTime: "2026-04-23T11:00:00.000Z",
      meetUrl: null,
      hasAttachments: false,
      description: "",
    });
  });

  test("時刻が無い壊れたイベントは null を返す", () => {
    expect(
      mapGoogleEventToUpsertInput({ id: "bad", start: {}, end: {} }),
    ).toBeNull();
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
      // 壊れたイベントは無視する
      { id: "broken", start: {}, end: {} },
    ];

    const result = partitionEvents(events);

    expect(result.cancelled).toEqual(["deleted-1", "deleted-2"]);
    expect(result.upserts.map((u) => u.externalId)).toEqual([
      "active-1",
      "active-2",
    ]);
  });
});

// =====================================================================
// syncGoogleCalendar orchestration
// =====================================================================

type ListEventsFn = (
  params: ListEventsParams,
) => Promise<GoogleCalendarEventsListResponse>;

function makeFakeGateway() {
  const upsertCalls: UpsertGoogleCalendarEventInput[][] = [];
  const deleteCalls: string[][] = [];
  const gateway: EventGateway = {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteAllForCurrentUser: vi.fn(),
    upsertFromGoogleCalendar: vi.fn(async (inputs) => {
      upsertCalls.push(inputs);
      return inputs.length;
    }),
    deleteByGoogleExternalIds: vi.fn(async (ids) => {
      deleteCalls.push(ids);
      return ids.length;
    }),
  };
  return { gateway, upsertCalls, deleteCalls };
}

function makeFakeSyncStateGateway() {
  const upsertLastSyncedAt = vi.fn<(iso: string) => Promise<void>>(
    async () => {},
  );
  const gateway: CalendarSyncStateGateway = {
    get: vi.fn(async () => null),
    upsertLastSyncedAt,
  };
  return { gateway, upsertLastSyncedAt };
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
}) {
  return {
    gateway: overrides.gateway,
    syncStateGateway:
      overrides.syncStateGateway ?? makeFakeSyncStateGateway().gateway,
    listEvents: overrides.listEvents,
    getValidAccessToken: vi.fn(async () => ({
      accessToken: overrides.accessToken ?? "t",
      refreshToken: "r",
    })),
    refreshAccessToken: overrides.refreshAccessToken
      ? vi.fn(overrides.refreshAccessToken)
      : vi.fn(),
    now: overrides.now ?? DEFAULT_NOW,
  };
}

describe("syncGoogleCalendar", () => {
  test("primary の timeMin/timeMax を now±window で計算し、1 ページで完了", async () => {
    const { gateway, upsertCalls, deleteCalls } = makeFakeGateway();
    const listEvents = vi.fn<ListEventsFn>(async () => ({
      items: [makeActiveEvent("a"), makeActiveEvent("b")],
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

    expect(result).toEqual({
      synced: 2,
      deleted: 0,
      lastSyncedAt: "2026-04-23T12:00:00.000Z",
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
      });

    const result = await syncGoogleCalendar(
      FAKE_SUPABASE,
      makeDeps({ gateway, listEvents }),
    );

    expect(result.synced).toBe(4);
    expect(listEvents).toHaveBeenCalledTimes(3);
    expect(listEvents.mock.calls[1]![0].pageToken).toBe("tok-2");
    expect(listEvents.mock.calls[2]![0].pageToken).toBe("tok-3");
    expect(upsertCalls[0]!.map((e) => e.externalId)).toEqual([
      "p1-a",
      "p1-b",
      "p2-a",
      "p3-a",
    ]);
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

    const result = await syncGoogleCalendar(
      FAKE_SUPABASE,
      makeDeps({ gateway, listEvents }),
    );

    expect(result.synced).toBe(1);
    expect(result.deleted).toBe(2);
    expect(upsertCalls[0]!.map((e) => e.externalId)).toEqual(["keep"]);
    expect(deleteCalls[0]).toEqual(["gone-1", "gone-2"]);
  });

  test("空結果の時は upsert/delete を呼ばない", async () => {
    const { gateway, upsertCalls, deleteCalls } = makeFakeGateway();
    const listEvents = vi.fn<ListEventsFn>(async () => ({ items: [] }));

    const result = await syncGoogleCalendar(
      FAKE_SUPABASE,
      makeDeps({ gateway, listEvents }),
    );

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

  test("成功時は last_synced_at を永続化する", async () => {
    const { gateway } = makeFakeGateway();
    const { gateway: syncStateGateway, upsertLastSyncedAt } =
      makeFakeSyncStateGateway();
    const listEvents = vi.fn<ListEventsFn>(async () => ({
      items: [makeActiveEvent("a")],
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
    expect(upsertLastSyncedAt).toHaveBeenCalledTimes(1);
    expect(upsertLastSyncedAt).toHaveBeenCalledWith("2026-04-24T01:30:00.000Z");
  });

  test("401 retry 後も失敗する場合は last_synced_at を記録しない", async () => {
    const { gateway } = makeFakeGateway();
    const { gateway: syncStateGateway, upsertLastSyncedAt } =
      makeFakeSyncStateGateway();
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

    expect(upsertLastSyncedAt).not.toHaveBeenCalled();
  });
});
