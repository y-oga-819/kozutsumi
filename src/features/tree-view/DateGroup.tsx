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

  const dateLabel = formatDate(date);
  return (
    <div>
      <div className="flex items-center px-4 pb-0.5 pt-2.5">
        <div style={{ width: lanesWidth }} />
        <h3 className="m-0 text-[10px] font-normal text-fg-weak">{dateLabel}</h3>
        <div aria-hidden="true" className="ml-2 h-px flex-1 bg-bg-elevated" />
      </div>
      <ul role="list" aria-label={`${dateLabel} の履歴`} className="m-0 list-none p-0">
        {items.map((task) => {
          const pi = projectOrder.indexOf(task.projectId);
          const nodeLeft = nodeCenterPx(pi);
          return (
            <li key={task.id} className="relative flex min-h-[30px] items-center px-4 py-0.5">
              <div
                aria-hidden="true"
                className="absolute top-1/2 z-[3] h-2 w-2 -translate-y-1/2 rounded-full bg-bg-primary"
                style={{
                  left: nodeLeft - 4,
                  border: `2px solid ${getProject(projectsById, task.projectId).color}`,
                }}
              />
              <div aria-hidden="true" className="shrink-0" style={{ width: lanesWidth }} />
              <span className="font-jp text-[11px] text-fg-subtle">{task.title}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
