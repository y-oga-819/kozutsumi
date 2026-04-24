import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { CalendarSyncState } from "@/entities/calendar-sync/gateway";

import { shouldTriggerLazy, useLazyCalendarSync } from "./useLazyCalendarSync";

const FIXED_NOW = new Date("2026-04-24T10:00:00.000Z");

function now() {
  return FIXED_NOW;
}

describe("shouldTriggerLazy", () => {
  test("state が null なら未同期として true", () => {
    expect(shouldTriggerLazy(null, FIXED_NOW)).toBe(true);
  });

  test("前回同期から 15 分以上経過していたら true", () => {
    const state: CalendarSyncState = {
      lastSyncedAt: new Date(FIXED_NOW.getTime() - 16 * 60_000).toISOString(),
      syncToken: null,
    };
    expect(shouldTriggerLazy(state, FIXED_NOW)).toBe(true);
  });

  test("ちょうど 15 分前 (閾値の境界) なら true", () => {
    const state: CalendarSyncState = {
      lastSyncedAt: new Date(FIXED_NOW.getTime() - 15 * 60_000).toISOString(),
      syncToken: null,
    };
    expect(shouldTriggerLazy(state, FIXED_NOW)).toBe(true);
  });

  test("15 分未満なら false", () => {
    const state: CalendarSyncState = {
      lastSyncedAt: new Date(FIXED_NOW.getTime() - 5 * 60_000).toISOString(),
      syncToken: null,
    };
    expect(shouldTriggerLazy(state, FIXED_NOW)).toBe(false);
  });

  test("lastSyncedAt が ISO として壊れている場合は stale 扱いで true (fail-open)", () => {
    expect(
      shouldTriggerLazy(
        { lastSyncedAt: "garbage", syncToken: null },
        FIXED_NOW,
      ),
    ).toBe(true);
  });
});

describe("useLazyCalendarSync", () => {
  test("stale ならマウント時に triggerSync('lazy') を 1 回呼ぶ", async () => {
    const triggerSync = vi.fn();
    const getState = vi.fn(async () => null);

    renderHook(() =>
      useLazyCalendarSync({ triggerSync, deps: { getState, now } }),
    );

    await waitFor(() => expect(triggerSync).toHaveBeenCalledTimes(1));
    expect(triggerSync).toHaveBeenCalledWith("lazy");
  });

  test("fresh なら triggerSync を呼ばない", async () => {
    const triggerSync = vi.fn();
    const getState = vi.fn(
      async (): Promise<CalendarSyncState | null> => ({
        lastSyncedAt: new Date(FIXED_NOW.getTime() - 60_000).toISOString(),
        syncToken: null,
      }),
    );

    renderHook(() =>
      useLazyCalendarSync({ triggerSync, deps: { getState, now } }),
    );

    // 1 tick 待って triggerSync が呼ばれないことを確認
    await new Promise((r) => setTimeout(r, 0));
    expect(triggerSync).not.toHaveBeenCalled();
  });

  test("親の再レンダリングで 2 回目以降は fire しない (ref ガード)", async () => {
    const triggerSync = vi.fn();
    const getState = vi.fn(async () => null);

    const { rerender } = renderHook(() =>
      useLazyCalendarSync({ triggerSync, deps: { getState, now } }),
    );

    await waitFor(() => expect(triggerSync).toHaveBeenCalledTimes(1));

    rerender();
    rerender();
    await new Promise((r) => setTimeout(r, 0));

    expect(triggerSync).toHaveBeenCalledTimes(1);
    expect(getState).toHaveBeenCalledTimes(1);
  });

  test("getState が throw しても例外は握りつぶし triggerSync も呼ばない", async () => {
    const triggerSync = vi.fn();
    const getState = vi.fn(async () => {
      throw new Error("network down");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    renderHook(() =>
      useLazyCalendarSync({ triggerSync, deps: { getState, now } }),
    );

    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(triggerSync).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
