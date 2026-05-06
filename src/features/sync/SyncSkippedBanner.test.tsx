import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";

import type { SkippedEvent } from "@/entities/event/sync";

import { SyncSkippedBanner } from "./SyncSkippedBanner";
import { SKIPPED_EVENTS_QUERY_KEY } from "./skippedEventsCache";

function makeWrapper(initialSkipped: SkippedEvent[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(SKIPPED_EVENTS_QUERY_KEY, initialSkipped);
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { Wrapper, queryClient };
}

const SAMPLE_SKIPPED: SkippedEvent[] = [
  {
    externalCalendarId: "shared@group.calendar.google.com",
    externalId: "evt-zero",
    title: "ゼロ長会議",
    reason: "invalid_time_range",
  },
  {
    externalCalendarId: "shared@group.calendar.google.com",
    externalId: "evt-no-time",
    title: undefined,
    reason: "missing_time",
  },
];

describe("SyncSkippedBanner", () => {
  test("skipped が空のときは何もレンダーしない", () => {
    const { Wrapper } = makeWrapper([]);
    render(<SyncSkippedBanner />, { wrapper: Wrapper });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("skipped がある時に role=alert で件数を表示する", () => {
    const { Wrapper } = makeWrapper(SAMPLE_SKIPPED);
    render(<SyncSkippedBanner />, { wrapper: Wrapper });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("2 件の予定を取り込めませんでした");
  });

  test("「詳細」を押すと dialog が開き、各 skipped の title と reason 文言が出る", () => {
    const { Wrapper } = makeWrapper(SAMPLE_SKIPPED);
    render(<SyncSkippedBanner />, { wrapper: Wrapper });

    fireEvent.click(screen.getByRole("button", { name: "詳細" }));

    const dialog = screen.getByRole("dialog", { name: "取り込めなかった予定" });
    expect(dialog.textContent).toContain("ゼロ長会議");
    expect(dialog.textContent).toContain("(タイトルなし)");
    expect(dialog.textContent).toContain("終了時刻が開始時刻と同じか前");
    expect(dialog.textContent).toContain("開始 / 終了時刻が設定されていません");
  });

  test("「バナーを閉じる」を押すとキャッシュが空になりバナーが消える", async () => {
    const { Wrapper, queryClient } = makeWrapper(SAMPLE_SKIPPED);
    render(<SyncSkippedBanner />, { wrapper: Wrapper });

    fireEvent.click(screen.getByRole("button", { name: "バナーを閉じる" }));

    expect(queryClient.getQueryData(SKIPPED_EVENTS_QUERY_KEY)).toEqual([]);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});
