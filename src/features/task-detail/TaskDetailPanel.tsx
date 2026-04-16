import { useState } from "react";
import type { Task } from "../../entities/task/types";
import type { Event } from "../../entities/event/types";
import { PROJECTS } from "../../entities/project/projects";
import { renderMarkdown } from "../../shared/lib/markdown";

export type TaskDetailPanelProps = {
  task: Task;
  events: Event[];
  onClose: () => void;
  onUpdate: (id: string, body: string) => void;
  onToggleDone: (id: string) => void;
};

export function TaskDetailPanel({ task, events, onClose, onUpdate, onToggleDone }: TaskDetailPanelProps) {
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

        <div style={{ height: 1, background: "#1c1c1e", margin: "0 20px" }} />

        <div style={{ flex: 1, overflow: "auto", padding: "12px 20px 24px" }}>
          {!editing ? (
            <>
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
