import { describe, expect, test } from "vitest";

import { parseSetAutoPromoteResult } from "./supabase-gateway";

describe("parseSetAutoPromoteResult", () => {
  test("changed=true の場合に triple metadata + frozen_events をパースする", () => {
    const raw = {
      changed: true,
      from: true,
      to: false,
      source: "google_calendar",
      external_account_id: "user@example.com",
      external_calendar_id: "primary",
      frozen_to: "shown",
      frozen_events: [
        {
          external_id: "ext-1",
          title: "MTG",
          start_time: "2026-05-03T01:00:00.000Z",
          end_time: "2026-05-03T02:00:00.000Z",
        },
      ],
    };

    const result = parseSetAutoPromoteResult(raw);

    expect(result).toEqual({
      changed: true,
      from: true,
      to: false,
      source: "google_calendar",
      externalAccountIdentifier: "user@example.com",
      externalCalendarId: "primary",
      frozenTo: "shown",
      frozenEvents: [
        {
          externalId: "ext-1",
          title: "MTG",
          startTime: "2026-05-03T01:00:00.000Z",
          endTime: "2026-05-03T02:00:00.000Z",
        },
      ],
    });
  });

  test("changed=false の場合 frozen_to=null / frozen_events=[] を許容する", () => {
    const result = parseSetAutoPromoteResult({
      changed: false,
      from: true,
      to: true,
      source: "google_calendar",
      external_account_id: "user@example.com",
      external_calendar_id: "primary",
      frozen_to: null,
      frozen_events: [],
    });
    expect(result.changed).toBe(false);
    expect(result.frozenTo).toBeNull();
    expect(result.frozenEvents).toEqual([]);
  });

  test("frozen_to が想定外の値なら null に倒す (UI 側の type narrowing を壊さない)", () => {
    const result = parseSetAutoPromoteResult({
      changed: true,
      from: true,
      to: false,
      source: "google_calendar",
      external_account_id: "u",
      external_calendar_id: "primary",
      frozen_to: "garbage",
      frozen_events: [],
    });
    expect(result.frozenTo).toBeNull();
  });

  test("不正な response shape は throw する", () => {
    expect(() => parseSetAutoPromoteResult(null)).toThrowError(/invalid response/);
    expect(() => parseSetAutoPromoteResult("string")).toThrowError(/invalid response/);
  });
});
