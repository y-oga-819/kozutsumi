import type { Task } from "../../entities/task/types";
import type { Event } from "../../entities/event/types";
import type { PointerEvent as ReactPointerEvent } from "react";
import { getProject } from "../../entities/project/projects";
import { useProjects } from "../../entities/project/ProjectsContext";
import { IMMINENT_THRESHOLD_MS, fmtDuration, formatRelativeTime } from "../../shared/lib/time";
import { Grip } from "./Grip";

type TaskRowProps = {
  task: Task;
  events: readonly Event[];
  /** 現在時刻 (ms)。依存イベントの相対時刻 / 直近判定で使う。0 は SSR placeholder。 */
  now: number;
  isBeingDragged: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onClick: () => void;
  onToggleDone: () => void;
};

export function TaskRow({
  task,
  events,
  now,
  isBeingDragged,
  onPointerDown,
  onClick,
  onToggleDone,
}: TaskRowProps) {
  const { projectsById } = useProjects();
  const proj = getProject(projectsById, task.projectId);
  const dep = task.dependsOnEventId ? events.find((e) => e.id === task.dependsOnEventId) : null;
  const depImminent =
    dep !== null &&
    dep !== undefined &&
    now > 0 &&
    new Date(dep.startTime).getTime() - now <= IMMINENT_THRESHOLD_MS;

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
      <span className="flex-1 truncate font-jp text-[12px] text-fg-muted">{task.title}</span>
      {dep && (
        <span
          className={`max-w-[140px] shrink-0 truncate rounded-[3px] px-1 py-px font-jp text-[8px] text-accent-amber ${
            depImminent ? "bg-[#E85D0440] font-semibold" : "bg-[#E85D0415]"
          }`}
          title={`${dep.title} (${formatRelativeTime(dep.startTime, new Date(now))})`}
        >
          ← {formatRelativeTime(dep.startTime, new Date(now))} {dep.title}
        </span>
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
