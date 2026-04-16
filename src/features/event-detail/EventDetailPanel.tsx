import type { Event } from "../../entities/event/types";
import { PROJECTS } from "../../entities/project/projects";
import { fmtDuration, timeToMin } from "../../shared/lib/time";
import { renderMarkdown } from "../../shared/lib/markdown";

type EventDetailPanelProps = {
  event: Event;
  onClose: () => void;
};

export function EventDetailPanel({ event, onClose }: EventDetailPanelProps) {
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
