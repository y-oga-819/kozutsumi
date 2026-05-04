import { describe, expect, test } from "vitest";

import type { Task } from "@/entities/task/types";

import { reorderTasksById } from "./reorderTasks";

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

describe("reorderTasksById", () => {
  test("通常タスクのみ: from を to の位置に移し stackOrder を 0..n-1 で振り直す", () => {
    const pending = [
      t({ id: "a", stackOrder: 0 }),
      t({ id: "b", stackOrder: 1 }),
      t({ id: "c", stackOrder: 2 }),
    ];

    const result = reorderTasksById(pending, "c", "a");

    expect(result.map((x) => x.id)).toEqual(["c", "a", "b"]);
    expect(result.map((x) => x.stackOrder)).toEqual([0, 1, 2]);
  });

  test("decomposed 親が pending に混在しても、UI 行 (子+通常) が指定した順に並び、親は移動しない", () => {
    // pending は stack_order 昇順。decomposed 親 p は子 c1/c2 の間に紛れている。
    // UI (buildStackItems) では p は除外され items = [c1, c2, s] と見える。
    // ユーザが items 上で「s を c1 の前に」ドラッグしたとき、p が動いたり
    // s の代わりに p が動くといったバグが起きないことを確認する (regression)。
    const pending = [
      t({ id: "c1", parentTaskId: "p", stackOrder: 0 }),
      t({ id: "c2", parentTaskId: "p", stackOrder: 1 }),
      t({ id: "p", decomposeStatus: "decomposed", stackOrder: 2 }),
      t({ id: "s", stackOrder: 3 }),
    ];

    const result = reorderTasksById(pending, "s", "c1");

    expect(result.map((x) => x.id)).toEqual(["s", "c1", "c2", "p"]);
    expect(result.map((x) => x.stackOrder)).toEqual([0, 1, 2, 3]);
  });

  test("fromId === toId は no-op (元配列のコピーを返す)", () => {
    const pending = [t({ id: "a", stackOrder: 0 }), t({ id: "b", stackOrder: 1 })];
    const result = reorderTasksById(pending, "a", "a");
    expect(result.map((x) => x.id)).toEqual(["a", "b"]);
  });

  test("存在しない id は no-op", () => {
    const pending = [t({ id: "a", stackOrder: 0 }), t({ id: "b", stackOrder: 1 })];
    const result = reorderTasksById(pending, "a", "missing");
    expect(result.map((x) => x.id)).toEqual(["a", "b"]);
  });

  test("不変性: 入力配列・要素は変更しない", () => {
    const a = t({ id: "a", stackOrder: 0 });
    const b = t({ id: "b", stackOrder: 1 });
    const pending = [a, b];

    reorderTasksById(pending, "b", "a");

    expect(pending.map((x) => x.id)).toEqual(["a", "b"]);
    expect(a.stackOrder).toBe(0);
    expect(b.stackOrder).toBe(1);
  });
});
