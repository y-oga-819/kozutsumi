import type { PointerEvent as ReactPointerEvent } from "react";

import type { Event } from "../../entities/event/types";
import { getProject } from "../../entities/project/projects";
import { useProjects } from "../../entities/project/ProjectsContext";
import type { PauseReason } from "../../entities/task/time-entries";
import type { Task } from "../../entities/task/types";
import {
  IMMINENT_THRESHOLD_MS,
  formatRelativeTime,
} from "../../shared/lib/time";
import { Grip } from "./Grip";
import { pauseReasonLabel } from "./PauseReasonModal";
import { formatElapsed } from "./useTaskTimer";

function bodyPreview(body: string): string {
  if (!body) return "";
  return body.split("\n").find((l) => l.trim() && !l.startsWith("#")) || "";
}

type TopTaskCardProps = {
  task: Task;
  events: Event[];
  /** 現在時刻 (ms)。依存イベントの相対時刻 / 直近判定で使う。0 は SSR placeholder で計算をスキップ。 */
  now: number;
  isBeingDragged: boolean;
  elapsedSeconds: number;
  pauseReason: PauseReason | null;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onClick: () => void;
  onStart: () => void;
  onPauseRequest: () => void;
  onResume: () => void;
  onComplete: () => void;
};

export function TopTaskCard({
  task,
  events,
  now,
  isBeingDragged,
  elapsedSeconds,
  pauseReason,
  onPointerDown,
  onClick,
  onStart,
  onPauseRequest,
  onResume,
  onComplete,
}: TopTaskCardProps) {
  const { projectsById } = useProjects();
  const proj = getProject(projectsById, task.projectId);
  const dep = task.dependsOnEventId
    ? events.find((e) => e.id === task.dependsOnEventId)
    : null;
  // 24h 以内に迫っている依存はハイライト (背景濃度 + 太字) して着手判断のシグナルを強める。
  // now=0 (SSR placeholder) のときは判定スキップ。
  const depImminent =
    dep !== null &&
    dep !== undefined &&
    now > 0 &&
    new Date(dep.startTime).getTime() - now <= IMMINENT_THRESHOLD_MS;
  const preview = bodyPreview(task.body);
  const isActive = task.status === "active";
  const isPaused = task.status === "paused";

  return (
    <div
      onClick={onClick}
      className={`relative mx-4 mb-1 cursor-pointer overflow-hidden rounded-[10px] bg-bg-elevated py-3.5 pl-[18px] pr-3.5 transition-opacity duration-150 ${
        isBeingDragged ? "opacity-40" : "opacity-100"
      }`}
      style={{
        border: `1px solid ${proj.color}40`,
      }}
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{ background: proj.color }}
      />
      <div className="flex items-start gap-2.5">
        <div
          onPointerDown={(e) => {
            e.stopPropagation();
            onPointerDown(e);
          }}
          className="mt-1.5 shrink-0 cursor-grab touch-none px-0.5 py-1"
        >
          <Grip />
        </div>
        <div className="flex-1">
          <div className="mb-1 flex items-center gap-2">
            <div
              className="h-2 w-2 rounded-full"
              style={{ background: proj.color }}
            />
            <span className="font-jp text-[9px] text-fg-subtle">
              {proj.name}
            </span>
            {dep && (
              <span
                className={`max-w-[180px] truncate rounded-[3px] px-1.5 py-px font-jp text-[8px] text-accent-amber ${
                  depImminent
                    ? "bg-[#E85D0440] font-semibold"
                    : "bg-[#E85D0415]"
                }`}
                title={`${dep.title} (${formatRelativeTime(dep.startTime, new Date(now))})`}
              >
                ← {formatRelativeTime(dep.startTime, new Date(now))} {dep.title}
              </span>
            )}
            {isActive && (
              <span
                className="rounded-[3px] bg-accent-blue/15 px-1.5 py-px font-jp text-[9px] font-semibold tabular-nums text-accent-blue"
                aria-label="経過時間"
              >
                ● {formatElapsed(elapsedSeconds)}
              </span>
            )}
            {isPaused && pauseReason && (
              <span className="rounded-[3px] bg-fg-weak/15 px-1.5 py-px font-jp text-[8px] text-fg-weak">
                中断: {pauseReasonLabel(pauseReason)}
              </span>
            )}
          </div>
          <div className="font-jp text-[15px] font-semibold leading-[1.4] text-fg-strong">
            {task.title}
          </div>
          {preview && (
            <div className="mt-1 truncate font-jp text-[10px] text-fg-weak">
              {preview}
            </div>
          )}
        </div>
        <TimerControls
          task={task}
          color={proj.color}
          onStart={onStart}
          onPauseRequest={onPauseRequest}
          onResume={onResume}
          onComplete={onComplete}
        />
      </div>
    </div>
  );
}

type TimerControlsProps = {
  task: Task;
  color: string;
  onStart: () => void;
  onPauseRequest: () => void;
  onResume: () => void;
  onComplete: () => void;
};

function TimerControls({
  task,
  color,
  onStart,
  onPauseRequest,
  onResume,
  onComplete,
}: TimerControlsProps) {
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  if (task.status === "active") {
    return (
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={stop(onPauseRequest)}
          aria-label="中断"
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg bg-transparent"
          style={{ border: `1.5px solid ${color}40`, color: "currentColor" }}
        >
          <PauseIcon />
        </button>
        <button
          type="button"
          onClick={stop(onComplete)}
          aria-label="完了"
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg bg-transparent"
          style={{ border: `1.5px solid ${color}60`, color }}
        >
          <CheckIcon />
        </button>
      </div>
    );
  }
  if (task.status === "paused") {
    return (
      <button
        type="button"
        onClick={stop(onResume)}
        aria-label="再開"
        className="flex h-9 shrink-0 cursor-pointer items-center gap-1 rounded-lg bg-transparent px-2.5 font-jp text-[11px] font-semibold"
        style={{ border: `1.5px solid ${color}60`, color }}
      >
        <PlayIcon />
        再開
      </button>
    );
  }
  // idle / done は開始ボタン。done の場合は呼ばれない想定 (TaskStack 側で除外)
  return (
    <button
      type="button"
      onClick={stop(onStart)}
      aria-label="開始"
      className="flex h-9 shrink-0 cursor-pointer items-center gap-1 rounded-lg bg-transparent px-2.5 font-jp text-[11px] font-semibold"
      style={{ border: `1.5px solid ${color}60`, color }}
    >
      <PlayIcon />
      開始
    </button>
  );
}

function PlayIcon() {
  return (
    <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor">
      <polygon points="1,1 9,6 1,11" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
      <rect x="2" y="2" width="3" height="8" rx="1" />
      <rect x="7" y="2" width="3" height="8" rx="1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <polyline
        points="3,8 7,12 13,4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
