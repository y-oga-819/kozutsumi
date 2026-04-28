import { getProject } from "@/entities/project/projects";
import { useProjects } from "@/entities/project/ProjectsContext";
import type { Task } from "@/entities/task/types";
import { fmtDuration } from "@/shared/lib/time";
import { ParallelogramProgress } from "@/shared/ui/ParallelogramProgress";

import { buildStackItems, computeDoneProgress } from "./stackItems";

/**
 * Stack View の Done セクション (ADR 0016 §8)。
 *
 * - 行カードと同じ 2 行レイアウト + `opacity-50` で薄表示。
 * - 子の done は ⤷ 親 + 進捗バー (currentIndex=0) を出す。
 * - 親の done (decompose されなかった親 = leaf-parent) は ⤷ 親なしで title のみ。
 * - 「戻す」ボタンで Stack 末尾に復元 (上から消化の原則を崩さない)。
 *
 * Stack 側の current 強調と被らないよう `currentIndex=0` で固定する。
 */
type DoneListProps = {
  doneTasks: Task[];
  /** parent 解決のため pending+done 全件を渡す。 */
  allTasks: readonly Task[];
  onOpenDetail: (id: string) => void;
  onToggleDone: (id: string) => void;
};

export function DoneList({ doneTasks, allTasks, onOpenDetail, onToggleDone }: DoneListProps) {
  const { projectsById } = useProjects();
  if (doneTasks.length === 0) return null;

  // done タスクを Item に変換 (child は親解決込み)。
  // 親が done に落ちるケースは稀 (子が完了しても親は idle のまま) なので、
  // buildStackItems の decomposed 除外をそのまま流用する。
  const { items } = buildStackItems(doneTasks, allTasks);

  return (
    <>
      <div className="flex items-center gap-2 px-5 pb-2 pt-5">
        <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-fg-faint">
          done
        </span>
        <div className="h-px flex-1 bg-bg-border" />
        <span className="text-[9px] text-fg-faint">{doneTasks.length}</span>
      </div>
      <ul role="list" aria-label="完了済みタスク" className="m-0 list-none p-0 opacity-50">
        {items.map((item) => {
          const task = item.task;
          const proj = getProject(projectsById, task.projectId);
          const parent = item.kind === "leaf-child" ? item.parent : undefined;
          const parentColor = parent ? getProject(projectsById, parent.projectId).color : null;
          const progress = parent ? computeDoneProgress(parent, allTasks) : null;
          return (
            <li key={item.id}>
              <div
                onClick={() => onOpenDetail(task.id)}
                className="mx-4 cursor-pointer border-b border-bg-elevated px-2.5 py-2"
              >
                {/* Row 1: ProjectDot + title (line-through) + estimate + 戻す */}
                <div className="flex items-center gap-2">
                  <div
                    className="h-1.5 w-1.5 shrink-0 rounded-full opacity-70"
                    style={{ background: proj.color }}
                  />
                  <span className="flex-1 truncate font-jp text-[12px] text-fg-weak line-through">
                    {task.title}
                  </span>
                  {task.estimatedMinutes !== null && (
                    <span className="text-[9px] tabular-nums text-fg-faint">
                      {fmtDuration(task.estimatedMinutes)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleDone(task.id);
                    }}
                    aria-label={`${task.title} を未完了に戻す`}
                    className="cursor-pointer rounded-[3px] border border-bg-divider bg-transparent px-1.5 py-0.5 font-jp text-[9px] text-fg-faint"
                  >
                    戻す
                  </button>
                </div>
                {/* Row 2: ⤷ 親 + progress (currentIndex=0) — 子のみ */}
                {parent && progress && parentColor && (
                  <div className="ml-[14px] mt-1 flex items-center gap-2">
                    <span
                      className="min-w-0 flex-1 truncate font-jp text-[9px]"
                      style={{ color: `${parentColor}99` }}
                      title={`親: ${parent.title}`}
                    >
                      ⤷ {parent.title}
                    </span>
                    <ParallelogramProgress
                      total={progress.total}
                      doneCount={progress.doneCount}
                      currentIndex={progress.currentIndex}
                      color={parentColor}
                      size="sm"
                    />
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
