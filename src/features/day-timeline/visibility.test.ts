import { describe, expect, test } from "vitest";

import type { Event } from "@/entities/event/types";

import {
  filterEventsForTimeline,
  isEventVisibleInTimeline,
  type SubscriptionVisibility,
} from "./visibility";

const baseManual: Event = {
  id: "m1",
  title: "manual event",
  startTime: "2026-05-04T01:00:00.000Z",
  endTime: "2026-05-04T02:00:00.000Z",
  projectId: null,
  meetUrl: null,
  hasAttachments: false,
  description: "",
  source: "manual",
  externalId: null,
  externalCalendarId: "manual",
  visibilityOverride: "none",
  createdAt: "2026-05-04T00:00:00.000Z",
};

const baseGoogle: Event = {
  ...baseManual,
  id: "g1",
  source: "google_calendar",
  externalId: "ext-1",
  externalCalendarId: "primary",
};

describe("isEventVisibleInTimeline (Issue #144 / ADR 0031 Layer 2 + Layer 3)", () => {
  test("manual event は visibility_override=none / shown で表示", () => {
    expect(isEventVisibleInTimeline(baseManual, [])).toBe(true);
    expect(isEventVisibleInTimeline({ ...baseManual, visibilityOverride: "shown" }, [])).toBe(true);
  });

  test("manual event でも visibility_override=hidden なら非表示", () => {
    expect(isEventVisibleInTimeline({ ...baseManual, visibilityOverride: "hidden" }, [])).toBe(
      false,
    );
  });

  test("google event の visibility_override=shown は subscription 状態に関係なく表示", () => {
    const subs: SubscriptionVisibility[] = [
      { source: "google_calendar", externalCalendarId: "primary", autoPromoteToTimeline: false },
    ];
    expect(isEventVisibleInTimeline({ ...baseGoogle, visibilityOverride: "shown" }, subs)).toBe(
      true,
    );
  });

  test("google event の visibility_override=hidden は subscription auto_promote=true でも非表示", () => {
    const subs: SubscriptionVisibility[] = [
      { source: "google_calendar", externalCalendarId: "primary", autoPromoteToTimeline: true },
    ];
    expect(isEventVisibleInTimeline({ ...baseGoogle, visibilityOverride: "hidden" }, subs)).toBe(
      false,
    );
  });

  test("google event の visibility_override=none + subscription auto_promote=true で表示", () => {
    const subs: SubscriptionVisibility[] = [
      { source: "google_calendar", externalCalendarId: "primary", autoPromoteToTimeline: true },
    ];
    expect(isEventVisibleInTimeline(baseGoogle, subs)).toBe(true);
  });

  test("google event の visibility_override=none + subscription auto_promote=false で非表示", () => {
    const subs: SubscriptionVisibility[] = [
      { source: "google_calendar", externalCalendarId: "primary", autoPromoteToTimeline: false },
    ];
    expect(isEventVisibleInTimeline(baseGoogle, subs)).toBe(false);
  });

  test("google event で subscription が見つからないときは表示する (orphan event は normal flow では発生しないので events 行を尊重)", () => {
    expect(isEventVisibleInTimeline(baseGoogle, [])).toBe(true);
  });

  test("subscription マッチは (source, external_calendar_id) の両方で行う", () => {
    // 別 calendar の subscription があるが当該 event の calendar には無い → orphan 扱い → 表示
    const subs: SubscriptionVisibility[] = [
      { source: "google_calendar", externalCalendarId: "other", autoPromoteToTimeline: true },
    ];
    expect(isEventVisibleInTimeline(baseGoogle, subs)).toBe(true);
  });

  test("マッチする subscription があり auto_promote=false なら非表示 (orphan ではないので filter 効く)", () => {
    const subs: SubscriptionVisibility[] = [
      { source: "google_calendar", externalCalendarId: "primary", autoPromoteToTimeline: false },
      { source: "google_calendar", externalCalendarId: "other", autoPromoteToTimeline: true },
    ];
    expect(isEventVisibleInTimeline(baseGoogle, subs)).toBe(false);
  });
});

describe("filterEventsForTimeline", () => {
  test("非表示判定のものを除外する", () => {
    const events: Event[] = [
      baseManual,
      { ...baseManual, id: "m2", visibilityOverride: "hidden" },
      baseGoogle,
      { ...baseGoogle, id: "g2", visibilityOverride: "hidden" },
    ];
    const subs: SubscriptionVisibility[] = [
      { source: "google_calendar", externalCalendarId: "primary", autoPromoteToTimeline: true },
    ];
    const result = filterEventsForTimeline(events, subs);
    expect(result.map((e) => e.id)).toEqual(["m1", "g1"]);
  });
});
