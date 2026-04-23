import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

import { GoogleApiUnauthorizedError, listEvents } from "./calendar";

describe("listEvents", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mockResponse(
    body: unknown,
    init: { status?: number; statusText?: string } = {},
  ) {
    return new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      statusText: init.statusText ?? "OK",
      headers: { "content-type": "application/json" },
    });
  }

  test("正常系: レスポンスをそのまま返す", async () => {
    const payload = {
      items: [{ id: "evt-1", summary: "meeting" }],
      nextSyncToken: "sync-1",
    };
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse(payload));

    const result = await listEvents({
      accessToken: "token",
      calendarId: "primary",
      timeMin: "2026-04-01T00:00:00Z",
      timeMax: "2026-05-01T00:00:00Z",
      singleEvents: true,
      orderBy: "startTime",
    });

    expect(result).toEqual(payload);
  });

  test("Bearer token を Authorization ヘッダに載せる", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockResponse({ items: [] }),
    );

    await listEvents({ accessToken: "the-token", calendarId: "primary" });

    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
    expect(init?.headers).toEqual(
      expect.objectContaining({ Authorization: "Bearer the-token" }),
    );
  });

  test("calendarId を URL に含み、クエリパラメータを組み立てる", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockResponse({ items: [] }),
    );

    await listEvents({
      accessToken: "token",
      calendarId: "primary",
      timeMin: "2026-04-01T00:00:00Z",
      timeMax: "2026-05-01T00:00:00Z",
      singleEvents: true,
      orderBy: "startTime",
      pageToken: "page-2",
      maxResults: 250,
    });

    const [url] = vi.mocked(globalThis.fetch).mock.calls[0]!;
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe("/calendar/v3/calendars/primary/events");
    expect(parsed.searchParams.get("timeMin")).toBe("2026-04-01T00:00:00Z");
    expect(parsed.searchParams.get("timeMax")).toBe("2026-05-01T00:00:00Z");
    expect(parsed.searchParams.get("singleEvents")).toBe("true");
    expect(parsed.searchParams.get("orderBy")).toBe("startTime");
    expect(parsed.searchParams.get("pageToken")).toBe("page-2");
    expect(parsed.searchParams.get("maxResults")).toBe("250");
  });

  test("calendarId は URL エンコードされる", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockResponse({ items: [] }),
    );

    await listEvents({
      accessToken: "token",
      calendarId: "user@example.com",
    });

    const [url] = vi.mocked(globalThis.fetch).mock.calls[0]!;
    expect(String(url)).toContain(
      "/calendar/v3/calendars/user%40example.com/events",
    );
  });

  test("syncToken 指定時は timeMin/timeMax を送らない (Google API 仕様)", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockResponse({ items: [] }),
    );

    await listEvents({
      accessToken: "token",
      calendarId: "primary",
      syncToken: "sync-token-xyz",
      timeMin: "2026-04-01T00:00:00Z",
      timeMax: "2026-05-01T00:00:00Z",
    });

    const [url] = vi.mocked(globalThis.fetch).mock.calls[0]!;
    const parsed = new URL(String(url));
    expect(parsed.searchParams.get("syncToken")).toBe("sync-token-xyz");
    expect(parsed.searchParams.has("timeMin")).toBe(false);
    expect(parsed.searchParams.has("timeMax")).toBe(false);
  });

  test("401 で GoogleApiUnauthorizedError を投げる", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockResponse({ error: "unauthorized" }, { status: 401 }),
    );

    await expect(
      listEvents({ accessToken: "expired", calendarId: "primary" }),
    ).rejects.toBeInstanceOf(GoogleApiUnauthorizedError);
  });

  test("410 Gone で status 付きの GoogleApiError を投げる (syncToken 失効検知用)", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockResponse({ error: "gone" }, { status: 410 }),
    );

    await expect(
      listEvents({
        accessToken: "token",
        calendarId: "primary",
        syncToken: "stale",
      }),
    ).rejects.toMatchObject({
      name: "GoogleApiError",
      status: 410,
    });
  });

  test("その他 5xx でも GoogleApiError を投げる", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockResponse({ error: "server" }, { status: 500 }),
    );

    await expect(
      listEvents({ accessToken: "token", calendarId: "primary" }),
    ).rejects.toMatchObject({
      name: "GoogleApiError",
      status: 500,
    });
  });
});
