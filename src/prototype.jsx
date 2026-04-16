import { useCallback, useState } from "react";
import { projectOrder } from "./entities/project/projects.js";
import { TODAY } from "./mocks/today.js";
import { initialEvents } from "./mocks/events.js";
import { initialTasks } from "./mocks/tasks.js";
import { historyData } from "./mocks/history.js";
import { ACTION_TYPES, log } from "./entities/action-log/logger.js";
import { DayTimeline } from "./features/day-timeline/DayTimeline.jsx";
import { TaskDetailPanel } from "./features/task-detail/TaskDetailPanel.jsx";
import { EventDetailPanel } from "./features/event-detail/EventDetailPanel.jsx";
import { TreeView } from "./features/tree-view/TreeView.jsx";
import { TaskStack } from "./features/task-stack/TaskStack.jsx";

// ─── Main ───────────────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState("stack");
  const [tasks, setTasks] = useState(initialTasks);
  const [detailId, setDetailId] = useState(null);
  const [eventDetailId, setEventDetailId] = useState(null);

  const toggleDone = useCallback((id) => {
    setTasks((ts) => {
      const target = ts.find((t) => t.id === id);
      if (target && !target.done) {
        log(ACTION_TYPES.TASK_COMPLETED, { task_id: id });
      }
      return ts.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
    });
  }, []);

  const updateBody = useCallback((id, body) => {
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, body } : t)));
  }, []);

  const reorder = useCallback((fromIdx, toIdx) => {
    setTasks((ts) => {
      const pending = ts.filter((t) => !t.done);
      const done = ts.filter((t) => t.done);
      const next = [...pending];
      const [item] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, item);
      log(ACTION_TYPES.TASK_REORDERED, {
        task_id: item.id,
        from_position: fromIdx,
        to_position: toIdx,
      });
      return [...next, ...done];
    });
  }, []);

  const pendingTasks = tasks.filter((t) => !t.done);
  const doneTasks = tasks.filter((t) => t.done);
  const nowMin = 9 * 60 + 15;
  const detailTask = detailId ? tasks.find((t) => t.id === detailId) : null;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0a0b",
        color: "#d4d4d8",
        fontFamily: "'IBM Plex Mono', 'JetBrains Mono', monospace",
        maxWidth: 480,
        margin: "0 auto",
        position: "relative",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=Noto+Sans+JP:wght@300;400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: #27272a; border-radius: 2px; }
        @keyframes slideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>

      {/* Header */}
      <div
        style={{
          padding: "16px 20px 12px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          borderBottom: "1px solid #18181b",
          position: "sticky",
          top: 0,
          background: "#0a0a0b",
          zIndex: 50,
        }}
      >
        <div
          style={{
            fontFamily: "'Noto Sans JP', sans-serif",
            fontWeight: 700,
            fontSize: 16,
            letterSpacing: "-0.02em",
          }}
        >
          <span style={{ color: "#58A6FF" }}>flow</span>
          <span style={{ color: "#3f3f46" }}>stack</span>
        </div>
        <div style={{ flex: 1 }} />
        <div
          style={{
            display: "flex",
            background: "#18181b",
            borderRadius: 6,
            padding: 2,
          }}
        >
          {[
            { key: "stack", label: "Stack" },
            { key: "tree", label: "Tree" },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setView(tab.key)}
              style={{
                fontSize: 11,
                fontFamily: "'IBM Plex Mono', monospace",
                padding: "4px 14px",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                background: view === tab.key ? "#27272a" : "transparent",
                color: view === tab.key ? "#e4e4e7" : "#52525b",
                fontWeight: 500,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {view === "stack" ? (
        <StackView
          events={initialEvents}
          pendingTasks={pendingTasks}
          doneTasks={doneTasks}
          toggleDone={toggleDone}
          reorder={reorder}
          nowMin={nowMin}
          today={TODAY}
          onOpenDetail={setDetailId}
          onOpenEvent={setEventDetailId}
        />
      ) : (
        <TreeView historyData={historyData} projectOrder={projectOrder} />
      )}

      {/* Detail panel overlay */}
      {detailTask && (
        <TaskDetailPanel
          task={detailTask}
          events={initialEvents}
          onClose={() => setDetailId(null)}
          onUpdate={updateBody}
          onToggleDone={toggleDone}
        />
      )}

      {/* Event detail overlay */}
      {eventDetailId &&
        (() => {
          const ev = initialEvents.find((e) => e.id === eventDetailId);
          return ev ? (
            <EventDetailPanel
              event={ev}
              onClose={() => setEventDetailId(null)}
            />
          ) : null;
        })()}
    </div>
  );
}

// ─── Stack View ─────────────────────────────────────────────────────
function StackView({
  events,
  pendingTasks,
  doneTasks,
  toggleDone,
  reorder,
  nowMin,
  today,
  onOpenDetail,
  onOpenEvent,
}) {
  return (
    <div style={{ padding: "0 0 100px" }}>
      <DayTimeline
        events={events}
        nowMin={nowMin}
        today={today}
        onOpenEvent={onOpenEvent}
      />
      <TaskStack
        events={events}
        pendingTasks={pendingTasks}
        doneTasks={doneTasks}
        onReorder={reorder}
        onToggleDone={toggleDone}
        onOpenDetail={onOpenDetail}
      />
    </div>
  );
}
