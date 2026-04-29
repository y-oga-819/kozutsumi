import { useCallback, useMemo } from "react";

import type { Event } from "@/entities/event/types";
import type { PauseReason } from "@/entities/task/time-entries";
import type { Task } from "@/entities/task/types";

import { DoneList } from "./DoneList";
import { buildStackItems, computeChildProgress } from "./stackItems";
import { TaskRow } from "./TaskRow";
import { TopTaskCard } from "./TopTaskCard";
import { useStackDnD } from "./useStackDnD";

function StackHeader({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-2 px-5 pb-2 pt-1">
      <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-fg-weak">
        task stack
      </span>
      <div className="h-px flex-1 bg-bg-border" />
      <span className="text-[9px] text-fg-faint">{count}</span>
    </div>
  );
}

function DropIndicator() {
  return <div className="mx-4 h-0.5 rounded-[1px] bg-accent-blue" />;
}

export type TopTimerBinding = {
  elapsedSeconds: number;
  pauseReason: PauseReason | null;
  onStart: () => void;
  onPauseRequest: () => void;
  onResume: () => void;
  onComplete: () => void;
};

type TaskStackProps = {
  events: Event[];
  pendingTasks: Task[];
  doneTasks: Task[];
  topTimer: TopTimerBinding;
  /** 現在時刻 (ms)。依存イベントの相対時刻 / 直近判定で使う。0 は SSR 時の placeholder。 */
  now: number;
  /**
   * 並び替え操作。`fromId` を `toId` の位置に移す。
   * Stack 行の index ではなく id ベースで受け取るのは、`buildStackItems` が
   * decomposed 親を除外するため、UI 上の index と pending Task[] の index が
   * 一致しないことがあるため。
   */
  onReorder: (fromId: string, toId: string) => void;
  onToggleDone: (id: string) => void;
  onOpenDetail: (id: string) => void;
};

export function TaskStack({
  events,
  pendingTasks,
  doneTasks,
  topTimer,
  now,
  onReorder,
  onToggleDone,
  onOpenDetail,
}: TaskStackProps) {
  // ADR 0016 §1: decomposed 親を Stack 行から除外し、子をフラット化。
  const allTasks = useMemo(() => [...pendingTasks, ...doneTasks], [pendingTasks, doneTasks]);
  const { items } = useMemo(
    () => buildStackItems(pendingTasks, allTasks),
    [pendingTasks, allTasks],
  );

  const handleReorderByIdx = useCallback(
    (fromIdx: number, toIdx: number) => {
      const fromItem = items[fromIdx];
      const toItem = items[toIdx];
      if (!fromItem || !toItem) return;
      onReorder(fromItem.task.id, toItem.task.id);
    },
    [items, onReorder],
  );
  const { dragIdx, overIdx, rowRefs, handlePointerDown } = useStackDnD(handleReorderByIdx);

  return (
    <>
      <StackHeader count={items.length} />

      {/*
        並び順が意味を持つリスト。role=list / listitem を立てておくと
        スクリーンリーダーが項目数を読み上げ、e2e も semantic に取れる。
      */}
      <ul role="list" aria-label="タスクスタック" className="m-0 list-none p-0">
        {items.map((item, idx) => {
          const isFirst = idx === 0;
          const isBeingDragged = dragIdx === idx;
          const isDropTarget = overIdx === idx && dragIdx !== null && dragIdx !== idx;
          const task = item.task;
          const parent = item.kind === "leaf-child" ? item.parent : undefined;
          const progress = parent ? computeChildProgress(task, parent, allTasks, items) : undefined;

          return (
            <li
              key={item.id}
              ref={(el: HTMLLIElement | null) => {
                rowRefs.current[idx] = el;
              }}
            >
              {isDropTarget && <DropIndicator />}
              {isFirst ? (
                <TopTaskCard
                  task={task}
                  events={events}
                  now={now}
                  isBeingDragged={isBeingDragged}
                  elapsedSeconds={topTimer.elapsedSeconds}
                  pauseReason={topTimer.pauseReason}
                  parent={parent}
                  progress={progress}
                  onPointerDown={(e) => handlePointerDown(idx, e)}
                  onClick={() => onOpenDetail(task.id)}
                  onStart={topTimer.onStart}
                  onPauseRequest={topTimer.onPauseRequest}
                  onResume={topTimer.onResume}
                  onComplete={topTimer.onComplete}
                />
              ) : (
                <TaskRow
                  task={task}
                  events={events}
                  now={now}
                  isBeingDragged={isBeingDragged}
                  parent={parent}
                  progress={progress}
                  onPointerDown={(e) => handlePointerDown(idx, e)}
                  onClick={() => onOpenDetail(task.id)}
                />
              )}
            </li>
          );
        })}
      </ul>

      <DoneList
        doneTasks={doneTasks}
        allTasks={allTasks}
        onOpenDetail={onOpenDetail}
        onToggleDone={onToggleDone}
      />
    </>
  );
}
