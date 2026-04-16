import { PROJECTS } from "../../entities/project/projects.js";
import { fmtDuration, timeToMin } from "../../shared/lib/time.js";

export function EventCard({ event, nowMin, isNextCandidate, onClick }) {
  const evStart = timeToMin(event.time);
  const evEnd = timeToMin(event.endTime);
  const isPast = evEnd <= nowMin;
  const isNow = evStart <= nowMin && evEnd > nowMin;
  const isNext = isNextCandidate && !isNow;
  const evColor = event.project ? PROJECTS[event.project].color : "#52525b";
  const hasAttachments = event.attachments && event.attachments.length > 0;
  const hasMeet = !!event.meetUrl;
  const meetLabel = event.meetUrl?.includes("zoom") ? "Zoom" : "Meet";

  return (
    <div
      onClick={onClick}
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
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            fontSize: 10,
            color: "#52525b",
            fontVariantNumeric: "tabular-nums",
            flexShrink: 0,
          }}
        >
          {event.time}–{event.endTime}
        </span>
        <span style={{ fontSize: 9, color: "#3f3f46", flexShrink: 0 }}>
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
          {event.title}
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
            href={event.meetUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "4px 10px",
              borderRadius: 5,
              background: event.meetUrl.includes("zoom")
                ? "#2D8CFF20"
                : "#00AC4718",
              border: `1px solid ${event.meetUrl.includes("zoom") ? "#2D8CFF30" : "#00AC4725"}`,
              color: event.meetUrl.includes("zoom") ? "#5B9EFF" : "#34D399",
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
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
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
              資料 {event.attachments.length}件
            </span>
          )}
        </div>
      )}
    </div>
  );
}
