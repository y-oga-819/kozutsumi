import type { HistoryEntry } from "../../entities/task/types";
import type { ProjectKey } from "../../entities/project/types";
import { PROJECTS } from "../../entities/project/projects";
import { formatDate } from "../../shared/lib/time";
import { lanesWidthPx, nodeCenterPx } from "./layout";

type DateGroupProps = {
  date: string;
  items: HistoryEntry[];
  projectOrder: readonly ProjectKey[];
};

/**
 * 1つの日付に属するタスク群を、日付見出しとノード列で描画する。
 */
export function DateGroup({ date, items, projectOrder }: DateGroupProps) {
  const lanesWidth = lanesWidthPx(projectOrder.length);

  return (
    <div>
      <div
        style={{
          padding: "10px 16px 2px",
          display: "flex",
          alignItems: "center",
        }}
      >
        <div style={{ width: lanesWidth }} />
        <span style={{ fontSize: 10, color: "#52525b" }}>
          {formatDate(date)}
        </span>
        <div
          style={{
            flex: 1,
            height: 1,
            background: "#18181b",
            marginLeft: 8,
          }}
        />
      </div>
      {items.map((task) => {
        const pi = projectOrder.indexOf(task.project);
        const nodeLeft = nodeCenterPx(pi);
        return (
          <div
            key={task.id}
            style={{
              display: "flex",
              alignItems: "center",
              minHeight: 30,
              padding: "2px 16px",
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: nodeLeft - 4,
                top: "50%",
                transform: "translateY(-50%)",
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#0a0a0b",
                border: `2px solid ${PROJECTS[task.project].color}`,
                zIndex: 3,
              }}
            />
            <div style={{ width: lanesWidth, flexShrink: 0 }} />
            <span
              style={{
                fontFamily: "'Noto Sans JP', sans-serif",
                fontSize: 11,
                color: "#71717a",
              }}
            >
              {task.title}
            </span>
          </div>
        );
      })}
    </div>
  );
}
