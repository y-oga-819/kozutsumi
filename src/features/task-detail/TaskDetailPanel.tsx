import { useMemo, useState } from "react";
import type { Task } from "../../entities/task/types";
import type { Event } from "../../entities/event/types";
import { getProject } from "../../entities/project/projects";
import { useProjects } from "../../entities/project/ProjectsContext";
import { isDone } from "../../shared/lib/task";
import { fmtDuration, formatRelativeTime } from "../../shared/lib/time";
import { renderMarkdown } from "../../shared/lib/markdown";

export type TaskDetailPanelProps = {
  task: Task;
  events: Event[];
  /** 現在時刻 (ms)。依存イベントの相対時刻 / 候補絞り込みに使う。省略時は呼び出し時刻。 */
  now?: number;
  onClose: () => void;
  onUpdate: (id: string, body: string) => void;
  onToggleDone: (id: string) => void;
  onDelete?: (id: string) => void;
  /**
   * 依存イベント (`tasks.depends_on_event_id`) の更新。null は「依存なし」。
   * 未指定なら依存編集 UI も表示しない (テストや特殊呼び出しで省略可)。
   */
  onChangeDependency?: (id: string, eventId: string | null) => void;
};

export function TaskDetailPanel({
  task,
  events,
  now,
  onClose,
  onUpdate,
  onToggleDone,
  onDelete,
  onChangeDependency,
}: TaskDetailPanelProps) {
  const { projectsById } = useProjects();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.body || "");
  const [editingDep, setEditingDep] = useState(false);
  // パネル open 時刻を「今」として固定する。パネル中に分跨ぎしても候補や相対時刻が
  // ばたつかないようにするのが目的 (相対時刻はあくまで判断補助)。
  const [openedAt] = useState<number>(() => now ?? Date.now());
  const nowMs = now && now > 0 ? now : openedAt;
  const nowDate = useMemo(() => new Date(nowMs), [nowMs]);
  const proj = getProject(projectsById, task.projectId);
  const dep = task.dependsOnEventId ? events.find((e) => e.id === task.dependsOnEventId) : null;
  const done = isDone(task);

  // 依存先候補は「未来のイベント + 現在選択中のイベント (過去でも保持表示)」。
  // 過去のイベントを新規依存先にしても意味がないが、既存の依存先を勝手に外すと混乱するため残す。
  const depCandidates = useMemo(() => {
    const future = events.filter((ev) => new Date(ev.startTime).getTime() >= nowMs);
    const includesCurrent = dep ? future.some((ev) => ev.id === dep.id) : true;
    const merged = includesCurrent && dep ? future : dep ? [dep, ...future] : future;
    return [...merged].sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
    );
  }, [events, dep, nowMs]);

  const handleSave = () => {
    onUpdate(task.id, draft);
    setEditing(false);
  };

  return (
    <div className="fixed inset-0 z-[200] flex flex-col">
      <div onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-[4px]" />

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
            <div className="h-2 w-2 rounded-full" style={{ background: proj.color }} />
            <span className="font-jp text-[10px] text-fg-subtle">{proj.name}</span>
            {task.estimatedMinutes !== null && (
              <span className="text-[9px] tabular-nums text-fg-faint">
                {fmtDuration(task.estimatedMinutes)}
              </span>
            )}
            {dep && (
              <span className="rounded-[3px] bg-[#E85D0415] px-1.5 py-px font-jp text-[9px] text-accent-amber">
                ← {formatRelativeTime(dep.startTime, nowDate)} {dep.title}
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

        {onChangeDependency && (
          <div className="px-5 pb-2">
            <div className="flex items-center gap-2">
              <span className="font-jp text-[10px] text-fg-weak">依存イベント</span>
              {editingDep ? (
                <select
                  autoFocus
                  value={task.dependsOnEventId ?? ""}
                  onChange={(e) => {
                    const next = e.target.value === "" ? null : e.target.value;
                    onChangeDependency(task.id, next);
                    setEditingDep(false);
                  }}
                  onBlur={() => setEditingDep(false)}
                  className="flex-1 rounded border border-bg-divider bg-bg-elevated px-2 py-1 text-[11px] text-fg-default outline-none focus:border-accent-blue"
                >
                  <option value="">なし</option>
                  {depCandidates.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {formatRelativeTime(ev.startTime, nowDate)} {ev.title}
                    </option>
                  ))}
                </select>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingDep(true)}
                  className="cursor-pointer rounded-[4px] border border-bg-divider bg-transparent px-2 py-[3px] font-jp text-[10px] text-fg-subtle"
                >
                  {dep ? `${formatRelativeTime(dep.startTime, nowDate)} ${dep.title}` : "なし"}{" "}
                  を変更
                </button>
              )}
            </div>
          </div>
        )}

        <div className="mx-5 h-px bg-bg-border" />

        <div className="flex-1 overflow-auto px-5 pb-6 pt-3">
          {!editing ? (
            <>
              <div className="mb-2 flex justify-end gap-2">
                {onDelete ? (
                  <button
                    onClick={() => {
                      if (window.confirm("このタスクを削除しますか?")) {
                        onDelete(task.id);
                        onClose();
                      }
                    }}
                    className="flex cursor-pointer items-center gap-1 rounded-[4px] border border-bg-divider bg-transparent px-2.5 py-[3px] text-[10px] text-accent-red"
                  >
                    削除
                  </button>
                ) : null}
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
