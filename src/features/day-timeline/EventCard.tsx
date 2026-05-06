import { EVENT_SOURCE, type Event } from "../../entities/event/types";
import { getProject } from "../../entities/project/projects";
import { useProjects } from "../../entities/project/ProjectsContext";
import {
  allDayDayCount,
  fmtDuration,
  formatAllDayRange,
  formatClock,
  isAllDayEvent,
  isDeadlineEvent,
  minutesOfDay,
} from "../../shared/lib/time";
import { GoogleCalendarBadge } from "../../entities/event/GoogleCalendarBadge";

type EventCardProps = {
  event: Event;
  nowMin: number;
  isNextCandidate: boolean;
  onClick: () => void;
};

export function EventCard({ event, nowMin, isNextCandidate, onClick }: EventCardProps) {
  const { projectsById } = useProjects();
  // ADR-0050: 終日 / ゼロ長 event は時刻判定 (past / now / next) を持たない。
  // 終日は「今日中ずっと有効」、ゼロ長 (締切系) は時点で完結し past/now で揺れさせない。
  const isAllDay = isAllDayEvent(event);
  const isDeadline = !isAllDay && isDeadlineEvent(event);
  const evStart = minutesOfDay(event.startTime);
  const evEnd = minutesOfDay(event.endTime);
  const isPast = !isAllDay && !isDeadline && evEnd <= nowMin;
  const isNow = !isAllDay && !isDeadline && evStart <= nowMin && evEnd > nowMin;
  const isNext = !isAllDay && !isDeadline && isNextCandidate && !isNow;
  const evColor = event.projectId ? getProject(projectsById, event.projectId).color : "#52525b";
  const hasAttachments = event.hasAttachments;
  const hasMeet = !!event.meetUrl;
  const meetLabel = event.meetUrl?.includes("zoom") ? "Zoom" : "Meet";
  const isZoom = !!event.meetUrl?.includes("zoom");
  const isGoogleCalendar = event.source === EVENT_SOURCE.GOOGLE_CALENDAR;

  return (
    <div
      onClick={onClick}
      className={`cursor-pointer rounded-md bg-bg-muted transition-[background] duration-100 hover:bg-bg-hover ${
        isNext ? "px-3 pb-2.5 pt-2" : "px-3 py-2"
      } ${isPast ? "opacity-40" : "opacity-100"}`}
      style={{
        borderLeft: `3px solid ${isPast ? evColor + "40" : evColor}`,
      }}
    >
      <div className="flex items-center gap-2">
        {isAllDay ? (
          <span
            aria-label="終日"
            className="shrink-0 rounded-[3px] border border-bg-divider px-1.5 py-px font-jp text-[9px] text-fg-subtle"
          >
            終日
          </span>
        ) : isDeadline ? (
          <span
            aria-label={`${formatClock(event.startTime)} 締切`}
            className="shrink-0 text-[10px] tabular-nums text-fg-weak"
          >
            ⏰ {formatClock(event.startTime)}
          </span>
        ) : (
          <>
            <span className="shrink-0 text-[10px] tabular-nums text-fg-weak">
              {formatClock(event.startTime)}–{formatClock(event.endTime)}
            </span>
            <span className="shrink-0 text-[9px] text-fg-faint">
              ({fmtDuration(evEnd - evStart)})
            </span>
          </>
        )}
        {isAllDay && allDayDayCount(event) > 1 ? (
          <span className="shrink-0 text-[9px] tabular-nums text-fg-faint">
            ({formatAllDayRange(event)})
          </span>
        ) : null}
        <span
          className={`flex-1 truncate font-jp text-[11px] ${
            isNow ? "font-medium text-fg-emphasized" : "font-normal text-fg-muted"
          }`}
        >
          {event.title}
        </span>
        {isGoogleCalendar && <GoogleCalendarBadge />}
        {hasAttachments && (
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            className="shrink-0 opacity-50"
          >
            <path
              d="M9 2H4V14H12V5L9 2Z"
              stroke="#71717a"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
            <path d="M9 2V5H12" stroke="#71717a" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
        )}
        {hasMeet && !isNext && (
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            className="shrink-0 opacity-50"
          >
            <rect x="1" y="4" width="10" height="8" rx="1" stroke="#71717a" strokeWidth="1.2" />
            <path
              d="M11 7L15 5V11L11 9"
              stroke="#71717a"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
          </svg>
        )}
        {isNow && (
          <span className="shrink-0 rounded-[3px] bg-[#22c55e18] px-[5px] py-px text-[8px] text-accent-green">
            NOW
          </span>
        )}
        {isNext && (
          <span className="shrink-0 rounded-[3px] bg-[#58A6FF15] px-[5px] py-px text-[8px] font-medium text-accent-blue">
            NEXT
          </span>
        )}
      </div>

      {isNext && hasMeet && (
        <div className="mt-1.5 flex items-center gap-2">
          <a
            href={event.meetUrl ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={`inline-flex items-center gap-[5px] rounded-[5px] px-2.5 py-1 font-jp text-[10px] font-medium no-underline transition-[filter] duration-150 hover:brightness-125 ${
              isZoom
                ? "border border-[#2D8CFF30] bg-[#2D8CFF20] text-accent-zoomFg"
                : "border border-[#00AC4725] bg-[#00AC4718] text-accent-meetFg"
            }`}
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
          {hasAttachments && <span className="font-jp text-[9px] text-fg-weak">資料あり</span>}
        </div>
      )}
    </div>
  );
}
