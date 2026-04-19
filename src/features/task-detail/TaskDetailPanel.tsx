import { useState } from "react";
import type { Task } from "../../entities/task/types";
import type { Event } from "../../entities/event/types";
import { PROJECTS } from "../../entities/project/projects";
import { isDone } from "../../shared/lib/task";
import { fmtDuration, formatClock } from "../../shared/lib/time";
import { renderMarkdown } from "../../shared/lib/markdown";

export type TaskDetailPanelProps = {
  task: Task;
  events: Event[];
  onClose: () => void;
  onUpdate: (id: string, body: string) => void;
  onToggleDone: (id: string) => void;
};

export function TaskDetailPanel({ task, events, onClose, onUpdate, onToggleDone }: TaskDetailPanelProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.body || "");
  const proj = PROJECTS[task.projectId];
  const dep = task.dependsOnEventId
    ? events.find((e) => e.id === task.dependsOnEventId)
    : null;
  const done = isDone(task);

  const handleSave = () => {
    onUpdate(task.id, draft);
    setEditing(false);
  };

  return (
    <div className="fixed inset-0 z-[200] flex flex-col">
      <div
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[4px]"
      />

      <div
        className="relative mt-auto flex max-h-[85vh] animate-panel-slide-up flex-col rounded-t-2xl bg-bg-surface"
        style={{
          borderTop: `2px solid ${proj.color}40`,
        }}
      >
        <div className="flex justify-center px-0 pb-1 pt-2.5">
          <div className="h-[3px] w-8 rounded-[2px] bg-bg-divider" />
        </div>

        <div className="px-5 pb-3 pt-2">
          <div className="mb-2 flex items-center gap-2">
            <div
              className="h-2 w-2 rounded-full"
              style={{ background: proj.color }}
            />
            <span className="font-jp text-[10px] text-fg-subtle">
              {proj.name}
            </span>
            {task.estimatedMinutes !== null && (
              <span className="text-[9px] tabular-nums text-fg-faint">
                {fmtDuration(task.estimatedMinutes)}
              </span>
            )}
            {dep && (
              <span className="rounded-[3px] bg-[#E85D0415] px-1.5 py-px font-jp text-[9px] text-accent-amber">
                ← {formatClock(dep.startTime)}までに
              </span>
            )}
            <div className="flex-1" />
            <button
              onClick={() => {
                onToggleDone(task.id);
                onClose();
              }}
              className="cursor-pointer rounded-[4px] px-2.5 py-[3px] font-jp text-[10px]"
              style={{
                background: done ? "#27272a" : proj.color,
                color: done ? "#8B949E" : "#fff",
              }}
            >
              {done ? "未完了に戻す" : "完了にする"}
            </button>
          </div>
          <h2 className="m-0 font-jp text-[16px] font-bold leading-[1.4] text-fg-strong">
            {task.title}
          </h2>
        </div>

        <div className="mx-5 h-px bg-bg-border" />

        <div className="flex-1 overflow-auto px-5 pb-6 pt-3">
          {!editing ? (
            <>
              <div className="mb-2 flex justify-end">
                <button
                  onClick={() => {
                    setDraft(task.body || "");
                    setEditing(true);
                  }}
                  className="flex cursor-pointer items-center gap-1 rounded-[4px] border border-bg-divider bg-transparent px-2.5 py-[3px] text-[10px] text-fg-subtle"
                >
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M11.5 1.5L14.5 4.5 5 14H2V11L11.5 1.5Z"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                    />
                  </svg>
                  編集
                </button>
              </div>
              {task.body ? (
                <div>{renderMarkdown(task.body)}</div>
              ) : (
                <div className="py-5 text-center font-jp text-[12px] italic text-fg-faint">
                  詳細を追加...
                </div>
              )}
            </>
          ) : (
            <>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoFocus
                className="min-h-[200px] w-full resize-y rounded-lg border border-bg-divider bg-bg-elevated p-3 font-mono text-[12px] leading-[1.6] text-fg-default outline-none"
                placeholder="Markdownで詳細を入力..."
                onFocus={(e) => {
                  e.target.style.borderColor = proj.color + "60";
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = "#27272a";
                }}
              />
              <div className="mt-2.5 flex justify-end gap-2">
                <button
                  onClick={() => setEditing(false)}
                  className="cursor-pointer rounded-[4px] border border-bg-divider bg-transparent px-3.5 py-1 font-jp text-[10px] text-fg-subtle"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleSave}
                  className="cursor-pointer rounded-[4px] px-3.5 py-1 font-jp text-[10px] font-semibold text-fg-invert"
                  style={{ background: proj.color }}
                >
                  保存
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
