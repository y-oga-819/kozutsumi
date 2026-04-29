import type { Task } from "./types";

/**
 * Task 集計の共通ヘルパ (issue #95 / P3-10、ADR 0018 Consequences)。
 *
 * Phase 3 で `decompose_status='decomposed'` の親が「Stack View では子に置き換わる
 * (ADR 0016)」「集計上は残数にカウントしない」「`parent_task_id` は保持して
 * 行動ログの再構築に使う (ADR 0018)」という二重の役割を持つようになった。
 * このため未着手件数 / 進捗集計 / 階層クエリで「親除外」を毎回手書きすると
 * ダブルカウントや漏れが起きやすい。集計の意味は 1 箇所に集約する。
 */

/**
 * 集計対象から「分解済み親」(`decompose_status='decomposed'`) を除外する。
 *
 * 用途:
 * - Stack 残件数 / 未着手タスク数 (= 子に置き換わっているので親はカウントしない)
 * - 進捗集計の母集団 (= 親重複を排除した「実際に着手される単位」だけ集める)
 *
 * 「分解されていない親」(`none` / `decomposing` / `skipped` / `failed`) と
 * 「子タスク」「単独タスク」はそのまま残る。
 */
export function excludeDecomposedParents(tasks: readonly Task[]): Task[] {
  return tasks.filter((t) => t.decomposeStatus !== "decomposed");
}

/**
 * 親 id 直下の子タスクを返す。順序は入力順 (= 呼び出し側の責務、通常 stack_order 昇順)。
 *
 * 孫タスクの再帰展開はしない。kozutsumi の仕様 (idea #121 / ADR 0016) で
 * 孫は作らず「親の子に flatten」する方針なので、現時点では 1 段で十分。
 * 将来 Tree View で再帰展開が必要になったら、この helper の上に再帰版を足す。
 */
export function getChildren(parentId: string, tasks: readonly Task[]): Task[] {
  return tasks.filter((t) => t.parentTaskId === parentId);
}

/**
 * `estimated_minutes` の null-safe な合計。1 件でも値があれば数値、全 null なら null。
 *
 * 「合計を見せるか / 見せないか」の分岐 (Top カード下ゾーン等) で
 * `null vs 0` の区別が要るので 0 にフォールバックしない。
 */
export function sumEstimatedMinutes(tasks: readonly Task[]): number | null {
  return tasks.reduce<number | null>((acc, t) => {
    if (t.estimatedMinutes === null) return acc;
    return (acc ?? 0) + t.estimatedMinutes;
  }, null);
}

export type ChildrenAggregate = {
  /** 子の総数 */
  total: number;
  /** `status='done'` の子数 */
  doneCount: number;
  /** 子の `estimated_minutes` 合計 (全 null なら null) */
  totalEstimatedMinutes: number | null;
};

/**
 * 親 id に紐づく子の集計 (件数 / 完了数 / 見積合計)。
 *
 * Stack View の進捗バー (ADR 0016 §5) / Top カード下ゾーンの「合計時間」/
 * Done セクションの進捗表示で共通利用する。"現在位置" (currentIndex) は
 * Stack 残中の位置に依存する派生値なので含めない (呼び出し側で計算)。
 */
export function aggregateChildren(parentId: string, tasks: readonly Task[]): ChildrenAggregate {
  const children = getChildren(parentId, tasks);
  return {
    total: children.length,
    doneCount: children.filter((t) => t.status === "done").length,
    totalEstimatedMinutes: sumEstimatedMinutes(children),
  };
}
