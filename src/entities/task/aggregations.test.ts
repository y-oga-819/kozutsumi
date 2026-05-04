import { describe, expect, test } from "vitest";

import type { Task } from "./types";

import {
  aggregateChildren,
  excludeDecomposedParents,
  getChildren,
  sumEstimatedMinutes,
} from "./aggregations";

const baseTask: Task = {
  id: "t",
  projectId: "p1",
  title: "task",
  body: "",
  estimatedMinutes: 30,
  status: "idle",
  stackOrder: 0,
  dependsOnEventId: null,
  isInterruption: false,
  parentTaskId: null,
  decomposeStatus: "none",
  taskCategory: null,
  taskSize: null,
  createdAt: "2026-04-27T00:00:00",
  completedAt: null,
};

const t = (overrides: Partial<Task> & { id: string }): Task => ({ ...baseTask, ...overrides });

describe("excludeDecomposedParents", () => {
  test("decomposed 親を除外し、それ以外 (none / decomposing / skipped / failed / 子) は残す", () => {
    const decomposed = t({ id: "p", decomposeStatus: "decomposed" });
    const decomposing = t({ id: "a", decomposeStatus: "decomposing" });
    const skipped = t({ id: "b", decomposeStatus: "skipped" });
    const failed = t({ id: "f", decomposeStatus: "failed" });
    const none = t({ id: "c", decomposeStatus: "none" });
    const child = t({ id: "ch", parentTaskId: "p" });

    const result = excludeDecomposedParents([
      decomposed,
      decomposing,
      skipped,
      failed,
      none,
      child,
    ]);

    expect(result.map((x) => x.id)).toEqual(["a", "b", "f", "c", "ch"]);
  });

  test("空配列なら空配列を返す", () => {
    expect(excludeDecomposedParents([])).toEqual([]);
  });

  test("元配列を変更しない (不変性)", () => {
    const tasks = [t({ id: "p", decomposeStatus: "decomposed" }), t({ id: "x" })];
    const original = [...tasks];
    excludeDecomposedParents(tasks);
    expect(tasks).toEqual(original);
  });
});

describe("getChildren", () => {
  test("親 id 直下の子だけを返し、入力順を保つ", () => {
    const parent = t({ id: "p", decomposeStatus: "decomposed" });
    const c1 = t({ id: "c1", parentTaskId: "p" });
    const c2 = t({ id: "c2", parentTaskId: "p" });
    const otherParent = t({ id: "p2" });
    const otherChild = t({ id: "c3", parentTaskId: "p2" });

    expect(getChildren("p", [parent, c2, c1, otherParent, otherChild]).map((x) => x.id)).toEqual([
      "c2",
      "c1",
    ]);
  });

  test("孫 (parent の子の子) は含まない (1 段のみ)", () => {
    const parent = t({ id: "p" });
    const child = t({ id: "c", parentTaskId: "p" });
    const grandchild = t({ id: "gc", parentTaskId: "c" });

    expect(getChildren("p", [parent, child, grandchild]).map((x) => x.id)).toEqual(["c"]);
  });

  test("該当する子がなければ空配列", () => {
    expect(getChildren("missing", [t({ id: "x" })])).toEqual([]);
  });
});

describe("sumEstimatedMinutes", () => {
  test("全件に値があれば総和", () => {
    expect(
      sumEstimatedMinutes([
        t({ id: "a", estimatedMinutes: 10 }),
        t({ id: "b", estimatedMinutes: 25 }),
      ]),
    ).toBe(35);
  });

  test("一部 null は無視して残りの合計", () => {
    expect(
      sumEstimatedMinutes([
        t({ id: "a", estimatedMinutes: 20 }),
        t({ id: "b", estimatedMinutes: null }),
        t({ id: "c", estimatedMinutes: 40 }),
      ]),
    ).toBe(60);
  });

  test("全件 null なら null (= 0 にフォールバックしない)", () => {
    expect(
      sumEstimatedMinutes([
        t({ id: "a", estimatedMinutes: null }),
        t({ id: "b", estimatedMinutes: null }),
      ]),
    ).toBeNull();
  });

  test("空配列なら null", () => {
    expect(sumEstimatedMinutes([])).toBeNull();
  });
});

describe("aggregateChildren", () => {
  test("total / doneCount / totalEstimatedMinutes を返す", () => {
    const parent = t({ id: "p", decomposeStatus: "decomposed" });
    const c1 = t({ id: "c1", parentTaskId: "p", status: "done", estimatedMinutes: 30 });
    const c2 = t({ id: "c2", parentTaskId: "p", status: "done", estimatedMinutes: 30 });
    const c3 = t({ id: "c3", parentTaskId: "p", estimatedMinutes: 30 });

    expect(aggregateChildren("p", [parent, c1, c2, c3])).toEqual({
      total: 3,
      doneCount: 2,
      totalEstimatedMinutes: 90,
    });
  });

  test("子に estimatedMinutes=null が混ざってもダブルカウントしない", () => {
    const parent = t({ id: "p", decomposeStatus: "decomposed" });
    const c1 = t({ id: "c1", parentTaskId: "p", estimatedMinutes: 20 });
    const c2 = t({ id: "c2", parentTaskId: "p", estimatedMinutes: null });
    const c3 = t({ id: "c3", parentTaskId: "p", estimatedMinutes: 40 });

    expect(aggregateChildren("p", [parent, c1, c2, c3])).toEqual({
      total: 3,
      doneCount: 0,
      totalEstimatedMinutes: 60,
    });
  });

  test("子が居なければ total=0 / doneCount=0 / totalEstimatedMinutes=null", () => {
    const parent = t({ id: "p" });
    expect(aggregateChildren("p", [parent])).toEqual({
      total: 0,
      doneCount: 0,
      totalEstimatedMinutes: null,
    });
  });
});
