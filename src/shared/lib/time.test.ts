import { describe, expect, test } from "vitest";
import {
  allDayDayCount,
  formatAllDayRange,
  formatDate,
  formatJstMonthDay,
  formatRelativeTime,
  fmtDuration,
  fmtMin,
  isAllDayEvent,
  isDeadlineEvent,
  localDateOf,
  timeToMin,
  toDateTimeLocalInput,
} from "./time";

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

describe("localDateOf", () => {
  test("ISO 8601 文字列のローカル日付を YYYY-MM-DD で返す", () => {
    expect(localDateOf("2026-04-11T09:00:00")).toBe("2026-04-11");
    expect(localDateOf("2026-04-11T23:59:59")).toBe("2026-04-11");
  });

  test("月日は 2 桁ゼロ埋めする", () => {
    expect(localDateOf("2026-01-02T03:04:05")).toBe("2026-01-02");
  });
});

describe("isAllDayEvent (ADR-0050)", () => {
  test("JST 00:00 開始 + 24h で終日と判定する", () => {
    expect(
      isAllDayEvent({
        // 2026-05-06 JST 00:00 = 2026-05-05 15:00 UTC
        startTime: "2026-05-05T15:00:00.000Z",
        endTime: "2026-05-06T15:00:00.000Z",
      }),
    ).toBe(true);
  });

  test("JST 00:00 開始 + 24h の倍数 (複数日終日) も true", () => {
    expect(
      isAllDayEvent({
        startTime: "2026-05-05T15:00:00.000Z",
        endTime: "2026-05-08T15:00:00.000Z", // 3 日連続
      }),
    ).toBe(true);
  });

  test("JST 00:00 開始でも duration が 24h 未満なら false", () => {
    expect(
      isAllDayEvent({
        startTime: "2026-05-05T15:00:00.000Z",
        endTime: "2026-05-06T03:00:00.000Z",
      }),
    ).toBe(false);
  });

  test("JST 00:00 開始でも duration が 0 なら false (ゼロ長は終日ではない)", () => {
    expect(
      isAllDayEvent({
        startTime: "2026-05-05T15:00:00.000Z",
        endTime: "2026-05-05T15:00:00.000Z",
      }),
    ).toBe(false);
  });

  test("JST 00:00 でない開始は false (通常の timed event)", () => {
    expect(
      isAllDayEvent({
        // 2026-05-06 JST 10:00
        startTime: "2026-05-06T01:00:00.000Z",
        endTime: "2026-05-06T02:00:00.000Z",
      }),
    ).toBe(false);
  });
});

describe("isDeadlineEvent (ADR-0050)", () => {
  test("start === end は true", () => {
    expect(
      isDeadlineEvent({
        startTime: "2026-05-06T09:00:00.000Z",
        endTime: "2026-05-06T09:00:00.000Z",
      }),
    ).toBe(true);
  });

  test("start !== end は false", () => {
    expect(
      isDeadlineEvent({
        startTime: "2026-05-06T09:00:00.000Z",
        endTime: "2026-05-06T10:00:00.000Z",
      }),
    ).toBe(false);
  });
});

describe("allDayDayCount", () => {
  test("単日終日は 1", () => {
    expect(
      allDayDayCount({
        startTime: "2026-05-05T15:00:00.000Z",
        endTime: "2026-05-06T15:00:00.000Z",
      }),
    ).toBe(1);
  });

  test("3 日連続終日は 3", () => {
    expect(
      allDayDayCount({
        startTime: "2026-05-05T15:00:00.000Z",
        endTime: "2026-05-08T15:00:00.000Z",
      }),
    ).toBe(3);
  });
});

describe("formatJstMonthDay", () => {
  test("UTC ISO を JST の M/D で返す", () => {
    // 2026-05-05 15:00 UTC = 2026-05-06 JST
    expect(formatJstMonthDay("2026-05-05T15:00:00.000Z")).toBe("5/6");
  });

  test("日付境界ケース (UTC 23:30 = JST 翌 8:30) でも JST 日付を返す", () => {
    expect(formatJstMonthDay("2026-05-05T23:30:00.000Z")).toBe("5/6");
  });
});

describe("formatAllDayRange", () => {
  test("単日終日は M/D だけ返す", () => {
    expect(
      formatAllDayRange({
        startTime: "2026-05-05T15:00:00.000Z",
        endTime: "2026-05-06T15:00:00.000Z",
      }),
    ).toBe("5/6");
  });

  test("複数日終日は inclusive 末日まで M/D → M/D 形式で返す", () => {
    expect(
      formatAllDayRange({
        startTime: "2026-05-05T15:00:00.000Z",
        endTime: "2026-05-08T15:00:00.000Z", // exclusive end (= 5/9 JST 00:00 ではなく 5/8 JST 24:00)
      }),
    ).toBe("5/6 → 5/8");
  });
});

describe("toDateTimeLocalInput", () => {
  test("ISO 8601 (tz なし) を datetime-local の YYYY-MM-DDTHH:MM 形式で返す", () => {
    expect(toDateTimeLocalInput("2026-04-11T09:05:00")).toBe("2026-04-11T09:05");
  });

  test("月 / 日 / 時 / 分は 2 桁ゼロ埋め", () => {
    expect(toDateTimeLocalInput("2026-01-02T03:04:00")).toBe("2026-01-02T03:04");
  });

  test("秒は落とす (datetime-local は分単位)", () => {
    expect(toDateTimeLocalInput("2026-04-11T10:00:45")).toBe("2026-04-11T10:00");
  });
});
