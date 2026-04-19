import { fireEvent, render as rtlRender } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { Event } from "../../entities/event/types";
import type { Project } from "../../entities/project/types";
import { ProjectsProvider } from "../../entities/project/ProjectsContext";
import { EventDetailPanel } from "./EventDetailPanel";

const projects: Project[] = [
  { id: "slo", name: "SLO推進", color: "#2D9F45", isPrimary: true, createdAt: "" },
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

const noop = () => {};

function renderPanel(overrides: Partial<{ event: Event; onClose: () => void }> = {}) {
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
});
