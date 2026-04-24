import { fireEvent, render as rtlRender } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { Event } from "../../entities/event/types";
import type { Project } from "../../entities/project/types";
import { ProjectsProvider } from "../../entities/project/ProjectsContext";
import { EventDetailPanel } from "./EventDetailPanel";

const projects: Project[] = [
  { id: "slo", name: "SLO推進", color: "#2D9F45", isPrimary: true, createdAt: "" },
  { id: "career", name: "転職活動", color: "#E85D04", isPrimary: false, createdAt: "" },
];
const render = (ui: React.ReactElement) =>
  rtlRender(<ProjectsProvider projects={projects}>{ui}</ProjectsProvider>);

const baseEvent: Event = {
  id: "e1",
  title: "SLO レビュー",
  startTime: "2026-04-11T10:00:00",
  endTime: "2026-04-11T11:00:00",
  projectId: "slo",
  meetUrl: null,
  hasAttachments: false,
  description: "## アジェンダ\n\n本文",
  source: "manual",
  externalId: null,
  createdAt: "2026-04-11T00:00:00",
};

const googleEvent: Event = {
  ...baseEvent,
  id: "g1",
  source: "google_calendar",
  externalId: "ext-1",
};

const noop = () => {};

function renderPanel(
  overrides: Partial<{
    event: Event;
    onClose: () => void;
    onChangeProject: (id: string, projectId: string | null) => void;
  }> = {},
) {
  const props = { event: baseEvent, onClose: noop, ...overrides };
  return render(<EventDetailPanel {...props} />);
}

describe("EventDetailPanel", () => {
  test("タイトル・プロジェクト名・時刻レンジを表示", () => {
    const { getByText } = renderPanel();
    expect(getByText("SLO レビュー")).toBeTruthy();
    expect(getByText("SLO推進")).toBeTruthy();
    expect(getByText(/10:00–11:00/)).toBeTruthy();
  });

  test("projectId なしの event ではプロジェクトバッジを非表示", () => {
    const { queryByText } = renderPanel({
      event: { ...baseEvent, projectId: null },
    });
    expect(queryByText("SLO推進")).toBeNull();
  });

  test("Meet URL (google meet) の参加ボタンを表示", () => {
    const { getByText } = renderPanel({
      event: { ...baseEvent, meetUrl: "https://meet.google.com/abc-defg-hij" },
    });
    expect(getByText("Google Meetに参加")).toBeTruthy();
  });

  test("Meet URL (zoom) の参加ボタンを表示", () => {
    const { getByText } = renderPanel({
      event: { ...baseEvent, meetUrl: "https://zoom.us/j/123" },
    });
    expect(getByText("Zoomに参加")).toBeTruthy();
  });

  test("Meet URL なしなら参加ボタンは表示されない", () => {
    const { queryByText } = renderPanel();
    expect(queryByText(/に参加$/)).toBeNull();
  });

  test("hasAttachments=true なら「添付資料あり」を表示", () => {
    const { getByText } = renderPanel({
      event: { ...baseEvent, hasAttachments: true },
    });
    expect(getByText("添付資料あり")).toBeTruthy();
  });

  test("hasAttachments=false なら添付バッジを表示しない", () => {
    const { queryByText } = renderPanel();
    expect(queryByText("添付資料あり")).toBeNull();
  });

  test("description が空なら「詳細なし」", () => {
    const { getByText } = renderPanel({
      event: { ...baseEvent, description: "" },
    });
    expect(getByText("詳細なし")).toBeTruthy();
  });

  test("description は Markdown としてレンダーされる", () => {
    const { getByText } = renderPanel();
    expect(getByText("アジェンダ")).toBeTruthy();
  });

  test("backdrop クリックで onClose が呼ばれる", () => {
    const onClose = vi.fn();
    const { container } = renderPanel({ onClose });
    // Backdrop は fixed コンテナの最初の子 div
    const backdrop = container.firstElementChild!.firstElementChild!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  // ADR 0010 / P2-4: source 別の編集制約
  describe("source による表示・編集制約", () => {
    test("manual: Google バッジ・補足テキスト・project 編集 UI を出さない", () => {
      const { queryByTestId, queryByText } = renderPanel({
        onChangeProject: vi.fn(),
      });
      expect(queryByTestId("google-calendar-badge")).toBeNull();
      expect(
        queryByText(/Google Calendar で編集した内容は次回同期で反映されます/),
      ).toBeNull();
      expect(queryByText(/を変更$/)).toBeNull();
    });

    test("google_calendar: Google バッジと同期補足テキストを出す", () => {
      const { getByTestId, getByText } = renderPanel({ event: googleEvent });
      expect(getByTestId("google-calendar-badge")).toBeTruthy();
      expect(
        getByText(/Google Calendar で編集した内容は次回同期で反映されます/),
      ).toBeTruthy();
    });

    test("google_calendar: onChangeProject 未指定なら project 編集 UI を出さない", () => {
      const { queryByText } = renderPanel({ event: googleEvent });
      expect(queryByText(/を変更$/)).toBeNull();
    });

    test("google_calendar: project 変更ボタンから select に切り替わる", () => {
      const onChangeProject = vi.fn();
      const { getByText, getByRole } = renderPanel({
        event: googleEvent,
        onChangeProject,
      });
      fireEvent.click(getByText(/を変更$/));
      const select = getByRole("combobox") as HTMLSelectElement;
      expect(select.value).toBe("slo");
    });

    test("google_calendar: select で project を変えると onChangeProject が呼ばれる", () => {
      const onChangeProject = vi.fn();
      const { getByText, getByRole } = renderPanel({
        event: googleEvent,
        onChangeProject,
      });
      fireEvent.click(getByText(/を変更$/));
      fireEvent.change(getByRole("combobox"), { target: { value: "career" } });
      expect(onChangeProject).toHaveBeenCalledWith("g1", "career");
    });

    test("google_calendar: project を「なし」にすると null で呼ばれる", () => {
      const onChangeProject = vi.fn();
      const { getByText, getByRole } = renderPanel({
        event: googleEvent,
        onChangeProject,
      });
      fireEvent.click(getByText(/を変更$/));
      fireEvent.change(getByRole("combobox"), { target: { value: "" } });
      expect(onChangeProject).toHaveBeenCalledWith("g1", null);
    });

    test("どの source でも「削除」ボタンは表示されない", () => {
      const m = renderPanel();
      expect(m.queryByText("削除")).toBeNull();
      const g = renderPanel({
        event: googleEvent,
        onChangeProject: vi.fn(),
      });
      expect(g.queryByText("削除")).toBeNull();
    });
  });
});
