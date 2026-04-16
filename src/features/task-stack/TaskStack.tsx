import type { Task } from "../../entities/task/types";
import type { Event } from "../../entities/event/types";
import { DoneList } from "./DoneList";
import { TaskRow } from "./TaskRow";
import { TopTaskCard } from "./TopTaskCard";
import { useStackDnD } from "./useStackDnD";

function StackHeader({ count }: { count: number }) {
  return (
    <div
      style={{
        padding: "4px 20px 8px",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span
        style={{
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: "0.1em",
          color: "#52525b",
          textTransform: "uppercase",
        }}
      >
        task stack
      </span>
      <div style={{ flex: 1, height: 1, background: "#1c1c1e" }} />
      <span style={{ fontSize: 9, color: "#3f3f46" }}>{count}</span>
    </div>
  );
}

function DropIndicator() {
  return (
    <div
      style={{
        height: 2,
        margin: "0 16px",
        background: "#58A6FF",
        borderRadius: 1,
      }}
    />
  );
}

type TaskStackProps = {
  events: Event[];
  pendingTasks: Task[];
  doneTasks: Task[];
  onReorder: (from: number, to: number) => void;
  onToggleDone: (id: string) => void;
  onOpenDetail: (id: string) => void;
};

export function TaskStack({ events, pendingTasks, doneTasks, onReorder, onToggleDone, onOpenDetail }: TaskStackProps) {
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
                isBeingDragged={isBeingDragged}
                onPointerDown={(e) => handlePointerDown(idx, e)}
                onClick={() => onOpenDetail(task.id)}
                onToggleDone={() => onToggleDone(task.id)}
              />
            ) : (
              <TaskRow
                task={task}
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
