import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { CalendarSubscription } from "@/entities/calendar-subscription/types";
import type { Event } from "@/entities/event/types";

import { EventManagement } from "./EventManagement";

const sub: CalendarSubscription = {
  id: "sub-primary",
  externalAccountId: "acc-1",
  externalAccountIdentifier: "me@example.com",
  source: "google_calendar",
  externalCalendarId: "primary",
  autoPromoteToTimeline: true,
  displayName: "Primary",
  color: null,
  subscribedAt: "2026-04-01T00:00:00.000Z",
};

const subWork: CalendarSubscription = {
  ...sub,
  id: "sub-work",
  externalCalendarId: "work@example.com",
  autoPromoteToTimeline: false,
  displayName: "Work",
};

const eventA: Event = {
  id: "ev-A",
  title: "予定A (primary, default 表示)",
  startTime: "2026-05-04T01:00:00.000Z",
  endTime: "2026-05-04T02:00:00.000Z",
  projectId: null,
  meetUrl: null,
  hasAttachments: false,
  description: "",
  source: "google_calendar",
  externalId: "ext-A",
  externalCalendarId: "primary",
  visibilityOverride: "none",
  createdAt: "2026-05-04T00:00:00.000Z",
};

const eventB: Event = {
  ...eventA,
  id: "ev-B",
  title: "予定B (work, default 非表示)",
  externalId: "ext-B",
  externalCalendarId: "work@example.com",
  visibilityOverride: "none",
  startTime: "2026-05-04T03:00:00.000Z",
  endTime: "2026-05-04T04:00:00.000Z",
};

const eventC: Event = {
  ...eventA,
  id: "ev-C",
  title: "予定C (primary, override=hidden)",
  externalId: "ext-C",
  visibilityOverride: "hidden",
};

describe("EventManagement (Issue #145)", () => {
  test("default の「すべて」フィルタで全件表示", () => {
    const { getByText } = render(
      <EventManagement
        events={[eventA, eventB, eventC]}
        subscriptions={[sub, subWork]}
        onSetVisibilityOverride={vi.fn()}
      />,
    );
    expect(getByText(/予定A/)).toBeTruthy();
    expect(getByText(/予定B/)).toBeTruthy();
    expect(getByText(/予定C/)).toBeTruthy();
  });

  test("「予定化中」フィルタで effective shown のみ表示", () => {
    const { getByRole, getByText, queryByText } = render(
      <EventManagement
        events={[eventA, eventB, eventC]}
        subscriptions={[sub, subWork]}
        onSetVisibilityOverride={vi.fn()}
      />,
    );
    fireEvent.click(getByRole("tab", { name: "予定化中" }));
    expect(getByText(/予定A/)).toBeTruthy(); // primary auto_promote=true
    expect(queryByText(/予定B/)).toBeNull(); // work auto_promote=false
    expect(queryByText(/予定C/)).toBeNull(); // override=hidden
  });

  test("「予定化解除中」フィルタで effective hidden のみ表示", () => {
    const { getByRole, getByText, queryByText } = render(
      <EventManagement
        events={[eventA, eventB, eventC]}
        subscriptions={[sub, subWork]}
        onSetVisibilityOverride={vi.fn()}
      />,
    );
    fireEvent.click(getByRole("tab", { name: "予定化解除中" }));
    expect(queryByText(/予定A/)).toBeNull();
    expect(getByText(/予定B/)).toBeTruthy();
    expect(getByText(/予定C/)).toBeTruthy();
  });

  test("「個別指定中」フィルタで visibility_override !== 'none' のみ", () => {
    const { getByRole, queryByText, getByText } = render(
      <EventManagement
        events={[eventA, eventB, eventC]}
        subscriptions={[sub, subWork]}
        onSetVisibilityOverride={vi.fn()}
      />,
    );
    fireEvent.click(getByRole("tab", { name: "個別指定中" }));
    expect(queryByText(/予定A/)).toBeNull();
    expect(queryByText(/予定B/)).toBeNull();
    expect(getByText(/予定C/)).toBeTruthy();
  });

  test("予定化するボタン → onSetVisibilityOverride('shown')", async () => {
    const cb = vi.fn().mockResolvedValue(undefined);
    const { getAllByRole } = render(
      <EventManagement events={[eventB]} subscriptions={[subWork]} onSetVisibilityOverride={cb} />,
    );
    // eventB は default 非表示 (auto_promote=false, override=none) → button: 予定化する
    const btn = getAllByRole("button", { name: "予定化する" })[0];
    fireEvent.click(btn);
    await waitFor(() => {
      expect(cb).toHaveBeenCalledWith("ev-B", "shown");
    });
  });

  test("予定化解除ボタン → onSetVisibilityOverride('hidden')", async () => {
    const cb = vi.fn().mockResolvedValue(undefined);
    const { getAllByRole } = render(
      <EventManagement events={[eventA]} subscriptions={[sub]} onSetVisibilityOverride={cb} />,
    );
    const btn = getAllByRole("button", { name: "予定化解除" })[0];
    fireEvent.click(btn);
    await waitFor(() => {
      expect(cb).toHaveBeenCalledWith("ev-A", "hidden");
    });
  });

  test("空の場合は空メッセージを表示", () => {
    const { getByText } = render(
      <EventManagement events={[]} subscriptions={[]} onSetVisibilityOverride={vi.fn()} />,
    );
    expect(getByText(/取り込み済みの予定がありません/)).toBeTruthy();
  });

  test("カレンダー displayName が表示される (subscription とのマッチ経由)", () => {
    const { getAllByText } = render(
      <EventManagement
        events={[eventA, eventB]}
        subscriptions={[sub, subWork]}
        onSetVisibilityOverride={vi.fn()}
      />,
    );
    expect(getAllByText("Primary").length).toBeGreaterThan(0);
    expect(getAllByText("Work").length).toBeGreaterThan(0);
  });
});
