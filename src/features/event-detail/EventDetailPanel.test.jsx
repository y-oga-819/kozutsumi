import { fireEvent, render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { EventDetailPanel } from "./EventDetailPanel.jsx";

const baseEvent = {
  id: "e1",
  title: "SLO レビュー",
  time: "10:00",
  endTime: "11:00",
  project: "slo",
  description: "## アジェンダ\n\n本文",
};

const noop = () => {};

function renderPanel(overrides = {}) {
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

  test("project なしの event ではプロジェクトバッジを非表示", () => {
    const { queryByText } = renderPanel({
      event: { ...baseEvent, project: undefined },
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

  test("attachments があればファイル名を表示", () => {
    const { getByText } = renderPanel({
      event: { ...baseEvent, attachments: ["仕様書.pdf", "議事録.docx"] },
    });
    expect(getByText("仕様書.pdf")).toBeTruthy();
    expect(getByText("議事録.docx")).toBeTruthy();
    expect(getByText("添付資料")).toBeTruthy();
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
    // Backdrop は fixed の最初の子 div
    const backdrop = container.querySelector('[style*="position: absolute"]');
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });
});
