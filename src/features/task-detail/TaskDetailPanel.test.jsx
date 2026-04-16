import { fireEvent, render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { TaskDetailPanel } from "./TaskDetailPanel.jsx";

const baseTask = {
  id: "t1",
  project: "slo",
  title: "Test Task",
  size: "M",
  done: false,
  dependsOn: null,
  body: "## Test body\n\n本文",
};

const noop = () => {};

function renderPanel(overrides = {}) {
  const props = {
    task: baseTask,
    events: [],
    onClose: noop,
    onUpdate: noop,
    onToggleDone: noop,
    ...overrides,
  };
  return render(<TaskDetailPanel {...props} />);
}

describe("TaskDetailPanel", () => {
  test("タスクタイトルとプロジェクト名を表示する", () => {
    const { getByText } = renderPanel();
    expect(getByText("Test Task")).toBeTruthy();
    expect(getByText("SLO推進")).toBeTruthy();
  });

  test("未完了時は「完了にする」ボタン", () => {
    const { getByText } = renderPanel();
    expect(getByText("完了にする")).toBeTruthy();
  });

  test("完了済みは「未完了に戻す」ボタン", () => {
    const { getByText } = renderPanel({ task: { ...baseTask, done: true } });
    expect(getByText("未完了に戻す")).toBeTruthy();
  });

  test("編集ボタン押下で保存・キャンセルボタンに切り替わる", () => {
    const { getByText, queryByText } = renderPanel();
    fireEvent.click(getByText("編集"));
    expect(getByText("保存")).toBeTruthy();
    expect(getByText("キャンセル")).toBeTruthy();
    expect(queryByText("編集")).toBeNull();
  });

  test("編集→textarea更新→保存で onUpdate(taskId, draft) が呼ばれる", () => {
    const onUpdate = vi.fn();
    const { getByText, getByPlaceholderText } = renderPanel({ onUpdate });
    fireEvent.click(getByText("編集"));
    const textarea = getByPlaceholderText(/Markdown/);
    fireEvent.change(textarea, { target: { value: "## Updated" } });
    fireEvent.click(getByText("保存"));
    expect(onUpdate).toHaveBeenCalledWith("t1", "## Updated");
  });

  test("キャンセルで編集モード解除（onUpdate は呼ばれない）", () => {
    const onUpdate = vi.fn();
    const { getByText } = renderPanel({ onUpdate });
    fireEvent.click(getByText("編集"));
    fireEvent.click(getByText("キャンセル"));
    expect(getByText("編集")).toBeTruthy();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  test("完了ボタンで onToggleDone(taskId) と onClose が呼ばれる", () => {
    const onToggleDone = vi.fn();
    const onClose = vi.fn();
    const { getByText } = renderPanel({ onToggleDone, onClose });
    fireEvent.click(getByText("完了にする"));
    expect(onToggleDone).toHaveBeenCalledWith("t1");
    expect(onClose).toHaveBeenCalled();
  });

  test("dependsOn がある場合、依存イベントの時刻バッジを表示", () => {
    const events = [{ id: "e1", time: "14:00", endTime: "15:00", title: "MTG" }];
    const { getByText } = renderPanel({
      task: { ...baseTask, dependsOn: "e1" },
      events,
    });
    expect(getByText("← 14:00までに")).toBeTruthy();
  });

  test("body が空なら「詳細を追加...」プレースホルダー", () => {
    const { getByText } = renderPanel({ task: { ...baseTask, body: "" } });
    expect(getByText("詳細を追加...")).toBeTruthy();
  });
});
