import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { DayTimeline } from "./DayTimeline";

import type { Event } from "../../entities/event/types";

const events: Event[] = [
  {
    id: "e1",
    title: "Meeting A",
    startTime: "2026-04-11T10:00:00",
    endTime: "2026-04-11T11:00:00",
    projectId: "slo",
    meetUrl: null,
    hasAttachments: false,
    description: "",
    source: "manual",
    externalId: null,
    createdAt: "2026-04-11T00:00:00",
  },
];

describe("DayTimeline", () => {
  test("today を formatDate して表示する", () => {
    const { getByText } = render(
      <DayTimeline
        events={[]}
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
        nowMin={9 * 60 + 30}
        today="2026-04-11"
        onOpenEvent={() => {}}
      />,
    );
    // 9:30 (nowMin) から 10:00 (イベント開始) まで 30分の空き
    expect(getByText(/空き 30m/)).toBeTruthy();
  });
});
