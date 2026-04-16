import { PROJECTS } from "../../entities/project/projects.js";
import { Grip } from "./Grip.jsx";

function bodyPreview(body) {
  if (!body) return "";
  return body.split("\n").find((l) => l.trim() && !l.startsWith("#")) || "";
}

export function TopTaskCard({
  task,
  events,
  isBeingDragged,
  onPointerDown,
  onClick,
  onToggleDone,
}) {
  const proj = PROJECTS[task.project];
  const dep = task.dependsOn
    ? events.find((e) => e.id === task.dependsOn)
    : null;
  const preview = bodyPreview(task.body);

  return (
    <div
      onClick={onClick}
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
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div
          onPointerDown={(e) => {
            e.stopPropagation();
            onPointerDown(e);
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
            {dep && (
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
            )}
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
          {preview && (
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
              {preview}
            </div>
          )}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleDone();
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
  );
}
