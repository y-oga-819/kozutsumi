import { describe, expect, test } from "vitest";

import type { Event } from "@/entities/event/types";
import type { SubscriptionVisibility } from "@/features/day-timeline/visibility";

import { computeEventVisibilityState } from "./visibilityState";

const baseManual: Pick<Event, "source" | "externalCalendarId" | "visibilityOverride"> = {
  source: "manual",
  externalCalendarId: "manual",
  visibilityOverride: "none",
};

const baseGoogle: Pick<Event, "source" | "externalCalendarId" | "visibilityOverride"> = {
  source: "google_calendar",
  externalCalendarId: "primary",
  visibilityOverride: "none",
};

describe("computeEventVisibilityState (Issue #145)", () => {
  test("manual event は subscription 概念なしで default 表示", () => {
    const s = computeEventVisibilityState(baseManual, []);
    expect(s.subscriptionAutoPromote).toBe(true);
    expect(s.effectiveShown).toBe(true);
    expect(s.isOverrideOfDefault).toBe(false);
  });

  test("manual event の hidden override は default 表示に逆らった override", () => {
    const s = computeEventVisibilityState({ ...baseManual, visibilityOverride: "hidden" }, []);
    expect(s.effectiveShown).toBe(false);
    expect(s.isOverrideOfDefault).toBe(true);
  });

  test("google event override='none' + auto_promote=true → 表示, default 一致", () => {
    const subs: SubscriptionVisibility[] = [
      { source: "google_calendar", externalCalendarId: "primary", autoPromoteToTimeline: true },
    ];
    const s = computeEventVisibilityState(baseGoogle, subs);
    expect(s.effectiveShown).toBe(true);
    expect(s.isOverrideOfDefault).toBe(false);
  });

  test("google event override='none' + auto_promote=false → 非表示, default 一致", () => {
    const subs: SubscriptionVisibility[] = [
      { source: "google_calendar", externalCalendarId: "primary", autoPromoteToTimeline: false },
    ];
    const s = computeEventVisibilityState(baseGoogle, subs);
    expect(s.effectiveShown).toBe(false);
    expect(s.isOverrideOfDefault).toBe(false);
  });

  test("google event override='shown' + auto_promote=false → 表示, default 逸脱", () => {
    const subs: SubscriptionVisibility[] = [
      { source: "google_calendar", externalCalendarId: "primary", autoPromoteToTimeline: false },
    ];
    const s = computeEventVisibilityState({ ...baseGoogle, visibilityOverride: "shown" }, subs);
    expect(s.effectiveShown).toBe(true);
    expect(s.isOverrideOfDefault).toBe(true);
  });

  test("google event override='hidden' + auto_promote=true → 非表示, default 逸脱", () => {
    const subs: SubscriptionVisibility[] = [
      { source: "google_calendar", externalCalendarId: "primary", autoPromoteToTimeline: true },
    ];
    const s = computeEventVisibilityState({ ...baseGoogle, visibilityOverride: "hidden" }, subs);
    expect(s.effectiveShown).toBe(false);
    expect(s.isOverrideOfDefault).toBe(true);
  });

  test("google event override='shown' + auto_promote=true → 表示, default 一致 (override は default と同方向)", () => {
    const subs: SubscriptionVisibility[] = [
      { source: "google_calendar", externalCalendarId: "primary", autoPromoteToTimeline: true },
    ];
    const s = computeEventVisibilityState({ ...baseGoogle, visibilityOverride: "shown" }, subs);
    expect(s.effectiveShown).toBe(true);
    expect(s.isOverrideOfDefault).toBe(false);
  });

  test("google event で subscription が無い (orphan) は表示扱いの auto_promote=true", () => {
    const s = computeEventVisibilityState(baseGoogle, []);
    expect(s.subscriptionAutoPromote).toBe(true);
    expect(s.effectiveShown).toBe(true);
  });
});
