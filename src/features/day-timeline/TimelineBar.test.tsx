import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { Slot } from "./buildSlots";
import { TimelineBar } from "./TimelineBar";

describe("TimelineBar", () => {
  test("slots を描画する（crash しない）", () => {
    const slots: Slot[] = [
      { type: "free", start: 540, end: 600, duration: 60 },
      {
        type: "event",
        start: 600,
        end: 660,
        duration: 60,
        event: { id: "e1", title: "ev1", time: "10:00", endTime: "11:00", date: "2026-04-11", project: "slo" },
      },
      { type: "free", start: 660, end: 1080, duration: 420 },
    ];
    const { container } = render(
      <TimelineBar slots={slots} nowMin={0} dayStart={540} dayEnd={1080} />,
    );
    expect(container.children.length).toBeGreaterThan(0);
  });

  test("時刻ラベル (dayStart, dayEnd) を描画する", () => {
    const { getByText } = render(
      <TimelineBar slots={[]} nowMin={0} dayStart={9 * 60} dayEnd={18 * 60} />,
    );
    expect(getByText("9:00")).toBeTruthy();
    expect(getByText("18:00")).toBeTruthy();
  });
});
