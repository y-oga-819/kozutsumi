import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { EventCard } from "./EventCard";

import type { Event } from "../../entities/event/types";

const baseEvent: Event = {
  id: "e1",
  title: "Test Event",
  startTime: "2026-04-11T10:00:00",
  endTime: "2026-04-11T11:00:00",
  projectId: "slo",
  meetUrl: null,
  hasAttachments: false,
  description: "",
  source: "manual",
  externalId: null,
  createdAt: "2026-04-11T00:00:00",
};

describe("EventCard", () => {
  test("タイトルを表示する", () => {
    const { getByText } = render(
      <EventCard
        event={baseEvent}
        nowMin={0}
        isNextCandidate={false}
        onClick={() => {}}
      />,
    );
    expect(getByText("Test Event")).toBeTruthy();
  });

  test("時刻レンジを表示する", () => {
    const { getByText } = render(
      <EventCard
        event={baseEvent}
        nowMin={0}
        isNextCandidate={false}
        onClick={() => {}}
      />,
    );
    expect(getByText("10:00–11:00")).toBeTruthy();
  });

  test("isNextCandidate=true かつイベント前なら NEXT バッジを表示", () => {
    const { getByText } = render(
      <EventCard
        event={baseEvent}
        nowMin={9 * 60}
        isNextCandidate={true}
        onClick={() => {}}
      />,
    );
    expect(getByText("NEXT")).toBeTruthy();
  });

  test("イベント時間内は NOW バッジを表示", () => {
    const { getByText } = render(
      <EventCard
        event={baseEvent}
        nowMin={10 * 60 + 30}
        isNextCandidate={false}
        onClick={() => {}}
      />,
    );
    expect(getByText("NOW")).toBeTruthy();
  });
});
