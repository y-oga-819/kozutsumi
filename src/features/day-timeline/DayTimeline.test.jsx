import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { DayTimeline } from "./DayTimeline.jsx";

const events = [
  {
    id: "e1",
    title: "Meeting A",
    time: "10:00",
    endTime: "11:00",
    project: "slo",
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
