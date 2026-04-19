import type { Task } from "../../entities/task/types";
import type { PointerEvent as ReactPointerEvent } from "react";
import { PROJECTS } from "../../entities/project/projects";
import { fmtDuration } from "../../shared/lib/time";
import { Grip } from "./Grip";

type TaskRowProps = {
  task: Task;
  isBeingDragged: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onClick: () => void;
  onToggleDone: () => void;
};

export function TaskRow({ task, isBeingDragged, onPointerDown, onClick, onToggleDone }: TaskRowProps) {
  const proj = PROJECTS[task.projectId];

  return (
    <div
      onClick={onClick}
      className={`mx-4 flex cursor-pointer items-center gap-2 border-b border-bg-elevated px-2.5 py-2 transition-opacity duration-150 ${
        isBeingDragged ? "opacity-30" : "opacity-100"
      }`}
    >
      <div
        onPointerDown={(e) => {
          e.stopPropagation();
          onPointerDown(e);
        }}
        className="shrink-0 cursor-grab touch-none p-0.5"
      >
        <Grip />
      </div>
      <div
        className="h-1.5 w-1.5 shrink-0 rounded-full opacity-70"
        style={{ background: proj.color }}
      />
      <span className="flex-1 truncate font-jp text-[12px] text-fg-muted">
        {task.title}
      </span>
      {task.dependsOnEventId && (
        <span className="text-[8px] text-fg-subtle">⏱</span>
      )}
      {task.estimatedMinutes !== null && (
        <span className="text-[9px] tabular-nums text-fg-faint">
          {fmtDuration(task.estimatedMinutes)}
        </span>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleDone();
        }}
        className="flex h-[22px] w-[22px] shrink-0 cursor-pointer items-center justify-center rounded-[5px] border border-bg-divider bg-transparent text-fg-weak"
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
          <polyline
            points="3,8 7,12 13,4"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
