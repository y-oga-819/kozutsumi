import { useState, useCallback, useRef } from "react";
import { PROJECTS, projectOrder } from "./entities/project/projects.js";
import { TODAY } from "./mocks/today.js";
import { initialEvents } from "./mocks/events.js";
import { initialTasks } from "./mocks/tasks.js";
import { historyData } from "./mocks/history.js";
import { fmtDuration, formatDate, timeToMin } from "./shared/lib/time.js";
import { renderMarkdown } from "./shared/lib/markdown.jsx";
import { ACTION_TYPES, log } from "./entities/action-log/logger.js";
import { DayTimeline } from "./features/day-timeline/DayTimeline.jsx";
import { TaskDetailPanel } from "./features/task-detail/TaskDetailPanel.jsx";
import { EventDetailPanel } from "./features/event-detail/EventDetailPanel.jsx";

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
        <TreeView historyData={historyData} />
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
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const rowRefs = useRef([]);
  const dragIdxRef = useRef(null);
  const overIdxRef = useRef(null);
  const startY = useRef(0);
  const isDragging = useRef(false);

  const getTargetIdx = useCallback((clientY) => {
    for (let i = 0; i < rowRefs.current.length; i++) {
      const el = rowRefs.current[i];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return i;
    }
    return rowRefs.current.length - 1;
  }, []);

  const handlePointerDown = useCallback(
    (idx, e) => {
      e.preventDefault();
      startY.current = e.clientY;
      isDragging.current = false;
      dragIdxRef.current = idx;
      overIdxRef.current = null;
      setDragIdx(idx);
      setOverIdx(null);

      const onMove = (ev) => {
        ev.preventDefault();
        const cy = ev.clientY ?? 0;
        if (!isDragging.current && Math.abs(cy - startY.current) > 5)
          isDragging.current = true;
        if (isDragging.current) {
          const t = getTargetIdx(cy);
          overIdxRef.current = t;
          setOverIdx(t);
        }
      };
      const onUp = () => {
        const from = dragIdxRef.current;
        const to = overIdxRef.current;
        if (isDragging.current && from !== null && to !== null && from !== to)
          reorder(from, to);
        dragIdxRef.current = null;
        overIdxRef.current = null;
        isDragging.current = false;
        setDragIdx(null);
        setOverIdx(null);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [getTargetIdx, reorder],
  );

  const Grip = () => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      style={{ display: "block" }}
    >
      <circle cx="5" cy="3" r="1.2" fill="#3f3f46" />
      <circle cx="9" cy="3" r="1.2" fill="#3f3f46" />
      <circle cx="5" cy="7" r="1.2" fill="#3f3f46" />
      <circle cx="9" cy="7" r="1.2" fill="#3f3f46" />
      <circle cx="5" cy="11" r="1.2" fill="#3f3f46" />
      <circle cx="9" cy="11" r="1.2" fill="#3f3f46" />
    </svg>
  );


  return (
    <div style={{ padding: "0 0 100px" }}>
      <DayTimeline
        events={events}
        nowMin={nowMin}
        today={today}
        onOpenEvent={onOpenEvent}
      />

      {/* Stack header */}
      <div
        style={{
          padding: "4px 20px 8px",
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
            color: "#52525b",
            textTransform: "uppercase",
          }}
        >
          task stack
        </span>
        <div style={{ flex: 1, height: 1, background: "#1c1c1e" }} />
        <span style={{ fontSize: 9, color: "#3f3f46" }}>
          {pendingTasks.length}
        </span>
      </div>

      {/* Tasks */}
      {pendingTasks.map((task, idx) => {
        const proj = PROJECTS[task.project];
        const isFirst = idx === 0;
        const isBeingDragged = dragIdx === idx;
        const isDropTarget =
          overIdx === idx && dragIdx !== null && dragIdx !== idx;

        return (
          <div
            key={task.id}
            ref={(el) => {
              rowRefs.current[idx] = el;
            }}
          >
            {isDropTarget && (
              <div
                style={{
                  height: 2,
                  margin: "0 16px",
                  background: "#58A6FF",
                  borderRadius: 1,
                }}
              />
            )}
            {isFirst ? (
              <div
                onClick={() => onOpenDetail(task.id)}
                style={{
                  margin: "0 16px 4px",
                  padding: "14px 14px 14px 18px",
                  background: "#18181b",
                  borderRadius: 10,
                  border: `1px solid ${proj.color}40`,
                  position: "relative",
                  overflow: "hidden",
                  opacity: isBeingDragged ? 0.4 : 1,
                  cursor: "pointer",
                  transition: "opacity 0.15s",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: 3,
                    background: proj.color,
                  }}
                />
                <div
                  style={{ display: "flex", alignItems: "flex-start", gap: 10 }}
                >
                  <div
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      handlePointerDown(idx, e);
                    }}
                    style={{
                      cursor: "grab",
                      touchAction: "none",
                      padding: "4px 2px",
                      marginTop: 6,
                      flexShrink: 0,
                    }}
                  >
                    <Grip />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 4,
                      }}
                    >
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: proj.color,
                        }}
                      />
                      <span
                        style={{
                          fontSize: 9,
                          color: "#71717a",
                          fontFamily: "'Noto Sans JP', sans-serif",
                        }}
                      >
                        {proj.name}
                      </span>
                      {task.dependsOn &&
                        (() => {
                          const dep = events.find(
                            (e) => e.id === task.dependsOn,
                          );
                          return dep ? (
                            <span
                              style={{
                                fontSize: 8,
                                color: "#E85D04",
                                background: "#E85D0415",
                                padding: "1px 6px",
                                borderRadius: 3,
                                fontFamily: "'Noto Sans JP', sans-serif",
                              }}
                            >
                              ← {dep.time}までに
                            </span>
                          ) : null;
                        })()}
                    </div>
                    <div
                      style={{
                        fontFamily: "'Noto Sans JP', sans-serif",
                        fontSize: 15,
                        fontWeight: 600,
                        color: "#fafafa",
                        lineHeight: 1.4,
                      }}
                    >
                      {task.title}
                    </div>
                    {task.body && (
                      <div
                        style={{
                          fontSize: 10,
                          color: "#52525b",
                          marginTop: 4,
                          fontFamily: "'Noto Sans JP', sans-serif",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {task.body
                          .split("\n")
                          .find((l) => l.trim() && !l.startsWith("#")) || ""}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleDone(task.id);
                    }}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 8,
                      border: `1.5px solid ${proj.color}60`,
                      background: "transparent",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      color: proj.color,
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <polyline
                        points="3,8 7,12 13,4"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => onOpenDetail(task.id)}
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
                    handlePointerDown(idx, e);
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
                <span style={{ fontSize: 9, color: "#3f3f46" }}>
                  {task.size}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleDone(task.id);
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
            )}
          </div>
        );
      })}

      {/* Done */}
      {doneTasks.length > 0 && (
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
                  toggleDone(task.id);
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
      )}
    </div>
  );
}

// ─── Tree View ──────────────────────────────────────────────────────
function TreeView({ historyData }) {
  const COL = 16,
    GRAPH_LEFT = 12;
  const groups = {};
  historyData.forEach((t) => {
    if (!groups[t.date]) groups[t.date] = [];
    groups[t.date].push(t);
  });
  const dateGroups = Object.entries(groups).sort(([a], [b]) =>
    b.localeCompare(a),
  );

  return (
    <div style={{ position: "relative", paddingBottom: 40 }}>
      {projectOrder.map((pk, pi) => (
        <div
          key={pk}
          style={{
            position: "absolute",
            left: GRAPH_LEFT + pi * COL + COL / 2 - 1 + 16,
            top: 0,
            bottom: 0,
            width: 2,
            background: PROJECTS[pk].color,
            opacity: 0.3,
            zIndex: 1,
            pointerEvents: "none",
          }}
        />
      ))}
      <div
        style={{
          padding: "14px 16px 6px",
          display: "flex",
          gap: 12,
          position: "relative",
          zIndex: 2,
        }}
      >
        {projectOrder.map((k) => (
          <div
            key={k}
            style={{ display: "flex", alignItems: "center", gap: 4 }}
          >
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: PROJECTS[k].color,
              }}
            />
            <span
              style={{
                fontSize: 9,
                color: "#52525b",
                fontFamily: "'Noto Sans JP', sans-serif",
              }}
            >
              {PROJECTS[k].name}
            </span>
          </div>
        ))}
      </div>
      <div style={{ position: "relative", zIndex: 2 }}>
        {dateGroups.map(([date, items]) => (
          <div key={date}>
            <div
              style={{
                padding: "10px 16px 2px",
                display: "flex",
                alignItems: "center",
              }}
            >
              <div
                style={{ width: GRAPH_LEFT + COL * projectOrder.length + 6 }}
              />
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
              const nodeLeft = 16 + GRAPH_LEFT + pi * COL + COL / 2;
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
                  <div
                    style={{
                      width: GRAPH_LEFT + COL * projectOrder.length + 6,
                      flexShrink: 0,
                    }}
                  />
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
        ))}
      </div>
    </div>
  );
}
