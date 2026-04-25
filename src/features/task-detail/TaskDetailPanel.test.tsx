import { fireEvent, render as rtlRender } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Task } from "../../entities/task/types";
import type { Event } from "../../entities/event/types";
import type { Project } from "../../entities/project/types";
import { ProjectsProvider } from "../../entities/project/ProjectsContext";
import { TaskDetailPanel, type TaskDetailPanelProps } from "./TaskDetailPanel";

// 依存イベント表示は現在時刻依存。テストは固定時刻 2026-04-11T09:00 で評価する。
const FIXED_NOW = new Date("2026-04-11T09:00:00");
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

const projects: Project[] = [
  { id: "slo", name: "SLO推進", color: "#2D9F45", isPrimary: true, createdAt: "" },
];
const render = (ui: React.ReactElement) =>
  rtlRender(<ProjectsProvider projects={projects}>{ui}</ProjectsProvider>);

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

  test("dependsOnEventId がある場合、依存イベントの相対時刻 + タイトルバッジを表示", () => {
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
    expect(getByText(/今日 14:00 MTG/)).toBeTruthy();
  });

  test("onChangeDependency 未指定なら依存編集 UI を表示しない", () => {
    const { queryByText } = renderPanel();
    expect(queryByText("依存イベント")).toBeNull();
  });

  test("onChangeDependency 指定時は依存編集ボタンを表示する", () => {
    const { getByText } = renderPanel({ onChangeDependency: vi.fn() });
    expect(getByText("依存イベント")).toBeTruthy();
    expect(getByText(/なし.*を変更/)).toBeTruthy();
  });

  test("依存編集 → 未来イベントを選択すると onChangeDependency(taskId, eventId) を呼ぶ", () => {
    const onChangeDependency = vi.fn();
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
    const { getByText, getByRole } = renderPanel({
      events,
      onChangeDependency,
    });
    fireEvent.click(getByText(/なし.*を変更/));
    fireEvent.change(getByRole("combobox"), { target: { value: "e1" } });
    expect(onChangeDependency).toHaveBeenCalledWith("t1", "e1");
  });

  test("依存設定済 → 「なし」を選ぶと onChangeDependency(taskId, null) を呼ぶ", () => {
    const onChangeDependency = vi.fn();
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
    const { getByText, getByRole } = renderPanel({
      task: { ...baseTask, dependsOnEventId: "e1" },
      events,
      onChangeDependency,
    });
    fireEvent.click(getByText(/MTG.*を変更/));
    fireEvent.change(getByRole("combobox"), { target: { value: "" } });
    expect(onChangeDependency).toHaveBeenCalledWith("t1", null);
  });

  test("依存先未設定の編集候補に過去イベントは出ない", () => {
    const past: Event = {
      id: "past",
      title: "過去MTG",
      startTime: "2026-04-10T14:00:00",
      endTime: "2026-04-10T15:00:00",
      projectId: "slo",
      meetUrl: null,
      hasAttachments: false,
      description: "",
      source: "manual",
      externalId: null,
      createdAt: "2026-04-09T00:00:00",
    };
    const future: Event = {
      id: "future",
      title: "未来MTG",
      startTime: "2026-04-12T10:00:00",
      endTime: "2026-04-12T11:00:00",
      projectId: "slo",
      meetUrl: null,
      hasAttachments: false,
      description: "",
      source: "manual",
      externalId: null,
      createdAt: "2026-04-09T00:00:00",
    };
    const { getByText, queryByText } = renderPanel({
      events: [past, future],
      onChangeDependency: vi.fn(),
    });
    fireEvent.click(getByText(/なし.*を変更/));
    expect(queryByText(/過去MTG/)).toBeNull();
    expect(getByText(/未来MTG/)).toBeTruthy();
  });

  test("依存先が過去イベント (削除されず残ってる) の場合は候補に保持される", () => {
    const past: Event = {
      id: "past",
      title: "過去MTG",
      startTime: "2026-04-10T14:00:00",
      endTime: "2026-04-10T15:00:00",
      projectId: "slo",
      meetUrl: null,
      hasAttachments: false,
      description: "",
      source: "manual",
      externalId: null,
      createdAt: "2026-04-09T00:00:00",
    };
    const future: Event = {
      id: "future",
      title: "未来MTG",
      startTime: "2026-04-12T10:00:00",
      endTime: "2026-04-12T11:00:00",
      projectId: "slo",
      meetUrl: null,
      hasAttachments: false,
      description: "",
      source: "manual",
      externalId: null,
      createdAt: "2026-04-09T00:00:00",
    };
    const { getByText, getAllByRole } = renderPanel({
      task: { ...baseTask, dependsOnEventId: "past" },
      events: [past, future],
      onChangeDependency: vi.fn(),
    });
    fireEvent.click(getByText(/過去MTG.*を変更/));
    const options = getAllByRole("option");
    const labels = options.map((o) => o.textContent ?? "");
    expect(labels.some((l) => l.includes("過去MTG"))).toBe(true);
    expect(labels.some((l) => l.includes("未来MTG"))).toBe(true);
  });

  test("dependsOnEventId が events に無い (削除済) 場合は依存表示を出さない", () => {
    const { queryByText } = renderPanel({
      task: { ...baseTask, dependsOnEventId: "missing" },
      events: [],
    });
    // ヘッダの依存バッジは出ない (event 解決失敗 → null)
    expect(queryByText(/MTG/)).toBeNull();
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
