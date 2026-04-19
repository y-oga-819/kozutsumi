import { describe, expect, test } from "vitest";
import {
  COL,
  GRAPH_LEFT,
  groupByDateDesc,
  laneLeftPx,
  lanesWidthPx,
  nodeCenterPx,
} from "./layout";

describe("laneLeftPx / nodeCenterPx / lanesWidthPx", () => {
  test("プロジェクトインデックス 0 のレーン位置", () => {
    expect(laneLeftPx(0)).toBe(GRAPH_LEFT + 0 + COL / 2 - 1 + 16);
    expect(nodeCenterPx(0)).toBe(16 + GRAPH_LEFT + 0 + COL / 2);
  });

  test("プロジェクト数に比例してレーン幅が伸びる", () => {
    expect(lanesWidthPx(1)).toBe(GRAPH_LEFT + COL + 6);
    expect(lanesWidthPx(4)).toBe(GRAPH_LEFT + COL * 4 + 6);
  });
});

describe("groupByDateDesc", () => {
  test("空配列は空配列を返す", () => {
    expect(groupByDateDesc([])).toEqual([]);
  });

  test("日付でグループ化し、日付降順でソート", () => {
    const history: import("../../entities/task/types").HistoryEntry[] = [
      { id: "h1", date: "2026-04-05", title: "t1", projectId: "career" },
      { id: "h2", date: "2026-04-07", title: "t2", projectId: "slo" },
      { id: "h3", date: "2026-04-05", title: "t3", projectId: "loadtest" },
      { id: "h4", date: "2026-04-06", title: "t4", projectId: "tasuki" },
    ];
    const result = groupByDateDesc(history);
    expect(result.map(([date]) => date)).toEqual([
      "2026-04-07",
      "2026-04-06",
      "2026-04-05",
    ]);
    expect(result[2][1]).toHaveLength(2);
  });
});
