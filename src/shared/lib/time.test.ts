import { describe, expect, test } from "vitest";
import { formatDate, fmtDuration, fmtMin, timeToMin } from "./time";

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
