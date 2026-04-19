import type { HistoryEntry } from "../../entities/task/types";
import { getProject } from "../../entities/project/projects";
import { useProjects } from "../../entities/project/ProjectsContext";
import { formatDate } from "../../shared/lib/time";
import { lanesWidthPx, nodeCenterPx } from "./layout";

type DateGroupProps = {
  date: string;
  items: HistoryEntry[];
  projectOrder: readonly string[];
};

/**
 * 1つの日付に属するタスク群を、日付見出しとノード列で描画する。
 */
export function DateGroup({ date, items, projectOrder }: DateGroupProps) {
  const { projectsById } = useProjects();
  const lanesWidth = lanesWidthPx(projectOrder.length);

  return (
    <div>
      <div className="flex items-center px-4 pb-0.5 pt-2.5">
        <div style={{ width: lanesWidth }} />
        <span className="text-[10px] text-fg-weak">{formatDate(date)}</span>
        <div className="ml-2 h-px flex-1 bg-bg-elevated" />
      </div>
      {items.map((task) => {
        const pi = projectOrder.indexOf(task.projectId);
        const nodeLeft = nodeCenterPx(pi);
        return (
          <div
            key={task.id}
            className="relative flex min-h-[30px] items-center px-4 py-0.5"
          >
            <div
              className="absolute top-1/2 z-[3] h-2 w-2 -translate-y-1/2 rounded-full bg-bg-primary"
              style={{
                left: nodeLeft - 4,
                border: `2px solid ${getProject(projectsById, task.projectId).color}`,
              }}
            />
            <div className="shrink-0" style={{ width: lanesWidth }} />
            <span className="font-jp text-[11px] text-fg-subtle">
              {task.title}
            </span>
          </div>
        );
      })}
    </div>
  );
}
