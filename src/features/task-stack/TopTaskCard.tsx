import type { Task } from "../../entities/task/types";
import type { Event } from "../../entities/event/types";
import type { PointerEvent as ReactPointerEvent } from "react";
import { PROJECTS } from "../../entities/project/projects";
import { Grip } from "./Grip";

function bodyPreview(body: string): string {
  if (!body) return "";
  return body.split("\n").find((l) => l.trim() && !l.startsWith("#")) || "";
}

type TopTaskCardProps = {
  task: Task;
  events: Event[];
  isBeingDragged: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onClick: () => void;
  onToggleDone: () => void;
};

export function TopTaskCard({ task, events, isBeingDragged, onPointerDown, onClick, onToggleDone }: TopTaskCardProps) {
  const proj = PROJECTS[task.project];
  const dep = task.dependsOn
    ? events.find((e) => e.id === task.dependsOn)
    : null;
  const preview = bodyPreview(task.body);

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
              <span className="rounded-[3px] bg-[#E85D0415] px-1.5 py-px font-jp text-[8px] text-accent-amber">
                ← {dep.time}までに
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
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleDone();
          }}
          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-transparent"
          style={{
            border: `1.5px solid ${proj.color}60`,
            color: proj.color,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <polyline
              points="3,8 7,12 13,4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
