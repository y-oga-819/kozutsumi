import type { Task } from "../../entities/task/types";
import type { PointerEvent as ReactPointerEvent } from "react";
import { PROJECTS } from "../../entities/project/projects";
import { Grip } from "./Grip";

type TaskRowProps = {
  task: Task;
  isBeingDragged: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onClick: () => void;
  onToggleDone: () => void;
};

export function TaskRow({ task, isBeingDragged, onPointerDown, onClick, onToggleDone }: TaskRowProps) {
  const proj = PROJECTS[task.project];

  return (
    <div
      onClick={onClick}
      style={{
        margin: "0 16px",
        padding: "8px 10px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        borderBottom: "1px solid #18181b",
        opacity: isBeingDragged ? 0.3 : 1,
        cursor: "pointer",
        transition: "opacity 0.15s",
      }}
    >
      <div
        onPointerDown={(e) => {
          e.stopPropagation();
          onPointerDown(e);
        }}
        style={{
          cursor: "grab",
          touchAction: "none",
          padding: "2px",
          flexShrink: 0,
        }}
      >
        <Grip />
      </div>
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: proj.color,
          opacity: 0.7,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontFamily: "'Noto Sans JP', sans-serif",
          fontSize: 12,
          color: "#a1a1aa",
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {task.title}
      </span>
      {task.dependsOn && (
        <span style={{ fontSize: 8, color: "#71717a" }}>⏱</span>
      )}
      <span style={{ fontSize: 9, color: "#3f3f46" }}>{task.size}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleDone();
        }}
        style={{
          width: 22,
          height: 22,
          borderRadius: 5,
          border: "1px solid #27272a",
          background: "transparent",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#52525b",
          flexShrink: 0,
        }}
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
