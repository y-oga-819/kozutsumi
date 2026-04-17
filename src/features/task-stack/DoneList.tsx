import type { Task } from "../../entities/task/types";

type DoneListProps = {
  doneTasks: Task[];
  onOpenDetail: (id: string) => void;
  onToggleDone: (id: string) => void;
};

export function DoneList({ doneTasks, onOpenDetail, onToggleDone }: DoneListProps) {
  if (doneTasks.length === 0) return null;
  return (
    <>
      <div className="flex items-center gap-2 px-5 pb-2 pt-5">
        <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-fg-faint">
          done
        </span>
        <div className="h-px flex-1 bg-bg-border" />
        <span className="text-[9px] text-fg-faint">{doneTasks.length}</span>
      </div>
      {doneTasks.map((task) => (
        <div
          key={task.id}
          onClick={() => onOpenDetail(task.id)}
          className="mx-4 flex cursor-pointer items-center gap-2.5 px-3.5 py-1.5 opacity-30"
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
            <polyline
              points="3,8 7,12 13,4"
              stroke="#22c55e"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="font-jp text-[11px] text-fg-weak line-through">
            {task.title}
          </span>
          <div className="flex-1" />
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleDone(task.id);
            }}
            className="cursor-pointer rounded-[3px] border border-bg-divider bg-transparent px-1.5 py-0.5 font-jp text-[9px] text-fg-faint"
          >
            戻す
          </button>
        </div>
      ))}
    </>
  );
}
