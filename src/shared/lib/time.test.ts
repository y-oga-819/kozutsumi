import { describe, expect, test } from "vitest";
import { formatDate, formatRelativeTime, fmtDuration, fmtMin, timeToMin } from "./time";

describe("formatDate", () => {
  test('"YYYY-MM-DD" を "M/D (曜)" 形式に整形する', () => {
    // 2026-04-11 は土曜日
    expect(formatDate("2026-04-11")).toBe("4/11 (土)");
  });

  test("月日はゼロ埋めせず、曜日は日本語1文字", () => {
    // 2026-01-05 は月曜日
    expect(formatDate("2026-01-05")).toBe("1/5 (月)");
  });
});

describe("timeToMin", () => {
  test('"HH:MM" を 0:00 からの経過分数に変換する', () => {
    expect(timeToMin("09:30")).toBe(9 * 60 + 30);
    expect(timeToMin("00:00")).toBe(0);
    expect(timeToMin("23:59")).toBe(23 * 60 + 59);
  });
});

describe("fmtDuration", () => {
  test("60分未満は 'Xm'", () => {
    expect(fmtDuration(30)).toBe("30m");
    expect(fmtDuration(59)).toBe("59m");
  });

  test("ちょうど時間単位は 'Xh'（分部分は省略）", () => {
    expect(fmtDuration(60)).toBe("1h");
    expect(fmtDuration(120)).toBe("2h");
  });

  test("時間+分は 'XhYYm'（分は2桁ゼロ埋め）", () => {
    expect(fmtDuration(90)).toBe("1h30m");
    expect(fmtDuration(75)).toBe("1h15m");
    expect(fmtDuration(65)).toBe("1h05m");
  });
});

describe("fmtMin", () => {
  test("経過分数を 'H:MM' 形式（分は2桁ゼロ埋め）", () => {
    expect(fmtMin(570)).toBe("9:30");
    expect(fmtMin(0)).toBe("0:00");
    expect(fmtMin(605)).toBe("10:05");
  });
});

describe("formatRelativeTime", () => {
  // 基準時刻: 2026-04-11 (土) 09:00
  const now = new Date("2026-04-11T09:00:00");

  test("過去 / 1分以内は「もうすぐ」", () => {
    expect(formatRelativeTime("2026-04-11T08:30:00", now)).toBe("もうすぐ");
    expect(formatRelativeTime("2026-04-11T09:00:30", now)).toBe("もうすぐ");
  });

  test("1時間未満は「N分後」", () => {
    expect(formatRelativeTime("2026-04-11T09:30:00", now)).toBe("30分後");
    expect(formatRelativeTime("2026-04-11T09:59:00", now)).toBe("59分後");
  });

  test("同日 1 時間以上後は「今日 HH:MM」", () => {
    expect(formatRelativeTime("2026-04-11T14:00:00", now)).toBe("今日 14:00");
    expect(formatRelativeTime("2026-04-11T23:30:00", now)).toBe("今日 23:30");
  });

  test("翌日は「明日 HH:MM」", () => {
    expect(formatRelativeTime("2026-04-12T08:00:00", now)).toBe("明日 08:00");
    expect(formatRelativeTime("2026-04-12T23:59:00", now)).toBe("明日 23:59");
  });

  test("2日以上先は「M/D HH:MM」", () => {
    expect(formatRelativeTime("2026-04-15T10:00:00", now)).toBe("4/15 10:00");
    expect(formatRelativeTime("2026-05-02T18:30:00", now)).toBe("5/2 18:30");
  });
});
