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
      <div
        style={{
          padding: "20px 20px 8px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: "0.1em",
            color: "#3f3f46",
            textTransform: "uppercase",
          }}
        >
          done
        </span>
        <div style={{ flex: 1, height: 1, background: "#1c1c1e" }} />
        <span style={{ fontSize: 9, color: "#3f3f46" }}>
          {doneTasks.length}
        </span>
      </div>
      {doneTasks.map((task) => (
        <div
          key={task.id}
          onClick={() => onOpenDetail(task.id)}
          style={{
            margin: "0 16px",
            padding: "6px 14px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            opacity: 0.3,
            cursor: "pointer",
          }}
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
          <span
            style={{
              fontFamily: "'Noto Sans JP', sans-serif",
              fontSize: 11,
              color: "#52525b",
              textDecoration: "line-through",
            }}
          >
            {task.title}
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleDone(task.id);
            }}
            style={{
              fontSize: 9,
              fontFamily: "'Noto Sans JP', sans-serif",
              padding: "2px 6px",
              borderRadius: 3,
              border: "1px solid #27272a",
              background: "transparent",
              color: "#3f3f46",
              cursor: "pointer",
            }}
          >
            戻す
          </button>
        </div>
      ))}
    </>
  );
}
