import type { Event } from "../../entities/event/types";
import { timeToMin } from "../../shared/lib/time";

export type EventSlot = {
  type: "event";
  start: number;
  end: number;
  duration: number;
  event: Event;
};

export type FreeSlot = {
  type: "free";
  start: number;
  end: number;
  duration: number;
};

export type Slot = EventSlot | FreeSlot;

export function computeDayBounds(
  events: readonly Event[],
  nowMin: number,
): { dayStart: number; dayEnd: number } {
  const latestEnd = Math.max(
    18 * 60,
    nowMin,
    ...events.map((e) => timeToMin(e.endTime)),
  );
  const earliestStart = Math.min(
    9 * 60,
    ...events.map((e) => timeToMin(e.time)),
  );
  return {
    dayStart: Math.floor(earliestStart / 60) * 60,
    dayEnd: Math.ceil(latestEnd / 60) * 60,
  };
}

export function buildSlots(
  events: readonly Event[],
  dayStart: number,
  dayEnd: number,
): Slot[] {
  const sorted = [...events].sort(
    (a, b) => timeToMin(a.time) - timeToMin(b.time),
  );
  const slots: Slot[] = [];
  let cursor = dayStart;
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
  if (cursor < dayEnd) {
    slots.push({
      type: "free",
      start: cursor,
      end: dayEnd,
      duration: dayEnd - cursor,
    });
  }
  return slots;
}
