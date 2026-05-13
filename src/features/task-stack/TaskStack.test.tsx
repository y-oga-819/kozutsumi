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
  taskSize: null,
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
  externalCalendarId: "manual",
  visibilityOverride: "none",
  recurringEventId: null,
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
  onInterrupt: noop,
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
  onInterrupt: noop,
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

  // ADR-0059: 1-tap 割り込みは active 中だけ表示する。クリックで onInterrupt が
  // 1 回発火し、reason 選択モーダルは経由しない (= onPauseRequest は呼ばれない)。
  test("active タスクは『割り込み』ボタンも表示し、押下で onInterrupt が発火する", () => {
    const onInterrupt = vi.fn();
    const onPauseRequest = vi.fn();
    const { getByLabelText } = render(
      <TopTaskCard
        {...topProps}
        task={{ ...baseTask, status: "active" }}
        onPauseRequest={onPauseRequest}
        onInterrupt={onInterrupt}
      />,
    );
    fireEvent.click(getByLabelText("割り込み"));
    expect(onInterrupt).toHaveBeenCalledTimes(1);
    expect(onPauseRequest).not.toHaveBeenCalled();
  });

  test("idle / paused では『割り込み』ボタンは表示しない (= active のみ)", () => {
    const { queryByLabelText, rerender } = render(
      <TopTaskCard {...topProps} task={{ ...baseTask, status: "idle" }} />,
    );
    expect(queryByLabelText("割り込み")).toBeNull();
    rerender(
      <TopTaskCard
        {...topProps}
        task={{ ...baseTask, status: "paused" }}
        pauseReason="voluntary"
      />,
    );
    expect(queryByLabelText("割り込み")).toBeNull();
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

  test("leaf-parent (decomposing) の Top は status pill を下ゾーンに出す (TaskRow と位置揃え)", () => {
    const { getByRole, queryByText, container } = render(
      <TopTaskCard {...topProps} task={{ ...baseTask, decomposeStatus: "decomposing" }} />,
    );
    expect(getByRole("status").textContent).toContain("AI 分解中");
    expect(queryByText(/⤷ /)).toBeNull();
    // dep 無しでも status pill のために下ゾーンは描画される (issue #109)
    expect(container.querySelector(".border-t")).not.toBeNull();
  });

  test("leaf-parent (failed) の Top は『分解失敗』pill を下ゾーンに出す (ADR 0021 §3)", () => {
    const { getByText, queryByRole, container } = render(
      <TopTaskCard {...topProps} task={{ ...baseTask, decomposeStatus: "failed" }} />,
    );
    expect(getByText("分解失敗")).toBeTruthy();
    // failed は終端状態なので role=status (live region) は付けない
    expect(queryByRole("status")).toBeNull();
    expect(container.querySelector(".border-t")).not.toBeNull();
  });

  test("leaf-parent (decomposed = 親自身) の Top は下ゾーンを描画しない (issue #109)", () => {
    // decomposed の親が parent prop 無しで Top に来るケースは通常あり得ないが、
    // 念のため status pill も progress も無いときに下ゾーンが消えることを保証する。
    const { container } = render(
      <TopTaskCard {...topProps} task={{ ...baseTask, decomposeStatus: "decomposed" }} />,
    );
    expect(container.querySelector(".border-t")).toBeNull();
  });

  test("leaf-parent + dep がある Top は下ゾーンに dep + status pill を縦並びで出す", () => {
    const { getByText, queryByText, container } = render(
      <TopTaskCard
        {...topProps}
        task={{ ...baseTask, decomposeStatus: "none", dependsOnEventId: "e1" }}
        events={[baseEvent]}
      />,
    );
    expect(getByText(/今日 14:00 MTG/)).toBeTruthy();
    expect(getByText("未分解")).toBeTruthy();
    expect(container.querySelector(".border-t")).not.toBeNull();
    // ⤷ 親 / 進捗バーは leaf-parent では出ない
    expect(queryByText(/⤷ /)).toBeNull();
  });

  test("leaf-child の Top では ⤷ 親が独立行で truncate されない (issue #109)", () => {
    const longParentTitle = "EngagementSupport資料の目的とターゲット顧客を定義する";
    const parent: Task = {
      ...baseTask,
      id: "p1",
      title: longParentTitle,
      decomposeStatus: "decomposed",
    };
    const child: Task = { ...baseTask, id: "c1", title: "志望動機A", parentTaskId: "p1" };
    const { getByText, getByTitle } = render(
      <TopTaskCard
        {...topProps}
        task={child}
        parent={parent}
        progress={{ total: 3, doneCount: 1, currentIndex: 2, totalMinutes: 90 }}
      />,
    );
    // 親名行は truncate せず full な文字列をテキストとして含む
    const parentRow = getByTitle(`親: ${longParentTitle}`);
    expect(parentRow.textContent).toContain(longParentTitle);
    expect(parentRow.className).not.toMatch(/\btruncate\b/);
    // 合計 + progress は別行 (right-aligned) に出る
    expect(getByText(/合計\s/)).toBeTruthy();
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
        onReorderGroup={noop}
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
        onReorderGroup={noop}
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
        onReorderGroup={noop}
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
        onReorderGroup={noop}
        onToggleDone={noop}
        onOpenDetail={onOpenDetail}
      />,
    );
    fireEvent.click(getByText("Top task"));
    expect(onOpenDetail).toHaveBeenCalledWith("t1");
  });

  // ADR-0058 Decision 2「stack top が timer の current task として自動 bind される」
  // を行レンダリング側で守る。任意のタスクを「current task」として明示選択する UI
  // (Top 以外の行の start/pause ボタン等) が増えると本テストで検出する。
  describe("stack top と timer の auto-bind (ADR-0058 Decision 2)", () => {
    test("timer 動詞 (開始/中断/再開/完了) は stack top の行にのみ存在する", () => {
      const { getAllByLabelText, queryAllByLabelText } = render(
        <TaskStack
          events={[]}
          now={NOW_MS}
          // Top: idle (開始 + 完了), Second/Third: idle (動詞ボタン無し)
          pendingTasks={pending}
          doneTasks={[]}
          topTimer={idleTimer}
          onReorder={noop}
          onReorderGroup={noop}
          onToggleDone={noop}
          onOpenDetail={noop}
        />,
      );
      // Top: idle なので 開始 + 完了 が出る (TopTaskCard tests と整合)
      expect(getAllByLabelText("開始")).toHaveLength(1);
      expect(getAllByLabelText("完了")).toHaveLength(1);
      // Top 以外の行 (TaskRow) には timer 動詞ボタンが存在しないこと
      expect(queryAllByLabelText("中断")).toHaveLength(0);
      expect(queryAllByLabelText("再開")).toHaveLength(0);
    });

    test("Top が active でも『中断/完了』ボタンは 1 つだけ (他行に伝播しない)", () => {
      const activePending: Task[] = [
        { ...baseTask, id: "t1", title: "Top task", status: "active" },
        { ...baseTask, id: "t2", title: "Second task" },
        { ...baseTask, id: "t3", title: "Third task" },
      ];
      const { getAllByLabelText, queryAllByLabelText } = render(
        <TaskStack
          events={[]}
          now={NOW_MS}
          pendingTasks={activePending}
          doneTasks={[]}
          topTimer={{ ...idleTimer, elapsedSeconds: 60 }}
          onReorder={noop}
          onReorderGroup={noop}
          onToggleDone={noop}
          onOpenDetail={noop}
        />,
      );
      expect(getAllByLabelText("中断")).toHaveLength(1);
      expect(getAllByLabelText("完了")).toHaveLength(1);
      expect(queryAllByLabelText("開始")).toHaveLength(0);
      expect(queryAllByLabelText("再開")).toHaveLength(0);
    });

    test("Top の『開始』ボタン押下で topTimer.onStart が発火する (Top 経由でのみ結線)", () => {
      const onStart = vi.fn();
      const { getByLabelText } = render(
        <TaskStack
          events={[]}
          now={NOW_MS}
          pendingTasks={pending}
          doneTasks={[]}
          topTimer={{ ...idleTimer, onStart }}
          onReorder={noop}
          onReorderGroup={noop}
          onToggleDone={noop}
          onOpenDetail={noop}
        />,
      );
      fireEvent.click(getByLabelText("開始"));
      expect(onStart).toHaveBeenCalledTimes(1);
    });

    test("pendingTasks の並び順が変わると Top に表示される task が追従する", () => {
      const order1: Task[] = [
        { ...baseTask, id: "t1", title: "Top task" },
        { ...baseTask, id: "t2", title: "Second task" },
      ];
      const { rerender, container, getAllByLabelText } = render(
        <TaskStack
          events={[]}
          now={NOW_MS}
          pendingTasks={order1}
          doneTasks={[]}
          topTimer={idleTimer}
          onReorder={noop}
          onReorderGroup={noop}
          onToggleDone={noop}
          onOpenDetail={noop}
        />,
      );
      // 最初は Top = "Top task"
      const firstLi = container.querySelectorAll("ul[aria-label='タスクスタック'] > li")[0];
      expect(firstLi?.textContent).toContain("Top task");

      // 並び替えで Second が先頭に来た想定 (AppShell が pendingTasks を入れ替える)
      const order2: Task[] = [order1[1], order1[0]];
      rerender(
        <TaskStack
          events={[]}
          now={NOW_MS}
          pendingTasks={order2}
          doneTasks={[]}
          topTimer={idleTimer}
          onReorder={noop}
          onReorderGroup={noop}
          onToggleDone={noop}
          onOpenDetail={noop}
        />,
      );
      const newFirstLi = container.querySelectorAll("ul[aria-label='タスクスタック'] > li")[0];
      // 新しい Top は元の Second
      expect(newFirstLi?.textContent).toContain("Second task");
      // 並び替え後も Top にのみ動詞が集中
      expect(getAllByLabelText("開始")).toHaveLength(1);
    });
  });
});
