import { fireEvent, render as rtlRender } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { DoneList } from "./DoneList";
import { TaskRow } from "./TaskRow";
import { TaskStack } from "./TaskStack";
import { TopTaskCard } from "./TopTaskCard";
import type { Task } from "../../entities/task/types";
import type { Event } from "../../entities/event/types";
import type { Project } from "../../entities/project/types";
import { ProjectsProvider } from "../../entities/project/ProjectsContext";

const projects: Project[] = [
  { id: "slo", name: "SLO推進", color: "#2D9F45", isPrimary: true, createdAt: "" },
];
const render = (ui: React.ReactElement) =>
  rtlRender(<ProjectsProvider projects={projects}>{ui}</ProjectsProvider>);

const baseTask: Task = {
  id: "t1",
  projectId: "slo",
  title: "SLI 定義更新",
  body: "## やること\n\n要件整理",
  estimatedMinutes: 45,
  status: "idle",
  stackOrder: 0,
  dependsOnEventId: null,
  isInterruption: false,
  parentTaskId: null,
  createdAt: "2026-04-11T00:00:00",
  completedAt: null,
};

const baseEvent: Event = {
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
};

const noop = () => {};

describe("TopTaskCard", () => {
  test("タイトルとプロジェクト名を表示", () => {
    const { getByText } = render(
      <TopTaskCard
        task={baseTask}
        events={[]}
        isBeingDragged={false}
        onPointerDown={noop}
        onClick={noop}
        onToggleDone={noop}
      />,
    );
    expect(getByText("SLI 定義更新")).toBeTruthy();
    expect(getByText("SLO推進")).toBeTruthy();
  });

  test("dependsOnEventId の依存イベントを解決してバッジ表示", () => {
    const events: Event[] = [baseEvent];
    const { getByText } = render(
      <TopTaskCard
        task={{ ...baseTask, dependsOnEventId: "e1" }}
        events={events}
        isBeingDragged={false}
        onPointerDown={noop}
        onClick={noop}
        onToggleDone={noop}
      />,
    );
    expect(getByText("← 14:00までに")).toBeTruthy();
  });

  test("body の先頭非見出し行をプレビュー表示", () => {
    const { getByText } = render(
      <TopTaskCard
        task={baseTask}
        events={[]}
        isBeingDragged={false}
        onPointerDown={noop}
        onClick={noop}
        onToggleDone={noop}
      />,
    );
    expect(getByText("要件整理")).toBeTruthy();
  });

  test("完了ボタンで onToggleDone、body/Grip クリックは伝播しない", () => {
    const onClick = vi.fn();
    const onToggleDone = vi.fn();
    const { container } = render(
      <TopTaskCard
        task={baseTask}
        events={[]}
        isBeingDragged={false}
        onPointerDown={noop}
        onClick={onClick}
        onToggleDone={onToggleDone}
      />,
    );
    const button = container.querySelector("button")!;
    fireEvent.click(button);
    expect(onToggleDone).toHaveBeenCalledTimes(1);
    // stopPropagation により onClick (カード全体) は発火しない
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("TaskRow", () => {
  test("タイトルと見積もり時間を表示", () => {
    const { getByText } = render(
      <TaskRow
        task={baseTask}
        isBeingDragged={false}
        onPointerDown={noop}
        onClick={noop}
        onToggleDone={noop}
      />,
    );
    expect(getByText("SLI 定義更新")).toBeTruthy();
    // estimatedMinutes=45 → fmtDuration → "45m"
    expect(getByText("45m")).toBeTruthy();
  });

  test("dependsOnEventId があれば ⏱ アイコンを表示", () => {
    const { getByText } = render(
      <TaskRow
        task={{ ...baseTask, dependsOnEventId: "e1" }}
        isBeingDragged={false}
        onPointerDown={noop}
        onClick={noop}
        onToggleDone={noop}
      />,
    );
    expect(getByText("⏱")).toBeTruthy();
  });
});

describe("DoneList", () => {
  test("空なら何も描画しない", () => {
    const { container } = render(
      <DoneList doneTasks={[]} onOpenDetail={noop} onToggleDone={noop} />,
    );
    expect(container.firstChild).toBeNull();
  });

  test("done タスクのタイトルと「戻す」ボタンを表示", () => {
    const doneTasks: Task[] = [{ ...baseTask, status: "done" }];
    const { getByText } = render(
      <DoneList
        doneTasks={doneTasks}
        onOpenDetail={noop}
        onToggleDone={noop}
      />,
    );
    expect(getByText("SLI 定義更新")).toBeTruthy();
    expect(getByText("戻す")).toBeTruthy();
    expect(getByText(/^\d+$/)).toBeTruthy(); // count バッジ
  });

  test("「戻す」ボタンで onToggleDone(taskId) が呼ばれる", () => {
    const onToggleDone = vi.fn();
    const { getByText } = render(
      <DoneList
        doneTasks={[{ ...baseTask, status: "done" }]}
        onOpenDetail={noop}
        onToggleDone={onToggleDone}
      />,
    );
    fireEvent.click(getByText("戻す"));
    expect(onToggleDone).toHaveBeenCalledWith("t1");
  });
});

describe("TaskStack", () => {
  const pending: Task[] = [
    { ...baseTask, id: "t1", title: "Top task" },
    { ...baseTask, id: "t2", title: "Second task" },
    { ...baseTask, id: "t3", title: "Third task" },
  ];

  test("pendingTasks を全て表示し、カウントが正しい", () => {
    const { getByText, getAllByText } = render(
      <TaskStack
        events={[]}
        pendingTasks={pending}
        doneTasks={[]}
        onReorder={noop}
        onToggleDone={noop}
        onOpenDetail={noop}
      />,
    );
    expect(getByText("Top task")).toBeTruthy();
    expect(getByText("Second task")).toBeTruthy();
    expect(getByText("Third task")).toBeTruthy();
    expect(getAllByText("3")).toBeTruthy();
  });

  test("done が混在すると DoneList も表示される", () => {
    const doneTasks: Task[] = [
      { ...baseTask, id: "t9", title: "Completed", status: "done" },
    ];
    const { getByText } = render(
      <TaskStack
        events={[]}
        pendingTasks={pending}
        doneTasks={doneTasks}
        onReorder={noop}
        onToggleDone={noop}
        onOpenDetail={noop}
      />,
    );
    expect(getByText("Completed")).toBeTruthy();
    expect(getByText("戻す")).toBeTruthy();
  });

  test("Top タスクのクリックで onOpenDetail(taskId) が呼ばれる", () => {
    const onOpenDetail = vi.fn();
    const { getByText } = render(
      <TaskStack
        events={[]}
        pendingTasks={pending}
        doneTasks={[]}
        onReorder={noop}
        onToggleDone={noop}
        onOpenDetail={onOpenDetail}
      />,
    );
    fireEvent.click(getByText("Top task"));
    expect(onOpenDetail).toHaveBeenCalledWith("t1");
  });
});
