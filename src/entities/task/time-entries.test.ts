import { describe, expect, test } from "vitest";

import { sumDurationSeconds, type TimeEntry } from "./time-entries";

function entry(overrides: Partial<TimeEntry>): TimeEntry {
  return {
    id: "e",
    taskId: "t",
    startedAt: "2026-04-19T10:00:00.000Z",
    pausedAt: null,
    pauseReason: null,
    durationSeconds: null,
    ...overrides,
  };
}

describe("sumDurationSeconds", () => {
  test("空配列は 0", () => {
    expect(sumDurationSeconds([])).toBe(0);
  });

  test("閉じた entry の duration_seconds を合計する", () => {
    const entries = [
      entry({ id: "1", durationSeconds: 60, pausedAt: "x" }),
      entry({ id: "2", durationSeconds: 120, pausedAt: "y" }),
    ];
    expect(sumDurationSeconds(entries)).toBe(180);
  });

  test("open entry は referenceTime - startedAt の経過秒数を加算する", () => {
    const startedAt = "2026-04-19T10:00:00.000Z";
    const reference = new Date("2026-04-19T10:00:30.000Z").getTime();
    const entries = [entry({ startedAt })];
    expect(sumDurationSeconds(entries, reference)).toBe(30);
  });

  test("閉じた entry + open entry を両方カウントする (中断→再開)", () => {
    const reference = new Date("2026-04-19T10:05:00.000Z").getTime();
    const entries = [
      // 1分稼働して中断
      entry({
        id: "1",
        startedAt: "2026-04-19T10:00:00.000Z",
        pausedAt: "2026-04-19T10:01:00.000Z",
        durationSeconds: 60,
        pauseReason: "voluntary",
      }),
      // 再開して 4 分経過 (open)
      entry({
        id: "2",
        startedAt: "2026-04-19T10:01:00.000Z",
      }),
    ];
    expect(sumDurationSeconds(entries, reference)).toBe(60 + 240);
  });

  test("負の経過時間は 0 にクランプする (時刻の巻き戻り防御)", () => {
    const startedAt = "2026-04-19T10:00:00.000Z";
    const reference = new Date("2026-04-19T09:00:00.000Z").getTime();
    expect(sumDurationSeconds([entry({ startedAt })], reference)).toBe(0);
  });
});
