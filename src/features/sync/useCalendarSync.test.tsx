import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  log: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock("@/entities/action-log/logger", () => ({
  ACTION_TYPES: Object.freeze({
    TASK_STARTED: "task_started",
    TASK_PAUSED: "task_paused",
    TASK_RESUMED: "task_resumed",
    TASK_COMPLETED: "task_completed",
    TASK_REORDERED: "task_reordered",
    TASK_DELETED: "task_deleted",
    TASK_TITLE_CHANGED: "task_title_changed",
    INTERRUPTION_PUSHED: "interruption_pushed",
    INTERRUPTION_COMPLETED: "interruption_completed",
    STACK_PROPOSED: "stack_proposed",
    STACK_PROPOSAL_ACCEPTED: "stack_proposal_accepted",
    CALENDAR_SYNCED: "calendar_synced",
  }),
  log: mocks.log,
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    warning: mocks.toastWarning,
  },
}));

import { SKIPPED_EVENTS_QUERY_KEY } from "./skippedEventsCache";
import { useCalendarSync } from "./useCalendarSync";

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { Wrapper, queryClient, invalidateSpy };
}

function mockFetchOnce(init: { status: number; body?: unknown }): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn<typeof fetch>(
    async () =>
      new Response(init.body ? JSON.stringify(init.body) : null, {
        status: init.status,
        headers: { "content-type": "application/json" },
      }),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe("useCalendarSync", () => {
  beforeEach(() => {
    mocks.log.mockClear();
    mocks.toastSuccess.mockClear();
    mocks.toastWarning.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("200 成功 (manual): lastSyncedAt を保持し events を invalidate し action_log を記録 + 成功トースト", async () => {
    const { Wrapper, invalidateSpy } = makeWrapper();
    const fetchMock = mockFetchOnce({
      status: 200,
      body: { synced: 3, deleted: 1, lastSyncedAt: "2026-04-24T04:00:00.000Z", skipped: [] },
    });

    const { result } = renderHook(() => useCalendarSync(), { wrapper: Wrapper });

    act(() => {
      result.current.triggerSync("manual");
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));

    expect(result.current.lastSyncedAt).toBe("2026-04-24T04:00:00.000Z");
    expect(result.current.needsReauth).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith("/api/calendar/sync", {
      method: "POST",
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["events"] });
    expect(mocks.log).toHaveBeenCalledWith("calendar_synced", {
      synced: 3,
      deleted: 1,
      trigger: "manual",
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("3 件の予定を取り込みました");
    expect(mocks.toastWarning).not.toHaveBeenCalled();
  });

  test("lazy trigger ではトーストを出さず action_log に trigger='lazy' を渡す", async () => {
    const { Wrapper } = makeWrapper();
    mockFetchOnce({
      status: 200,
      body: { synced: 0, deleted: 0, lastSyncedAt: "2026-04-24T04:00:00.000Z", skipped: [] },
    });

    const { result } = renderHook(() => useCalendarSync(), { wrapper: Wrapper });

    act(() => {
      result.current.triggerSync("lazy");
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));

    expect(mocks.log).toHaveBeenCalledWith("calendar_synced", {
      synced: 0,
      deleted: 0,
      trigger: "lazy",
    });
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.toastWarning).not.toHaveBeenCalled();
  });

  test("manual で skipped > 0 のときは warning トーストを出し、skipped をキャッシュに書き込む", async () => {
    const { Wrapper, queryClient } = makeWrapper();
    const skipped = [
      {
        externalCalendarId: "shared@group.calendar.google.com",
        externalId: "evt-zero",
        title: "ゼロ長",
        reason: "invalid_time_range" as const,
      },
    ];
    mockFetchOnce({
      status: 200,
      body: { synced: 5, deleted: 0, lastSyncedAt: "2026-04-24T04:00:00.000Z", skipped },
    });

    const { result } = renderHook(() => useCalendarSync(), { wrapper: Wrapper });

    act(() => {
      result.current.triggerSync("manual");
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));

    expect(mocks.toastWarning).toHaveBeenCalledWith(
      "5 件取り込み・1 件は時刻が不正のためスキップしました",
      { description: "上部のバナーから詳細を確認できます" },
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(SKIPPED_EVENTS_QUERY_KEY)).toEqual(skipped);
  });

  test("lazy で skipped > 0 でもトーストは出さず、キャッシュには書き込む (バナーは出る)", async () => {
    const { Wrapper, queryClient } = makeWrapper();
    const skipped = [
      {
        externalCalendarId: "shared@group.calendar.google.com",
        externalId: "evt-zero",
        title: "ゼロ長",
        reason: "invalid_time_range" as const,
      },
    ];
    mockFetchOnce({
      status: 200,
      body: { synced: 5, deleted: 0, lastSyncedAt: "2026-04-24T04:00:00.000Z", skipped },
    });

    const { result } = renderHook(() => useCalendarSync(), { wrapper: Wrapper });

    act(() => {
      result.current.triggerSync("lazy");
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));

    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.toastWarning).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(SKIPPED_EVENTS_QUERY_KEY)).toEqual(skipped);
  });

  test("401 を受けたら needsReauth=true になり、events は invalidate しない", async () => {
    const { Wrapper, invalidateSpy } = makeWrapper();
    mockFetchOnce({
      status: 401,
      body: { error: "provider_token_missing" },
    });

    const { result } = renderHook(() => useCalendarSync(), { wrapper: Wrapper });

    act(() => {
      result.current.triggerSync("manual");
    });
    await waitFor(() => expect(result.current.needsReauth).toBe(true));

    expect(result.current.lastSyncedAt).toBeNull();
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });

  test("dismissReauth で needsReauth を false に戻せる", async () => {
    const { Wrapper } = makeWrapper();
    mockFetchOnce({ status: 401 });

    const { result } = renderHook(() => useCalendarSync(), { wrapper: Wrapper });

    act(() => {
      result.current.triggerSync("manual");
    });
    await waitFor(() => expect(result.current.needsReauth).toBe(true));

    act(() => {
      result.current.dismissReauth();
    });
    expect(result.current.needsReauth).toBe(false);
  });

  test("500 失敗時は needsReauth は立たず pending が解除されるだけ (ユーザー側で再試行)", async () => {
    const { Wrapper, invalidateSpy } = makeWrapper();
    mockFetchOnce({ status: 500, body: { error: "sync_failed" } });

    const { result } = renderHook(() => useCalendarSync(), { wrapper: Wrapper });

    act(() => {
      result.current.triggerSync("manual");
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));

    expect(result.current.needsReauth).toBe(false);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
