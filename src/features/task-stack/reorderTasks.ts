import type { Task } from "@/entities/task/types";

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
