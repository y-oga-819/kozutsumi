import type { Event } from "../../entities/event/types";
import { minutesOfDay } from "../../shared/lib/time";

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
  const latestEnd = Math.max(18 * 60, nowMin, ...events.map((e) => minutesOfDay(e.endTime)));
  const earliestStart = Math.min(9 * 60, ...events.map((e) => minutesOfDay(e.startTime)));
  return {
    dayStart: Math.floor(earliestStart / 60) * 60,
    dayEnd: Math.ceil(latestEnd / 60) * 60,
  };
}

export function buildSlots(events: readonly Event[], dayStart: number, dayEnd: number): Slot[] {
  const sorted = [...events].sort((a, b) => minutesOfDay(a.startTime) - minutesOfDay(b.startTime));
  const slots: Slot[] = [];
  let cursor = dayStart;
  sorted.forEach((ev) => {
    const evStart = minutesOfDay(ev.startTime);
    const evEnd = minutesOfDay(ev.endTime);
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
