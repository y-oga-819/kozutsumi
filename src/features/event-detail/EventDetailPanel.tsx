import type { Event } from "../../entities/event/types";
import { PROJECTS } from "../../entities/project/projects";
import {
  fmtDuration,
  formatClock,
  minutesOfDay,
} from "../../shared/lib/time";
import { renderMarkdown } from "../../shared/lib/markdown";

type EventDetailPanelProps = {
  event: Event;
  onClose: () => void;
};

export function EventDetailPanel({ event, onClose }: EventDetailPanelProps) {
  const proj = event.projectId ? PROJECTS[event.projectId] : null;
  const evColor = proj ? proj.color : "#52525b";
  const evStart = minutesOfDay(event.startTime);
  const evEnd = minutesOfDay(event.endTime);
  const duration = evEnd - evStart;
  const isZoom = !!event.meetUrl?.includes("zoom");
  const meetLabel = event.meetUrl?.includes("zoom")
    ? "Zoom"
    : event.meetUrl?.includes("meet.google")
      ? "Google Meet"
      : "会議リンク";

  return (
    <div className="fixed inset-0 z-[200] flex flex-col">
      <div
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[4px]"
      />
      <div
        className="relative mt-auto flex max-h-[85vh] animate-panel-slide-up flex-col rounded-t-2xl bg-bg-surface"
        style={{
          borderTop: `2px solid ${evColor}40`,
        }}
      >
        <div className="flex justify-center px-0 pb-1 pt-2.5">
          <div className="h-[3px] w-8 rounded-[2px] bg-bg-divider" />
        </div>

        <div className="px-5 pb-3 pt-2">
          <div className="mb-2 flex items-center gap-2">
            {proj && (
              <div
                className="h-2 w-2 rounded-full"
                style={{ background: evColor }}
              />
            )}
            {proj && (
              <span className="font-jp text-[10px] text-fg-subtle">
                {proj.name}
              </span>
            )}
            <span className="text-[10px] tabular-nums text-fg-weak">
              {formatClock(event.startTime)}–{formatClock(event.endTime)} ({fmtDuration(duration)})
            </span>
          </div>
          <h2 className="m-0 font-jp text-[16px] font-bold leading-[1.4] text-fg-strong">
            {event.title}
          </h2>
        </div>

        {event.meetUrl && (
          <div className="px-5 pb-2">
            <a
              href={event.meetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-jp text-[11px] no-underline ${
                isZoom
                  ? "border border-[#2D8CFF30] bg-[#2D8CFF20] text-accent-zoomFg"
                  : "border border-[#00AC4730] bg-[#00AC4720] text-accent-meetFg"
              }`}
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

        {event.hasAttachments && (
          <div className="px-5 pb-2">
            <div className="flex items-center gap-1.5 rounded-[5px] bg-bg-elevated px-2.5 py-[5px] font-jp text-[11px] text-fg-muted">
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
              添付資料あり
            </div>
          </div>
        )}

        <div className="mx-5 h-px bg-bg-border" />

        <div className="flex-1 overflow-auto px-5 pb-6 pt-3">
          {event.description ? (
            <div>{renderMarkdown(event.description)}</div>
          ) : (
            <div className="py-5 text-center font-jp text-[12px] italic text-fg-faint">
              詳細なし
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
