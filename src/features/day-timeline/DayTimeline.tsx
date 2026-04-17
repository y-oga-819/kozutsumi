import { useMemo } from "react";
import type { Event } from "../../entities/event/types";
import { fmtDuration, fmtMin, formatDate, timeToMin } from "../../shared/lib/time";
import { buildSlots, computeDayBounds } from "./buildSlots";
import { EventCard } from "./EventCard";
import { TimelineBar } from "./TimelineBar";

type DayTimelineProps = {
  events: Event[];
  nowMin: number;
  today: string;
  onOpenEvent: (id: string) => void;
};

export function DayTimeline({ events, nowMin, today, onOpenEvent }: DayTimelineProps) {
  const { dayStart, dayEnd } = computeDayBounds(events, nowMin);
  const slots = useMemo(
    () => buildSlots(events, dayStart, dayEnd),
    [events, dayStart, dayEnd],
  );
  const sortedEvents = useMemo(
    () =>
      [...events].sort((a, b) => timeToMin(a.time) - timeToMin(b.time)),
    [events],
  );

  const currentSlot = slots.find((s) => s.start <= nowMin && s.end > nowMin);
  const nextEvent = sortedEvents.find((e) => timeToMin(e.time) > nowMin);
  const minutesUntilNext = nextEvent
    ? timeToMin(nextEvent.time) - nowMin
    : dayEnd - nowMin;
  const firstFutureIdx = sortedEvents.findIndex(
    (e) => timeToMin(e.time) > nowMin,
  );

  return (
    <div className="px-4 pb-1 pt-3.5">
      <div className="mb-2.5 flex items-baseline gap-2">
        <div className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent-green" />
        <span className="font-jp text-[11px] text-fg-subtle">
          {formatDate(today)}
        </span>
        <span className="text-[11px] tabular-nums text-fg-emphasized">
          {fmtMin(nowMin)}
        </span>
        {currentSlot?.type === "free" && (
          <span className="text-[10px] text-accent-green">
            空き {fmtDuration(minutesUntilNext)}
          </span>
        )}
        {currentSlot?.type === "event" && (
          <span className="text-[10px] text-accent-amber">
            {currentSlot.event.title}中
          </span>
        )}
      </div>

      <TimelineBar
        slots={slots}
        nowMin={nowMin}
        dayStart={dayStart}
        dayEnd={dayEnd}
      />

      <div className="mt-2 flex flex-col gap-1">
        {sortedEvents.map((ev, i) => (
          <EventCard
            key={ev.id}
            event={ev}
            nowMin={nowMin}
            isNextCandidate={i === firstFutureIdx}
            onClick={() => onOpenEvent(ev.id)}
          />
        ))}
      </div>
    </div>
  );
}
