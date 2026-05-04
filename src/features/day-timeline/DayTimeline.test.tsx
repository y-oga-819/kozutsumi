import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { DayTimeline } from "./DayTimeline";

import type { Event } from "../../entities/event/types";

const ev = (id: string, title: string, startTime: string, endTime: string): Event => ({
  id,
  title,
  startTime,
  endTime,
  projectId: "slo",
  meetUrl: null,
  hasAttachments: false,
  description: "",
  source: "manual",
  externalId: null,
  externalCalendarId: "manual",
  visibilityOverride: "none",
  createdAt: "2026-04-11T00:00:00",
});

const events: Event[] = [ev("e1", "Meeting A", "2026-04-11T10:00:00", "2026-04-11T11:00:00")];

describe("DayTimeline", () => {
  test("today を formatDate して表示する", () => {
    const { getByText } = render(
      <DayTimeline
        events={[]}
        subscriptions={[]}
        nowMin={10 * 60}
        today="2026-04-11"
        onOpenEvent={() => {}}
      />,
    );
    expect(getByText("4/11 (土)")).toBeTruthy();
  });

  test("イベントタイトルが表示される", () => {
    const { getByText } = render(
      <DayTimeline
        events={events}
        subscriptions={[]}
        nowMin={9 * 60 + 30}
        today="2026-04-11"
        onOpenEvent={() => {}}
      />,
    );
    expect(getByText("Meeting A")).toBeTruthy();
  });

  test("現在の空き時間表示（free slot 中）", () => {
    const { getByText } = render(
      <DayTimeline
        events={events}
        subscriptions={[]}
        nowMin={9 * 60 + 30}
        today="2026-04-11"
        onOpenEvent={() => {}}
      />,
    );
    // 9:30 (nowMin) から 10:00 (イベント開始) まで 30分の空き
    expect(getByText(/空き 30m/)).toBeTruthy();
  });

  test("today に開始しない event はタイムラインに含めない (昨日 / 明日 / 先週は除外)", () => {
    const mixed: Event[] = [
      ev("e1", "Today event", "2026-04-11T10:00:00", "2026-04-11T11:00:00"),
      ev("yesterday", "Yesterday event", "2026-04-10T14:00:00", "2026-04-10T15:00:00"),
      ev("tomorrow", "Tomorrow event", "2026-04-12T09:00:00", "2026-04-12T10:00:00"),
      ev("last-week", "Last week event", "2026-04-04T10:00:00", "2026-04-04T11:00:00"),
    ];
    const { getByText, queryByText } = render(
      <DayTimeline
        events={mixed}
        subscriptions={[]}
        nowMin={9 * 60 + 30}
        today="2026-04-11"
        onOpenEvent={() => {}}
      />,
    );
    expect(getByText("Today event")).toBeTruthy();
    expect(queryByText("Yesterday event")).toBeNull();
    expect(queryByText("Tomorrow event")).toBeNull();
    expect(queryByText("Last week event")).toBeNull();
  });
});
