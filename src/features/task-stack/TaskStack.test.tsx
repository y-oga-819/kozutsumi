import { fireEvent, render as rtlRender } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { Event } from "@/entities/event/types";
import { ProjectsProvider } from "@/entities/project/ProjectsContext";
import type { Project } from "@/entities/project/types";
import type { Task } from "@/entities/task/types";

import { DoneList } from "./DoneList";
import { TaskRow } from "./TaskRow";
import { TaskStack, type TopTimerBinding } from "./TaskStack";
import { TopTaskCard } from "./TopTaskCard";

// 依存イベントの相対時刻表現は「現在時刻」依存。テストは固定時刻 2026-04-11T09:00 で評価する。
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
  { id: "career", name: "転職活動", color: "#E85D04", isPrimary: false, createdAt: "" },
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
  decomposeStatus: "none",
  taskCategory: null,
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

const idleTimer: TopTimerBinding = {
  elapsedSeconds: 0,
  pauseReason: null,
  onStart: noop,
  onPauseRequest: noop,
  onResume: noop,
  onComplete: noop,
};

const NOW_MS = FIXED_NOW.getTime();

const topProps = {
  events: [] as Event[],
  now: NOW_MS,
  isBeingDragged: false,
  elapsedSeconds: 0,
  pauseReason: null,
  onPointerDown: noop,
  onClick: noop,
  onStart: noop,
  onPauseRequest: noop,
  onResume: noop,
  onComplete: noop,
};

describe("TopTaskCard", () => {
  test("タイトルとプロジェクト名を表示", () => {
    const { getByText } = render(<TopTaskCard {...topProps} task={baseTask} />);
    expect(getByText("SLI 定義更新")).toBeTruthy();
    expect(getByText("SLO推進")).toBeTruthy();
  });

  test("dependsOnEventId の依存イベントを解決してバッジ表示", () => {
    const { getByText } = render(
      <TopTaskCard
        {...topProps}
        task={{ ...baseTask, dependsOnEventId: "e1" }}
        events={[baseEvent]}
      />,
    );
    expect(getByText(/今日 14:00 MTG/)).toBeTruthy();
  });

  test("body の先頭非見出し行をプレビュー表示", () => {
    const { getByText } = render(<TopTaskCard {...topProps} task={baseTask} />);
    expect(getByText("要件整理")).toBeTruthy();
  });

  test("idle タスクでも『開始』+『完了』ボタンを表示する (Top-only complete; ADR 0016 §7)", () => {
    const onStart = vi.fn();
    const onComplete = vi.fn();
    const { getByLabelText } = render(
      <TopTaskCard {...topProps} task={baseTask} onStart={onStart} onComplete={onComplete} />,
    );
    fireEvent.click(getByLabelText("開始"));
    expect(onStart).toHaveBeenCalledTimes(1);
    fireEvent.click(getByLabelText("完了"));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  test("active タスクは中断/完了ボタンと経過時間を表示する", () => {
    const onPauseRequest = vi.fn();
    const onComplete = vi.fn();
    const { getByLabelText, getByText } = render(
      <TopTaskCard
        {...topProps}
        task={{ ...baseTask, status: "active" }}
        elapsedSeconds={125}
        onPauseRequest={onPauseRequest}
        onComplete={onComplete}
      />,
    );
    expect(getByText("● 02:05")).toBeTruthy();
    fireEvent.click(getByLabelText("中断"));
    expect(onPauseRequest).toHaveBeenCalledTimes(1);
    fireEvent.click(getByLabelText("完了"));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  test("paused タスクは『再開』+『完了』を表示する", () => {
    const onResume = vi.fn();
    const onComplete = vi.fn();
    const { getByLabelText, getByText } = render(
      <TopTaskCard
        {...topProps}
        task={{ ...baseTask, status: "paused" }}
        pauseReason="meeting"
        onResume={onResume}
        onComplete={onComplete}
      />,
    );
    expect(getByText("中断: MTG")).toBeTruthy();
    fireEvent.click(getByLabelText("再開"));
    expect(onResume).toHaveBeenCalledTimes(1);
    fireEvent.click(getByLabelText("完了"));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  test("leaf-child の Top は ⤷ 親 + 進捗バーを下ゾーンに出す", () => {
    const parent: Task = {
      ...baseTask,
      id: "p1",
      title: "面接対策",
      decomposeStatus: "decomposed",
    };
    const child: Task = { ...baseTask, id: "c1", title: "志望動機A", parentTaskId: "p1" };
    const { getByText, getByRole } = render(
      <TopTaskCard
        {...topProps}
        task={child}
        parent={parent}
        progress={{ total: 3, doneCount: 1, currentIndex: 2, totalMinutes: 90 }}
      />,
    );
    expect(getByText(/⤷ 面接対策/)).toBeTruthy();
    const bar = getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("1");
    expect(bar.getAttribute("aria-valuemax")).toBe("3");
    expect(bar.getAttribute("aria-label")).toMatch(/進捗 1\/3、現在 2\/3/);
  });

  test("leaf-parent (decomposing) の Top は status pill を上ゾーンに出す (issue #109)", () => {
    const { getByRole, queryByText, container } = render(
      <TopTaskCard {...topProps} task={{ ...baseTask, decomposeStatus: "decomposing" }} />,
    );
    expect(getByRole("status").textContent).toContain("AI 分解中");
    expect(queryByText(/⤷ /)).toBeNull();
    // 下ゾーン (border-top + Row 2 のスロット) は描画しない (issue #109)
    expect(container.querySelector(".border-t")).toBeNull();
  });

  test("leaf-parent (failed) の Top は『分解失敗』pill を上ゾーンに出す (ADR 0021 §3 / issue #109)", () => {
    const { getByText, queryByRole, container } = render(
      <TopTaskCard {...topProps} task={{ ...baseTask, decomposeStatus: "failed" }} />,
    );
    expect(getByText("分解失敗")).toBeTruthy();
    // failed は終端状態なので role=status (live region) は付けない
    expect(queryByRole("status")).toBeNull();
    // 下ゾーンは描画しない
    expect(container.querySelector(".border-t")).toBeNull();
  });

  test("leaf-parent + dep がある Top は下ゾーンに dep だけ出す (status pill は上ゾーン)", () => {
    const { getByText, queryByText, container } = render(
      <TopTaskCard
        {...topProps}
        task={{ ...baseTask, decomposeStatus: "none", dependsOnEventId: "e1" }}
        events={[baseEvent]}
      />,
    );
    expect(getByText(/今日 14:00 MTG/)).toBeTruthy();
    expect(getByText("未分解")).toBeTruthy();
    // dep があるので下ゾーンは描画される
    expect(container.querySelector(".border-t")).not.toBeNull();
    // ⤷ 親 / 進捗バーは leaf-parent では出ない
    expect(queryByText(/⤷ /)).toBeNull();
  });

  test("子の dependsOnEventId が null なら親の dep を継承する (ADR 0016 §6)", () => {
    const parent: Task = {
      ...baseTask,
      id: "p1",
      title: "面接対策",
      decomposeStatus: "decomposed",
      dependsOnEventId: "e1",
    };
    const child: Task = { ...baseTask, id: "c1", title: "志望動機A", parentTaskId: "p1" };
    const { getByText } = render(
      <TopTaskCard
        {...topProps}
        task={child}
        parent={parent}
        events={[baseEvent]}
        progress={{ total: 1, doneCount: 0, currentIndex: 1, totalMinutes: 30 }}
      />,
    );
    expect(getByText(/今日 14:00 MTG/)).toBeTruthy();
  });
});

describe("TaskRow", () => {
  test("タイトルと見積もり時間を表示", () => {
    const { getByText } = render(
      <TaskRow
        task={baseTask}
        events={[]}
        now={NOW_MS}
        isBeingDragged={false}
        onPointerDown={noop}
        onClick={noop}
      />,
    );
    expect(getByText("SLI 定義更新")).toBeTruthy();
    // estimatedMinutes=45 → fmtDuration → "45m"
    expect(getByText("45m")).toBeTruthy();
  });

  test("完了 checkbox は表示しない (Top-only complete; ADR 0016 §7)", () => {
    const { queryByLabelText } = render(
      <TaskRow
        task={baseTask}
        events={[]}
        now={NOW_MS}
        isBeingDragged={false}
        onPointerDown={noop}
        onClick={noop}
      />,
    );
    expect(queryByLabelText("完了")).toBeNull();
    expect(queryByLabelText("SLI 定義更新 を完了")).toBeNull();
  });

  test("dependsOnEventId があれば「相対時刻 + タイトル」のバッジを表示", () => {
    const { getByText } = render(
      <TaskRow
        task={{ ...baseTask, dependsOnEventId: "e1" }}
        events={[baseEvent]}
        now={NOW_MS}
        isBeingDragged={false}
        onPointerDown={noop}
        onClick={noop}
      />,
    );
    expect(getByText(/今日 14:00 MTG/)).toBeTruthy();
  });

  test("依存イベントが events に無い (削除済) 場合はバッジを表示しない", () => {
    const { queryByText } = render(
      <TaskRow
        task={{ ...baseTask, dependsOnEventId: "missing" }}
        events={[]}
        now={NOW_MS}
        isBeingDragged={false}
        onPointerDown={noop}
        onClick={noop}
      />,
    );
    expect(queryByText(/MTG/)).toBeNull();
    expect(queryByText(/今日/)).toBeNull();
  });

  test("leaf-child の行カードは ⤷ 親 + 進捗バーを Row 3 に出す", () => {
    const parent: Task = {
      ...baseTask,
      id: "p1",
      title: "面接対策",
      decomposeStatus: "decomposed",
    };
    const child: Task = { ...baseTask, id: "c1", title: "志望動機A", parentTaskId: "p1" };
    const { getByText, getByRole } = render(
      <TaskRow
        task={child}
        events={[]}
        now={NOW_MS}
        isBeingDragged={false}
        parent={parent}
        progress={{ total: 3, doneCount: 1, currentIndex: 2, totalMinutes: 90 }}
        onPointerDown={noop}
        onClick={noop}
      />,
    );
    expect(getByText(/⤷ 面接対策/)).toBeTruthy();
    expect(getByRole("progressbar").getAttribute("aria-label")).toMatch(/進捗 1\/3、現在 2\/3/);
  });

  test("leaf-parent (decomposing) の行カードは status pill を出す", () => {
    const { getByRole } = render(
      <TaskRow
        task={{ ...baseTask, decomposeStatus: "decomposing" }}
        events={[]}
        now={NOW_MS}
        isBeingDragged={false}
        onPointerDown={noop}
        onClick={noop}
      />,
    );
    expect(getByRole("status").textContent).toContain("AI 分解中");
  });

  test("leaf-parent (none) の行カードは『未分解』pill を出す", () => {
    const { getByText } = render(
      <TaskRow
        task={baseTask}
        events={[]}
        now={NOW_MS}
        isBeingDragged={false}
        onPointerDown={noop}
        onClick={noop}
      />,
    );
    expect(getByText("未分解")).toBeTruthy();
  });

  test("leaf-parent (failed) の行カードは『分解失敗』pill を出す (ADR 0021 §3)", () => {
    const { getByText, queryByRole } = render(
      <TaskRow
        task={{ ...baseTask, decomposeStatus: "failed" }}
        events={[]}
        now={NOW_MS}
        isBeingDragged={false}
        onPointerDown={noop}
        onClick={noop}
      />,
    );
    expect(getByText("分解失敗")).toBeTruthy();
    // reason はカード上に出ない（詳細パネルに集約。ADR 0021 §3）
    expect(queryByRole("status")).toBeNull();
  });
});

describe("DoneList", () => {
  test("空なら何も描画しない", () => {
    const { container } = render(
      <DoneList doneTasks={[]} allTasks={[]} onOpenDetail={noop} onToggleDone={noop} />,
    );
    expect(container.firstChild).toBeNull();
  });

  test("done タスクのタイトルと「戻す」ボタンを表示", () => {
    const doneTasks: Task[] = [{ ...baseTask, status: "done" }];
    const { getByText, getByLabelText } = render(
      <DoneList
        doneTasks={doneTasks}
        allTasks={doneTasks}
        onOpenDetail={noop}
        onToggleDone={noop}
      />,
    );
    expect(getByText("SLI 定義更新")).toBeTruthy();
    expect(getByLabelText("SLI 定義更新 を未完了に戻す")).toBeTruthy();
  });

  test("「戻す」ボタンで onToggleDone(taskId) が呼ばれる", () => {
    const onToggleDone = vi.fn();
    const doneTasks: Task[] = [{ ...baseTask, status: "done" }];
    const { getByLabelText } = render(
      <DoneList
        doneTasks={doneTasks}
        allTasks={doneTasks}
        onOpenDetail={noop}
        onToggleDone={onToggleDone}
      />,
    );
    fireEvent.click(getByLabelText("SLI 定義更新 を未完了に戻す"));
    expect(onToggleDone).toHaveBeenCalledWith("t1");
  });

  test("子の done は ⤷ 親 + 進捗バー (currentIndex=0) を出す", () => {
    const parent: Task = {
      ...baseTask,
      id: "p1",
      title: "面接対策",
      decomposeStatus: "decomposed",
    };
    const doneChild: Task = {
      ...baseTask,
      id: "c1",
      title: "志望動機A",
      parentTaskId: "p1",
      status: "done",
    };
    const pendingChild: Task = { ...baseTask, id: "c2", title: "志望動機B", parentTaskId: "p1" };
    const { getByRole, getByText } = render(
      <DoneList
        doneTasks={[doneChild]}
        allTasks={[parent, doneChild, pendingChild]}
        onOpenDetail={noop}
        onToggleDone={noop}
      />,
    );
    expect(getByText(/⤷ 面接対策/)).toBeTruthy();
    const bar = getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("1");
    expect(bar.getAttribute("aria-valuemax")).toBe("2");
    // currentIndex=0 → aria-label に「現在 X/Y」を含まない
    expect(bar.getAttribute("aria-label")).toBe("進捗 1/2");
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
        now={NOW_MS}
        pendingTasks={pending}
        doneTasks={[]}
        topTimer={idleTimer}
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

  test("decomposed 親は Stack 行から消え、子だけがフラットに並ぶ (ADR 0016 §1)", () => {
    const parent: Task = {
      ...baseTask,
      id: "p1",
      title: "面接対策",
      projectId: "career",
      decomposeStatus: "decomposed",
    };
    const c1: Task = {
      ...baseTask,
      id: "c1",
      title: "志望動機A",
      projectId: "career",
      parentTaskId: "p1",
      stackOrder: 1,
    };
    const c2: Task = {
      ...baseTask,
      id: "c2",
      title: "志望動機B",
      projectId: "career",
      parentTaskId: "p1",
      stackOrder: 2,
    };
    const { queryByText, getByText } = render(
      <TaskStack
        events={[]}
        now={NOW_MS}
        pendingTasks={[parent, c1, c2]}
        doneTasks={[]}
        topTimer={idleTimer}
        onReorder={noop}
        onToggleDone={noop}
        onOpenDetail={noop}
      />,
    );
    expect(queryByText("面接対策")).toBeNull(); // 親は Stack 行に出ない
    expect(getByText("志望動機A")).toBeTruthy();
    expect(getByText("志望動機B")).toBeTruthy();
  });

  test("done が混在すると DoneList も表示される", () => {
    const doneTasks: Task[] = [{ ...baseTask, id: "t9", title: "Completed", status: "done" }];
    const { getByText } = render(
      <TaskStack
        events={[]}
        now={NOW_MS}
        pendingTasks={pending}
        doneTasks={doneTasks}
        topTimer={idleTimer}
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
        now={NOW_MS}
        pendingTasks={pending}
        doneTasks={[]}
        topTimer={idleTimer}
        onReorder={noop}
        onToggleDone={noop}
        onOpenDetail={onOpenDetail}
      />,
    );
    fireEvent.click(getByText("Top task"));
    expect(onOpenDetail).toHaveBeenCalledWith("t1");
  });
});
