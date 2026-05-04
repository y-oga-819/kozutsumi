import type { Task } from "@/entities/task/types";

import { buildStackItems } from "./stackItems";

/**
 * `pending` 配列内で `fromId` を `toId` の位置に移し、`stackOrder` を 0..n-1 で振り直す。
 *
 * id ベースで受けるのは、UI 上の Stack 行 (`buildStackItems` で decomposed 親を
 * 除外した items) と pending Task[] の index が一致しないため。index で渡すと
 * 「分解済み親を含むスタック」を並び替えたとき無関係なタスクが動いてしまう。
 *
 * いずれかの id が無い、もしくは同一 id なら `pending` をそのまま返す (no-op)。
 */
export function reorderTasksById(pending: readonly Task[], fromId: string, toId: string): Task[] {
  if (fromId === toId) return [...pending];
  const fromIdx = pending.findIndex((t) => t.id === fromId);
  const toIdx = pending.findIndex((t) => t.id === toId);
  if (fromIdx < 0 || toIdx < 0) return [...pending];
  const next = [...pending];
  const [item] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, item);
  return next.map((t, i) => ({ ...t, stackOrder: i }));
}

/**
 * ADR-0041: 親バッジ起点のグループ並べ替え。
 * `parentTaskId` を共有する全 task をグループ要素として、相対順序を保ったまま
 * `toId` の位置にまとめて挿入し、`stackOrder` を 0..n-1 で振り直す。
 *
 * - `toId` がグループ内 row のときは no-op (自分のグループに自分を落とさない)
 * - `parentTaskId` を持つ task が `pending` に無い / `toId` が見つからない場合も no-op
 * - グループ要素が 1 件のみのときは `reorderTasksById` 相当の挙動になる
 *
 * グループは Stack 内で複数の塊に分かれている (= 分断中) ことがある。その場合も
 * `parent_task_id` の equivalence class 全体が 1 グループとして動く (ADR-0041 Notes)。
 */
export function reorderGroupById(
  pending: readonly Task[],
  parentTaskId: string,
  toId: string,
): Task[] {
  const groupIds = new Set(pending.filter((t) => t.parentTaskId === parentTaskId).map((t) => t.id));
  if (groupIds.size === 0) return [...pending];
  if (groupIds.has(toId)) return [...pending];
  const targetIdx = pending.findIndex((t) => t.id === toId);
  if (targetIdx < 0) return [...pending];

  const groupMembers = pending.filter((t) => groupIds.has(t.id));
  const others = pending.filter((t) => !groupIds.has(t.id));
  const targetIdxInOthers = others.findIndex((t) => t.id === toId);
  // toId はグループ外なので others に必ず存在する。
  const next = [
    ...others.slice(0, targetIdxInOthers),
    ...groupMembers,
    ...others.slice(targetIdxInOthers),
  ];
  return next.map((t, i) => ({ ...t, stackOrder: i }));
}

/**
 * ADR-0040: 新規タスクを「現在の Top タスクの 1 つ下」(= visible 上から 2 番目)
 * に挿入し、`stackOrder` を 0..n で振り直す。
 *
 * - visible が空 (= Top 無し) のときは head に挿入する
 * - decomposed 親は visible からスキップされるので、visible Top の `pending` 内
 *   index を求めてその直後に挿入する
 *
 * 「Top に置く」のではなく Top の直下に置くのは、作業中タスク (Top) を
 * 押し下げないため (ADR-0040)。
 */
export function insertAtTopPlusOne(
  pending: readonly Task[],
  allTasks: readonly Task[],
  task: Task,
): Task[] {
  const { items } = buildStackItems(pending, allTasks);
  const topVisible = items[0]?.task;
  const topIdx = topVisible ? pending.findIndex((t) => t.id === topVisible.id) : -1;
  const insertIdx = topIdx >= 0 ? topIdx + 1 : 0;
  const next = [...pending.slice(0, insertIdx), task, ...pending.slice(insertIdx)];
  return next.map((t, i) => ({ ...t, stackOrder: i }));
}
