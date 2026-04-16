import { useState, useCallback, useRef, useMemo } from "react";
import { PROJECTS, projectOrder } from "./entities/project/projects.js";
import { TODAY } from "./mocks/today.js";
import { initialEvents } from "./mocks/events.js";
import { initialTasks } from "./mocks/tasks.js";
import { historyData } from "./mocks/history.js";
import { formatDate, timeToMin, fmtDuration, fmtMin } from "./shared/lib/time.js";
import { renderMarkdown } from "./shared/lib/markdown.jsx";
import { ACTION_TYPES, log } from "./entities/action-log/logger.js";

// ─── Detail Panel ───────────────────────────────────────────────────
function DetailPanel({ task, events, onClose, onUpdate, onToggleDone }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.body || "");
  const proj = PROJECTS[task.project];
  const dep = task.dependsOn
    ? events.find((e) => e.id === task.dependsOn)
    : null;

  const handleSave = () => {
    onUpdate(task.id, draft);
    setEditing(false);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: "relative",
          marginTop: "auto",
          background: "#111113",
          borderTop: `2px solid ${proj.color}40`,
          borderRadius: "16px 16px 0 0",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          animation: "panelSlideUp 0.25s ease",
        }}
      >
        <style>{`
          @keyframes panelSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        `}</style>

        {/* Handle bar */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "10px 0 4px",
          }}
        >
          <div
            style={{
              width: 32,
              height: 3,
              borderRadius: 2,
              background: "#27272a",
            }}
          />
        </div>

        {/* Header */}
        <div style={{ padding: "8px 20px 12px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
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
                fontSize: 10,
                color: "#71717a",
                fontFamily: "'Noto Sans JP', sans-serif",
              }}
            >
              {proj.name}
            </span>
            <span style={{ fontSize: 9, color: "#3f3f46" }}>{task.size}</span>
            {dep && (
              <span
                style={{
                  fontSize: 9,
                  color: "#E85D04",
                  background: "#E85D0415",
                  padding: "1px 6px",
                  borderRadius: 3,
                  fontFamily: "'Noto Sans JP', sans-serif",
                }}
              >
                ← {dep.time}までに
              </span>
            )}
            <div style={{ flex: 1 }} />
            <button
              onClick={() => {
                onToggleDone(task.id);
                onClose();
              }}
              style={{
                fontSize: 10,
                fontFamily: "'Noto Sans JP', sans-serif",
                padding: "3px 10px",
                borderRadius: 4,
                border: "none",
                background: task.done ? "#27272a" : proj.color,
                color: task.done ? "#8B949E" : "#fff",
                cursor: "pointer",
              }}
            >
              {task.done ? "未完了に戻す" : "完了にする"}
            </button>
          </div>
          <h2
            style={{
              fontFamily: "'Noto Sans JP', sans-serif",
              fontSize: 16,
              fontWeight: 700,
              color: "#fafafa",
              lineHeight: 1.4,
              margin: 0,
            }}
          >
            {task.title}
          </h2>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: "#1c1c1e", margin: "0 20px" }} />

        {/* Body */}
        <div style={{ flex: 1, overflow: "auto", padding: "12px 20px 24px" }}>
          {!editing ? (
            <>
              {/* Toolbar */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  marginBottom: 8,
                }}
              >
                <button
                  onClick={() => {
                    setDraft(task.body || "");
                    setEditing(true);
                  }}
                  style={{
                    fontSize: 10,
                    fontFamily: "'IBM Plex Mono', monospace",
                    padding: "3px 10px",
                    borderRadius: 4,
                    border: "1px solid #27272a",
                    background: "transparent",
                    color: "#71717a",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
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
              {/* Preview */}
              {task.body ? (
                <div>{renderMarkdown(task.body)}</div>
              ) : (
                <div
                  style={{
                    color: "#3f3f46",
                    fontSize: 12,
                    fontStyle: "italic",
                    fontFamily: "'Noto Sans JP', sans-serif",
                    padding: "20px 0",
                    textAlign: "center",
                  }}
                >
                  詳細を追加...
                </div>
              )}
            </>
          ) : (
            <>
              {/* Editor */}
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoFocus
                style={{
                  width: "100%",
                  minHeight: 200,
                  background: "#18181b",
                  color: "#d4d4d8",
                  border: "1px solid #27272a",
                  borderRadius: 8,
                  padding: 12,
                  fontSize: 12,
                  lineHeight: 1.6,
                  fontFamily: "'IBM Plex Mono', monospace",
                  resize: "vertical",
                  outline: "none",
                }}
                placeholder="Markdownで詳細を入力..."
                onFocus={(e) => {
                  e.target.style.borderColor = proj.color + "60";
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = "#27272a";
                }}
              />
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginTop: 10,
                  justifyContent: "flex-end",
                }}
              >
                <button
                  onClick={() => setEditing(false)}
                  style={{
                    fontSize: 10,
                    fontFamily: "'Noto Sans JP', sans-serif",
                    padding: "4px 14px",
                    borderRadius: 4,
                    border: "1px solid #27272a",
                    background: "transparent",
                    color: "#71717a",
                    cursor: "pointer",
                  }}
                >
                  キャンセル
                </button>
                <button
                  onClick={handleSave}
                  style={{
                    fontSize: 10,
                    fontFamily: "'Noto Sans JP', sans-serif",
                    padding: "4px 14px",
                    borderRadius: 4,
                    border: "none",
                    background: proj.color,
                    color: "#fff",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
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

// ─── Event Detail Panel ─────────────────────────────────────────────
function EventDetailPanel({ event, onClose }) {
  const proj = event.project ? PROJECTS[event.project] : null;
  const evColor = proj ? proj.color : "#52525b";
  const evStart = timeToMin(event.time);
  const evEnd = timeToMin(event.endTime);
  const duration = evEnd - evStart;
  const meetLabel = event.meetUrl?.includes("zoom")
    ? "Zoom"
    : event.meetUrl?.includes("meet.google")
      ? "Google Meet"
      : "会議リンク";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
        }}
      />
      <div
        style={{
          position: "relative",
          marginTop: "auto",
          background: "#111113",
          borderTop: `2px solid ${evColor}40`,
          borderRadius: "16px 16px 0 0",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          animation: "panelSlideUp 0.25s ease",
        }}
      >
        <style>{`@keyframes panelSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "10px 0 4px",
          }}
        >
          <div
            style={{
              width: 32,
              height: 3,
              borderRadius: 2,
              background: "#27272a",
            }}
          />
        </div>

        {/* Header */}
        <div style={{ padding: "8px 20px 12px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
            }}
          >
            {proj && (
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: evColor,
                }}
              />
            )}
            {proj && (
              <span
                style={{
                  fontSize: 10,
                  color: "#71717a",
                  fontFamily: "'Noto Sans JP', sans-serif",
                }}
              >
                {proj.name}
              </span>
            )}
            <span
              style={{
                fontSize: 10,
                color: "#52525b",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {event.time}–{event.endTime} ({fmtDuration(duration)})
            </span>
          </div>
          <h2
            style={{
              fontFamily: "'Noto Sans JP', sans-serif",
              fontSize: 16,
              fontWeight: 700,
              color: "#fafafa",
              lineHeight: 1.4,
              margin: 0,
            }}
          >
            {event.title}
          </h2>
        </div>

        {/* Meet URL */}
        {event.meetUrl && (
          <div style={{ padding: "0 20px 8px" }}>
            <a
              href={event.meetUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                borderRadius: 6,
                background: event.meetUrl.includes("zoom")
                  ? "#2D8CFF20"
                  : "#00AC4720",
                border: `1px solid ${event.meetUrl.includes("zoom") ? "#2D8CFF30" : "#00AC4730"}`,
                color: event.meetUrl.includes("zoom") ? "#5B9EFF" : "#34D399",
                textDecoration: "none",
                fontSize: 11,
                fontFamily: "'Noto Sans JP', sans-serif",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path
                  d="M10 2H14V6"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M14 2L8 8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <path
                  d="M6 3H3V13H13V10"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {meetLabel}に参加
            </a>
          </div>
        )}

        {/* Attachments */}
        {event.attachments && event.attachments.length > 0 && (
          <div style={{ padding: "0 20px 8px" }}>
            <div
              style={{
                fontSize: 9,
                color: "#52525b",
                marginBottom: 4,
                fontWeight: 600,
                letterSpacing: "0.05em",
              }}
            >
              添付資料
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {event.attachments.map((att, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 10px",
                    background: "#18181b",
                    borderRadius: 5,
                    fontSize: 11,
                    color: "#a1a1aa",
                    fontFamily: "'Noto Sans JP', sans-serif",
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M9 2H4V14H12V5L9 2Z"
                      stroke="#52525b"
                      strokeWidth="1.2"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M9 2V5H12"
                      stroke="#52525b"
                      strokeWidth="1.2"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {att}
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ height: 1, background: "#1c1c1e", margin: "0 20px" }} />

        {/* Description */}
        <div style={{ flex: 1, overflow: "auto", padding: "12px 20px 24px" }}>
          {event.description ? (
            <div>{renderMarkdown(event.description)}</div>
          ) : (
            <div
              style={{
                color: "#3f3f46",
                fontSize: 12,
                fontStyle: "italic",
                fontFamily: "'Noto Sans JP', sans-serif",
                padding: "20px 0",
                textAlign: "center",
              }}
            >
              詳細なし
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

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
          onOpenDetail={setDetailId}
          onOpenEvent={setEventDetailId}
        />
      ) : (
        <TreeView historyData={historyData} />
      )}

      {/* Detail panel overlay */}
      {detailTask && (
        <DetailPanel
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

  // Build timeline slots (free + busy)
  const latestEnd = Math.max(
    18 * 60,
    nowMin,
    ...events.map((e) => timeToMin(e.endTime)),
  );
  const earliestStart = Math.min(
    9 * 60,
    ...events.map((e) => timeToMin(e.time)),
  );
  const DAY_START = Math.floor(earliestStart / 60) * 60; // round down to hour
  const DAY_END = Math.ceil(latestEnd / 60) * 60; // round up to hour

  const timelineSlots = useMemo(() => {
    const sorted = [...events].sort(
      (a, b) => timeToMin(a.time) - timeToMin(b.time),
    );
    const slots = [];
    let cursor = DAY_START;
    sorted.forEach((ev) => {
      const evStart = timeToMin(ev.time);
      const evEnd = timeToMin(ev.endTime);
      if (evStart > cursor) {
        slots.push({
          type: "free",
          start: cursor,
          end: evStart,
          duration: evStart - cursor,
        });
      }
      slots.push({
        type: "event",
        start: evStart,
        end: evEnd,
        duration: evEnd - evStart,
        event: ev,
      });
      cursor = evEnd;
    });
    if (cursor < DAY_END) {
      slots.push({
        type: "free",
        start: cursor,
        end: DAY_END,
        duration: DAY_END - cursor,
      });
    }
    return slots;
  }, [events]);

  const sortedEvents = [...events].sort(
    (a, b) => timeToMin(a.time) - timeToMin(b.time),
  );

  // Find current slot
  const currentSlot = timelineSlots.find(
    (s) => s.start <= nowMin && s.end > nowMin,
  );
  const nextEvent = sortedEvents.find((e) => timeToMin(e.time) > nowMin);
  const minutesUntilNext = nextEvent
    ? timeToMin(nextEvent.time) - nowMin
    : DAY_END - nowMin;

  return (
    <div style={{ padding: "0 0 100px" }}>
      {/* ── Day Timeline ── */}
      <div style={{ padding: "14px 16px 4px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            marginBottom: 10,
          }}
        >
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#22c55e",
              animation: "pulse 2s ease infinite",
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
            {formatDate(TODAY)}
          </span>
          <span
            style={{
              fontSize: 11,
              color: "#e4e4e7",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {fmtMin(nowMin)}
          </span>
          {currentSlot?.type === "free" && (
            <span style={{ fontSize: 10, color: "#22c55e" }}>
              空き {fmtDuration(minutesUntilNext)}
            </span>
          )}
          {currentSlot?.type === "event" && (
            <span style={{ fontSize: 10, color: "#E85D04" }}>
              {currentSlot.event.title}中
            </span>
          )}
        </div>

        {/* Visual timeline bar with duration labels */}
        <div
          style={{
            display: "flex",
            gap: 2,
            height: 28,
            borderRadius: 5,
            overflow: "hidden",
            background: "#18181b",
          }}
        >
          {timelineSlots.map((slot, i) => {
            const widthPct = (slot.duration / (DAY_END - DAY_START)) * 100;
            const isPast = slot.end <= nowMin;
            const isCurrent = slot.start <= nowMin && slot.end > nowMin;
            const nowPct = isCurrent
              ? ((nowMin - slot.start) / slot.duration) * 100
              : 0;
            const label = fmtDuration(slot.duration);

            if (slot.type === "event") {
              const evColor = slot.event.project
                ? PROJECTS[slot.event.project].color
                : "#52525b";
              return (
                <div
                  key={i}
                  style={{
                    width: `${widthPct}%`,
                    minWidth: 3,
                    background: isPast ? `${evColor}25` : `${evColor}50`,
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                  }}
                >
                  {isCurrent && (
                    <div
                      style={{
                        position: "absolute",
                        left: `${nowPct}%`,
                        top: 0,
                        bottom: 0,
                        width: 2,
                        background: "#22c55e",
                        zIndex: 2,
                      }}
                    />
                  )}
                  {widthPct > 4 && (
                    <span
                      style={{
                        fontSize: 7,
                        color: isPast ? "#52525b" : "#e4e4e7",
                        fontVariantNumeric: "tabular-nums",
                        whiteSpace: "nowrap",
                        opacity: 0.8,
                      }}
                    >
                      {label}
                    </span>
                  )}
                </div>
              );
            }
            return (
              <div
                key={i}
                style={{
                  width: `${widthPct}%`,
                  minWidth: 3,
                  background: isPast
                    ? "#111113"
                    : isCurrent
                      ? "#1a2e1a"
                      : "#131316",
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                  border: isCurrent ? "1px solid #22c55e30" : "none",
                  borderRadius: isCurrent ? 3 : 0,
                }}
              >
                {isCurrent && (
                  <div
                    style={{
                      position: "absolute",
                      left: `${nowPct}%`,
                      top: 0,
                      bottom: 0,
                      width: 2,
                      background: "#22c55e",
                      zIndex: 2,
                    }}
                  />
                )}
                {widthPct > 4 && (
                  <span
                    style={{
                      fontSize: 7,
                      color: isPast
                        ? "#27272a"
                        : isCurrent
                          ? "#22c55e"
                          : "#3f3f46",
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {label}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Time labels */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "3px 2px 0",
          }}
        >
          {(() => {
            const startH = DAY_START / 60;
            const endH = DAY_END / 60;
            const span = endH - startH;
            const step = span <= 6 ? 1 : span <= 12 ? 3 : 4;
            const labels = [];
            for (let h = startH; h <= endH; h += step) labels.push(h);
            if (labels[labels.length - 1] !== endH) labels.push(endH);
            return labels.map((h) => (
              <span
                key={h}
                style={{
                  fontSize: 8,
                  color: "#3f3f46",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {h}:00
              </span>
            ));
          })()}
        </div>

        {/* Event cards */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            marginTop: 8,
          }}
        >
          {sortedEvents.map((ev, i) => {
            const evStart = timeToMin(ev.time);
            const evEnd = timeToMin(ev.endTime);
            const isPast = evEnd <= nowMin;
            const isNow = evStart <= nowMin && evEnd > nowMin;
            const evColor = ev.project ? PROJECTS[ev.project].color : "#52525b";
            const isFirstFuture =
              sortedEvents.findIndex((e) => timeToMin(e.time) > nowMin) === i;
            const hasAttachments = ev.attachments && ev.attachments.length > 0;
            const hasMeet = !!ev.meetUrl;
            const isNext = isFirstFuture && !isNow;
            const meetLabel = ev.meetUrl?.includes("zoom") ? "Zoom" : "Meet";

            return (
              <div
                key={ev.id}
                onClick={() => onOpenEvent(ev.id)}
                style={{
                  padding: isNext ? "8px 12px 10px" : "8px 12px",
                  background: "#141416",
                  borderRadius: 6,
                  borderLeft: `3px solid ${isPast ? evColor + "40" : evColor}`,
                  opacity: isPast ? 0.4 : 1,
                  cursor: "pointer",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#1a1a1d";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#141416";
                }}
              >
                {/* Row 1: time + title + badges */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      fontSize: 10,
                      color: "#52525b",
                      fontVariantNumeric: "tabular-nums",
                      flexShrink: 0,
                    }}
                  >
                    {ev.time}–{ev.endTime}
                  </span>
                  <span
                    style={{ fontSize: 9, color: "#3f3f46", flexShrink: 0 }}
                  >
                    ({fmtDuration(evEnd - evStart)})
                  </span>
                  <span
                    style={{
                      fontFamily: "'Noto Sans JP', sans-serif",
                      fontSize: 11,
                      color: isNow ? "#e4e4e7" : "#a1a1aa",
                      fontWeight: isNow ? 500 : 400,
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {ev.title}
                  </span>
                  {hasAttachments && (
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 16 16"
                      fill="none"
                      style={{ flexShrink: 0, opacity: 0.5 }}
                    >
                      <path
                        d="M9 2H4V14H12V5L9 2Z"
                        stroke="#71717a"
                        strokeWidth="1.2"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M9 2V5H12"
                        stroke="#71717a"
                        strokeWidth="1.2"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                  {/* Meet icon for non-NEXT cards */}
                  {hasMeet && !isNext && (
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 16 16"
                      fill="none"
                      style={{ flexShrink: 0, opacity: 0.5 }}
                    >
                      <rect
                        x="1"
                        y="4"
                        width="10"
                        height="8"
                        rx="1"
                        stroke="#71717a"
                        strokeWidth="1.2"
                      />
                      <path
                        d="M11 7L15 5V11L11 9"
                        stroke="#71717a"
                        strokeWidth="1.2"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                  {isNow && (
                    <span
                      style={{
                        fontSize: 8,
                        color: "#22c55e",
                        background: "#22c55e18",
                        padding: "1px 5px",
                        borderRadius: 3,
                        flexShrink: 0,
                      }}
                    >
                      NOW
                    </span>
                  )}
                  {isNext && (
                    <span
                      style={{
                        fontSize: 8,
                        fontWeight: 500,
                        color: "#58A6FF",
                        background: "#58A6FF15",
                        padding: "1px 5px",
                        borderRadius: 3,
                        flexShrink: 0,
                      }}
                    >
                      NEXT
                    </span>
                  )}
                </div>

                {/* Row 2: meet join button (NEXT only) */}
                {isNext && hasMeet && (
                  <div
                    style={{
                      marginTop: 6,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <a
                      href={ev.meetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        padding: "4px 10px",
                        borderRadius: 5,
                        background: ev.meetUrl.includes("zoom")
                          ? "#2D8CFF20"
                          : "#00AC4718",
                        border: `1px solid ${ev.meetUrl.includes("zoom") ? "#2D8CFF30" : "#00AC4725"}`,
                        color: ev.meetUrl.includes("zoom")
                          ? "#5B9EFF"
                          : "#34D399",
                        textDecoration: "none",
                        fontSize: 10,
                        fontFamily: "'Noto Sans JP', sans-serif",
                        fontWeight: 500,
                        transition: "filter 0.15s",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.filter = "brightness(1.2)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.filter = "none";
                      }}
                    >
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 16 16"
                        fill="none"
                      >
                        <rect
                          x="1"
                          y="4"
                          width="10"
                          height="8"
                          rx="1"
                          stroke="currentColor"
                          strokeWidth="1.3"
                        />
                        <path
                          d="M11 7L15 5V11L11 9"
                          stroke="currentColor"
                          strokeWidth="1.3"
                          strokeLinejoin="round"
                        />
                      </svg>
                      {meetLabel}に参加
                    </a>
                    {hasAttachments && (
                      <span
                        style={{
                          fontSize: 9,
                          color: "#52525b",
                          fontFamily: "'Noto Sans JP', sans-serif",
                        }}
                      >
                        資料 {ev.attachments.length}件
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

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
