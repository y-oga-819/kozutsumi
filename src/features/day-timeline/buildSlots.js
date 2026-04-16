import { timeToMin } from "../../shared/lib/time.js";

/**
 * その日の表示範囲（時間単位に丸めた DAY_START / DAY_END）を決める。
 *
 * - 9:00-18:00 を基本
 * - より早い開始 / より遅い終了 / nowMin が範囲外なら拡張
 */
export function computeDayBounds(events, nowMin) {
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

/**
 * events を時系列の slot 配列に変換する。
 * slot は `{ type: 'free' | 'event', start, end, duration, event? }`。
 * event 間の空白は free slot として埋められる。
 */
export function buildSlots(events, dayStart, dayEnd) {
  const sorted = [...events].sort(
    (a, b) => timeToMin(a.time) - timeToMin(b.time),
  );
  const slots = [];
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
