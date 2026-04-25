import type { Event } from "../../entities/event/types";
import type { PauseReason } from "../../entities/task/time-entries";
import type { Task } from "../../entities/task/types";
import { DoneList } from "./DoneList";
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
  onReorder: (from: number, to: number) => void;
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
  const { dragIdx, overIdx, rowRefs, handlePointerDown } =
    useStackDnD(onReorder);

  return (
    <>
      <StackHeader count={pendingTasks.length} />

      {pendingTasks.map((task, idx) => {
        const isFirst = idx === 0;
        const isBeingDragged = dragIdx === idx;
        const isDropTarget =
          overIdx === idx && dragIdx !== null && dragIdx !== idx;

        return (
          <div
            key={task.id}
            ref={(el: HTMLDivElement | null) => {
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
                onPointerDown={(e) => handlePointerDown(idx, e)}
                onClick={() => onOpenDetail(task.id)}
                onToggleDone={() => onToggleDone(task.id)}
              />
            )}
          </div>
        );
      })}

      <DoneList
        doneTasks={doneTasks}
        onOpenDetail={onOpenDetail}
        onToggleDone={onToggleDone}
      />
    </>
  );
}
