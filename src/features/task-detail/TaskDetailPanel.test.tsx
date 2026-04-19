import { fireEvent, render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { Task } from "../../entities/task/types";
import type { Event } from "../../entities/event/types";
import { TaskDetailPanel, type TaskDetailPanelProps } from "./TaskDetailPanel";

const baseTask: Task = {
  id: "t1",
  projectId: "slo",
  title: "Test Task",
  body: "## Test body\n\n本文",
  estimatedMinutes: 45,
  status: "idle",
  stackOrder: 0,
  dependsOnEventId: null,
  isInterruption: false,
  parentTaskId: null,
  createdAt: "2026-04-11T00:00:00",
  completedAt: null,
};

const noop = () => {};

function renderPanel(overrides: Partial<TaskDetailPanelProps> = {}) {
  const props: TaskDetailPanelProps = {
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
    const { getByText } = renderPanel({
      task: { ...baseTask, status: "done" },
    });
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

  test("dependsOnEventId がある場合、依存イベントの時刻バッジを表示", () => {
    const events: Event[] = [
      {
        id: "e1",
        title: "MTG",
        startTime: "2026-04-11T14:00:00",
        endTime: "2026-04-11T15:00:00",
        projectId: "slo",
        meetUrl: null,
        hasAttachments: false,
        description: "",
        source: "manual",
        externalId: null,
        createdAt: "2026-04-11T00:00:00",
      },
    ];
    const { getByText } = renderPanel({
      task: { ...baseTask, dependsOnEventId: "e1" },
      events,
    });
    expect(getByText("← 14:00までに")).toBeTruthy();
  });

  test("body が空なら「詳細を追加...」プレースホルダー", () => {
    const { getByText } = renderPanel({ task: { ...baseTask, body: "" } });
    expect(getByText("詳細を追加...")).toBeTruthy();
  });

  test("estimatedMinutes を fmtDuration で表示", () => {
    const { getByText } = renderPanel({
      task: { ...baseTask, estimatedMinutes: 90 },
    });
    expect(getByText("1h30m")).toBeTruthy();
  });
});
