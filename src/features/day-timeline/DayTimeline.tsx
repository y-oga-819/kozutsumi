import { useMemo } from "react";
import type { Event } from "../../entities/event/types";
import { fmtDuration, fmtMin, formatDate, localDateOf, minutesOfDay } from "../../shared/lib/time";
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
  // 呼び出し側 (AppShell) は events を全期間取得して渡す。タイムラインは today に始まる
  // event だけを対象にする (minutesOfDay は HH:MM のみ抽出するため、日付フィルタが
  // 抜けると昨日 / 明日の event が今日のバーに重なる)。
  const todayEvents = useMemo(
    () => events.filter((e) => localDateOf(e.startTime) === today),
    [events, today],
  );
  const { dayStart, dayEnd } = computeDayBounds(todayEvents, nowMin);
  const slots = useMemo(
    () => buildSlots(todayEvents, dayStart, dayEnd),
    [todayEvents, dayStart, dayEnd],
  );
  const sortedEvents = useMemo(
    () => [...todayEvents].sort((a, b) => minutesOfDay(a.startTime) - minutesOfDay(b.startTime)),
    [todayEvents],
  );

  const currentSlot = slots.find((s) => s.start <= nowMin && s.end > nowMin);
  const nextEvent = sortedEvents.find((e) => minutesOfDay(e.startTime) > nowMin);
  const minutesUntilNext = nextEvent ? minutesOfDay(nextEvent.startTime) - nowMin : dayEnd - nowMin;
  const firstFutureIdx = sortedEvents.findIndex((e) => minutesOfDay(e.startTime) > nowMin);

  return (
    <section aria-label="本日のタイムライン" className="px-4 pb-1 pt-3.5">
      <div className="mb-2.5 flex items-baseline gap-2">
        <div
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent-green"
        />
        <span className="font-jp text-[11px] text-fg-subtle">{formatDate(today)}</span>
        <span className="text-[11px] tabular-nums text-fg-emphasized">{fmtMin(nowMin)}</span>
        {currentSlot?.type === "free" && (
          <span className="text-[10px] text-accent-green">
            空き {fmtDuration(minutesUntilNext)}
          </span>
        )}
        {currentSlot?.type === "event" && (
          <span className="text-[10px] text-accent-amber">{currentSlot.event.title}中</span>
        )}
      </div>

      <TimelineBar slots={slots} nowMin={nowMin} dayStart={dayStart} dayEnd={dayEnd} />

      <ul
        role="list"
        aria-label="本日のイベント"
        className="m-0 mt-2 flex list-none flex-col gap-1 p-0"
      >
        {sortedEvents.map((ev, i) => (
          <li key={ev.id}>
            <EventCard
              event={ev}
              nowMin={nowMin}
              isNextCandidate={i === firstFutureIdx}
              onClick={() => onOpenEvent(ev.id)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
