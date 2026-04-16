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
          {formatDate(today)}
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

      <TimelineBar
        slots={slots}
        nowMin={nowMin}
        dayStart={dayStart}
        dayEnd={dayEnd}
      />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          marginTop: 8,
        }}
      >
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
