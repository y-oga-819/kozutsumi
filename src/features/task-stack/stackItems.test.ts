import { describe, expect, test } from "vitest";

import type { Task } from "@/entities/task/types";

import {
  buildStackItems,
  computeChildProgress,
  computeDoneProgress,
  type StackItem,
} from "./stackItems";

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

describe("buildStackItems", () => {
  test("decomposed 親は Stack 行から除外され、子だけがフラットに並ぶ", () => {
    const parent = t({ id: "p", title: "親", decomposeStatus: "decomposed" });
    const c1 = t({ id: "c1", title: "子1", parentTaskId: "p" });
    const c2 = t({ id: "c2", title: "子2", parentTaskId: "p" });
    const standalone = t({ id: "s", title: "単独タスク", decomposeStatus: "none" });

    const { items } = buildStackItems([parent, c1, c2, standalone], [parent, c1, c2, standalone]);

    expect(items.map((i) => i.id)).toEqual(["c1", "c2", "s"]);
    expect(items[0].kind).toBe("leaf-child");
    expect(items[2].kind).toBe("leaf-parent");
  });

  test("分解中 / 分解不要 / 未分解 の親は Stack 行に残る", () => {
    const decomposing = t({ id: "a", decomposeStatus: "decomposing" });
    const skipped = t({ id: "b", decomposeStatus: "skipped" });
    const none = t({ id: "c", decomposeStatus: "none" });

    const { items } = buildStackItems([decomposing, skipped, none], [decomposing, skipped, none]);

    expect(items).toHaveLength(3);
    expect(items.every((it) => it.kind === "leaf-parent")).toBe(true);
  });

  test("Issue #204: AI 分解直後でも子は親の位置に連続して並ぶ (兄弟と交互にならない)", () => {
    // fn_decompose_parent_task が出力する DB 状態を再現:
    // - トップレベル A, B, C, D, E (stack_order 0..4, 全て parent=null)
    // - B を AI 分解 → b1, b2, b3 が parent=B / stack_order=1, 2, 3 で挿入され、
    //   B 自身は decompose_status='decomposed' になる
    // SupabaseTaskGateway.list は (stack_order, created_at) 昇順なので、
    // 親が子より先に created なら入力 pendingTasks の並びは下記になる:
    const A = t({ id: "A", stackOrder: 0, createdAt: "2026-04-27T00:00:00" });
    const B = t({
      id: "B",
      stackOrder: 1,
      createdAt: "2026-04-27T00:01:00",
      decomposeStatus: "decomposed",
    });
    const b1 = t({
      id: "b1",
      parentTaskId: "B",
      stackOrder: 1,
      createdAt: "2026-04-27T01:00:00",
    });
    const C = t({ id: "C", stackOrder: 2, createdAt: "2026-04-27T00:02:00" });
    const b2 = t({
      id: "b2",
      parentTaskId: "B",
      stackOrder: 2,
      createdAt: "2026-04-27T01:00:01",
    });
    const D = t({ id: "D", stackOrder: 3, createdAt: "2026-04-27T00:03:00" });
    const b3 = t({
      id: "b3",
      parentTaskId: "B",
      stackOrder: 3,
      createdAt: "2026-04-27T01:00:02",
    });
    const E = t({ id: "E", stackOrder: 4, createdAt: "2026-04-27T00:04:00" });

    const pending = [A, B, b1, C, b2, D, b3, E];
    const { items } = buildStackItems(pending, pending);

    expect(items.map((i) => i.id)).toEqual(["A", "b1", "b2", "b3", "C", "D", "E"]);
  });

  test("子が natural order で散らばっていても、親の位置に集約して並ぶ", () => {
    // 上のテストの一般化: 入力順がどうあれ、子は decomposed 親の位置で連続する。
    const X = t({ id: "X", stackOrder: 0 });
    const Y = t({ id: "Y", stackOrder: 1, decomposeStatus: "decomposed" });
    const y1 = t({ id: "y1", parentTaskId: "Y", stackOrder: 1 });
    const y2 = t({ id: "y2", parentTaskId: "Y", stackOrder: 2 });
    const Z = t({ id: "Z", stackOrder: 99 });

    // pendingTasks: 子が Y より前にも後にも散らばる極端ケース
    const pending = [y1, X, Y, y2, Z];
    const { items } = buildStackItems(pending, pending);

    // Y の位置で y1, y2 が連続して emit される。Y より前に居た y1 も
    // 重複 emit されない (emittedChildIds で抑止)。
    expect(items.map((i) => i.id)).toEqual(["X", "y1", "y2", "Z"]);
  });

  test("親が pending に居ない (= done 等) decomposed の子は natural order で残る", () => {
    // 親が done 側に落ちて pendingTasks に存在しないケース。
    // この時は子を「親の位置」に集約できないので、自然位置で leaf-child として emit する。
    const doneParent = t({ id: "P", status: "done", decomposeStatus: "decomposed" });
    const c = t({ id: "c", parentTaskId: "P", stackOrder: 0 });
    const standalone = t({ id: "s", stackOrder: 1 });

    const { items } = buildStackItems([c, standalone], [doneParent, c, standalone]);

    expect(items.map((i) => i.id)).toEqual(["c", "s"]);
    expect(items[0].kind).toBe("leaf-child");
  });

  test("子の parent が見つからない場合は leaf-parent で fallback (落とさない)", () => {
    const orphan = t({ id: "orphan", parentTaskId: "missing" });
    const { items } = buildStackItems([orphan], [orphan]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("leaf-parent");
  });

  test("tasksById に pending+done 全件が入る", () => {
    const pending = t({ id: "p1" });
    const done = t({ id: "d1", status: "done" });
    const { tasksById } = buildStackItems([pending], [pending, done]);
    expect(tasksById.get("p1")).toBe(pending);
    expect(tasksById.get("d1")).toBe(done);
  });
});

describe("computeChildProgress", () => {
  test("currentIndex = doneCount + Stack 残中の自分の位置", () => {
    // 親 p の子 5 つ。c1/c2 が done、c3/c4/c5 が pending (Stack 順 c3, c5, c4)
    const parent = t({ id: "p", decomposeStatus: "decomposed" });
    const c1 = t({ id: "c1", parentTaskId: "p", status: "done" });
    const c2 = t({ id: "c2", parentTaskId: "p", status: "done" });
    const c3 = t({ id: "c3", parentTaskId: "p" });
    const c4 = t({ id: "c4", parentTaskId: "p" });
    const c5 = t({ id: "c5", parentTaskId: "p" });
    const all = [parent, c1, c2, c3, c4, c5];
    const pending = [c3, c5, c4]; // Stack 順 (DnD 後)

    const items: StackItem[] = pending.map((task) => ({
      kind: "leaf-child" as const,
      id: task.id,
      task,
      parent,
    }));

    // 全子の見積もりは baseTask.estimatedMinutes=30 → 5 子 × 30 = 150
    // Stack 1 番目 = c3 → currentIndex = 2 (done) + 1 = 3
    expect(computeChildProgress(c3, parent, all, items)).toEqual({
      total: 5,
      doneCount: 2,
      currentIndex: 3,
      totalMinutes: 150,
    });
    // Stack 2 番目 = c5 → currentIndex = 2 + 2 = 4
    expect(computeChildProgress(c5, parent, all, items)).toEqual({
      total: 5,
      doneCount: 2,
      currentIndex: 4,
      totalMinutes: 150,
    });
    // Stack 3 番目 = c4 → currentIndex = 2 + 3 = 5
    expect(computeChildProgress(c4, parent, all, items)).toEqual({
      total: 5,
      doneCount: 2,
      currentIndex: 5,
      totalMinutes: 150,
    });
  });

  test("Stack 残に居ない子 (= done で pendingItems に居ない) は currentIndex=0", () => {
    const parent = t({ id: "p", decomposeStatus: "decomposed" });
    const c1 = t({ id: "c1", parentTaskId: "p", status: "done" });
    const c2 = t({ id: "c2", parentTaskId: "p" });
    const items: StackItem[] = [{ kind: "leaf-child", id: "c2", task: c2, parent }];

    expect(computeChildProgress(c1, parent, [parent, c1, c2], items)).toEqual({
      total: 2,
      doneCount: 1,
      currentIndex: 0,
      totalMinutes: 60,
    });
  });

  test("estimatedMinutes が混在 (一部 null) なら null は除外して合計", () => {
    const parent = t({ id: "p", decomposeStatus: "decomposed" });
    const c1 = t({ id: "c1", parentTaskId: "p", estimatedMinutes: 20 });
    const c2 = t({ id: "c2", parentTaskId: "p", estimatedMinutes: null });
    const c3 = t({ id: "c3", parentTaskId: "p", estimatedMinutes: 40 });
    const items: StackItem[] = [{ kind: "leaf-child", id: "c1", task: c1, parent }];

    expect(computeChildProgress(c1, parent, [parent, c1, c2, c3], items).totalMinutes).toBe(60);
  });

  test("全子の estimatedMinutes が null なら totalMinutes は null", () => {
    const parent = t({ id: "p", decomposeStatus: "decomposed" });
    const c1 = t({ id: "c1", parentTaskId: "p", estimatedMinutes: null });
    const items: StackItem[] = [{ kind: "leaf-child", id: "c1", task: c1, parent }];

    expect(computeChildProgress(c1, parent, [parent, c1], items).totalMinutes).toBeNull();
  });
});

describe("computeDoneProgress", () => {
  test("total / doneCount を出し、currentIndex は常に 0", () => {
    const parent = t({ id: "p", decomposeStatus: "decomposed" });
    const c1 = t({ id: "c1", parentTaskId: "p", status: "done" });
    const c2 = t({ id: "c2", parentTaskId: "p", status: "done" });
    const c3 = t({ id: "c3", parentTaskId: "p" });

    expect(computeDoneProgress(parent, [parent, c1, c2, c3])).toEqual({
      total: 3,
      doneCount: 2,
      currentIndex: 0,
      totalMinutes: 90,
    });
  });
});
