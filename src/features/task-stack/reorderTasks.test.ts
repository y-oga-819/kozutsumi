import { describe, expect, test } from "vitest";

import type { Task } from "@/entities/task/types";

import { insertAtTopPlusOne, reorderGroupById, reorderTasksById } from "./reorderTasks";

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

describe("reorderGroupById (ADR-0041)", () => {
  test("親 P の子グループを兄弟 x の位置に移動: 相対順序を保ったまままとめて動く", () => {
    // pending = [c1, c2, p (hidden), s, x] (visible = [c1, c2, s, x])
    // groupIds は parent_task_id === 'p' を持つ行 (= c1, c2) のみ。
    // decomposed 親 p 自身は parentTaskId=null なのでグループ要素ではない。
    // p の stack_order は hidden の都合で見かけ上影響しない。
    const pending = [
      t({ id: "c1", parentTaskId: "p", stackOrder: 0 }),
      t({ id: "c2", parentTaskId: "p", stackOrder: 1 }),
      t({ id: "p", decomposeStatus: "decomposed", stackOrder: 2 }),
      t({ id: "s", stackOrder: 3 }),
      t({ id: "x", stackOrder: 4 }),
    ];

    const result = reorderGroupById(pending, "p", "x");

    // others = [p, s, x]、group = [c1, c2]。x 手前にグループ挿入で
    // pending = [p, s, c1, c2, x]。visible = [s, c1, c2, x] となり
    // 「P の子グループが s の後 / x の前」に動いた状態になる。
    expect(result.map((r) => r.id)).toEqual(["p", "s", "c1", "c2", "x"]);
    expect(result.map((r) => r.stackOrder)).toEqual([0, 1, 2, 3, 4]);
  });

  test("分断中のグループ (P の子が複数の塊に分かれている) も全行が 1 グループとして動く", () => {
    // pending = [c1, N, c2, c3, p (hidden), s] (visible = [c1, N, c2, c3, s])
    // group = [c1, c2, c3] (parentTaskId === 'p')、N と p と s はグループ外。
    const pending = [
      t({ id: "c1", parentTaskId: "p", stackOrder: 0 }),
      t({ id: "N", stackOrder: 1 }),
      t({ id: "c2", parentTaskId: "p", stackOrder: 2 }),
      t({ id: "c3", parentTaskId: "p", stackOrder: 3 }),
      t({ id: "p", decomposeStatus: "decomposed", stackOrder: 4 }),
      t({ id: "s", stackOrder: 5 }),
    ];

    const result = reorderGroupById(pending, "p", "s");

    // others = [N, p, s]、group = [c1, c2, c3]。s 手前にグループ挿入で
    // pending = [N, p, c1, c2, c3, s]。visible = [N, c1, c2, c3, s] で
    // 分断状態 (c1, N, c2, c3) がグループ単位で再収束される。
    expect(result.map((r) => r.id)).toEqual(["N", "p", "c1", "c2", "c3", "s"]);
    expect(result.map((r) => r.stackOrder)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test("グループ内の row へドロップは no-op", () => {
    const pending = [
      t({ id: "c1", parentTaskId: "p", stackOrder: 0 }),
      t({ id: "c2", parentTaskId: "p", stackOrder: 1 }),
      t({ id: "s", stackOrder: 2 }),
    ];
    const result = reorderGroupById(pending, "p", "c2");
    expect(result.map((r) => r.id)).toEqual(["c1", "c2", "s"]);
  });

  test("該当 parent_task_id を持つ task が無いと no-op", () => {
    const pending = [t({ id: "a", stackOrder: 0 }), t({ id: "b", stackOrder: 1 })];
    const result = reorderGroupById(pending, "missing-parent", "a");
    expect(result.map((r) => r.id)).toEqual(["a", "b"]);
  });

  test("不変性: 入力配列・要素は変更しない", () => {
    const c1 = t({ id: "c1", parentTaskId: "p", stackOrder: 0 });
    const s = t({ id: "s", stackOrder: 1 });
    const pending = [c1, s];

    reorderGroupById(pending, "p", "s");

    expect(pending.map((x) => x.id)).toEqual(["c1", "s"]);
    expect(c1.stackOrder).toBe(0);
    expect(s.stackOrder).toBe(1);
  });
});

describe("insertAtTopPlusOne (ADR-0040)", () => {
  test("Top の直下に挿入し stackOrder を 0..n で振り直す", () => {
    const pending = [
      t({ id: "a", stackOrder: 0 }),
      t({ id: "b", stackOrder: 1 }),
      t({ id: "c", stackOrder: 2 }),
    ];
    const newTask = t({ id: "N", stackOrder: 99 });

    const result = insertAtTopPlusOne(pending, pending, newTask);

    expect(result.map((r) => r.id)).toEqual(["a", "N", "b", "c"]);
    expect(result.map((r) => r.stackOrder)).toEqual([0, 1, 2, 3]);
  });

  test("pending が空のときは head に挿入", () => {
    const newTask = t({ id: "N", stackOrder: 99 });
    const result = insertAtTopPlusOne([], [], newTask);
    expect(result.map((r) => r.id)).toEqual(["N"]);
    expect(result.map((r) => r.stackOrder)).toEqual([0]);
  });

  test("decomposed 親が pending の先頭に居ても、visible Top (= 子) の直下に入る", () => {
    // pending = [decomposed 親 P, child_P_1, child_P_2, sibling]
    // visible Top = child_P_1 (P は除外される)
    // 新規 N は child_P_1 の直下 (= 親グループを分断する位置)
    const pending = [
      t({ id: "P", decomposeStatus: "decomposed", stackOrder: 0 }),
      t({ id: "c1", parentTaskId: "P", stackOrder: 1 }),
      t({ id: "c2", parentTaskId: "P", stackOrder: 2 }),
      t({ id: "s", stackOrder: 3 }),
    ];
    const newTask = t({ id: "N", stackOrder: 99 });

    const result = insertAtTopPlusOne(pending, pending, newTask);

    // pending の中で c1 の直後 (= idx 2 の位置) に N が入り、全て renumber される。
    expect(result.map((r) => r.id)).toEqual(["P", "c1", "N", "c2", "s"]);
    expect(result.map((r) => r.stackOrder)).toEqual([0, 1, 2, 3, 4]);
  });

  test("不変性: 入力配列・要素は変更しない", () => {
    const a = t({ id: "a", stackOrder: 0 });
    const newTask = t({ id: "N", stackOrder: 99 });
    const pending = [a];

    insertAtTopPlusOne(pending, pending, newTask);

    expect(pending.map((x) => x.id)).toEqual(["a"]);
    expect(a.stackOrder).toBe(0);
    expect(newTask.stackOrder).toBe(99);
  });
});
