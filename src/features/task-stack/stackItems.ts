import { aggregateChildren } from "@/entities/task/aggregations";
import type { Task } from "@/entities/task/types";

/**
 * Stack View (ADR 0016 Variant E) の描画単位。
 * 平坦な `Task[]` から「分解済み親を除外して子をフラット化」した結果を表す。
 *
 * - `leaf-child`: 子タスク (parent への参照付き)。下ゾーン Row 3 で「⤷ 親」と progress を出す。
 * - `leaf-parent`: 親自身が Stack に並ぶケース (`decomposeStatus !== 'decomposed'`)。
 *   = 未分解 / 分解中 / 分解不要 のいずれか。
 */
export type StackItem =
  | { kind: "leaf-child"; id: string; task: Task; parent: Task }
  | { kind: "leaf-parent"; id: string; task: Task };

export type StackItemsResult = {
  items: StackItem[];
  /** 全タスク (pending + done) を id で引ける Map。Done セクションでも parent 参照に使う。 */
  tasksById: ReadonlyMap<string, Task>;
};

/**
 * `pendingTasks` を順序保ったまま Item に変換する。
 *
 * - 子タスク (`parentTaskId !== null`) は `leaf-child` に。
 *   親が見つからないデータ不整合は `leaf-parent` で fallback (落とさない)。
 * - 親タスク (`parentTaskId === null`):
 *   - `decompose_status === 'decomposed'` → 子に置き換わるので Stack には出さない (除外)
 *   - それ以外 (`none` / `decomposing` / `skipped`) → `leaf-parent` で出す
 *
 * @param pendingTasks Stack に並べたい順 (= stack_order 昇順)
 * @param allTasks parent 解決のための全件 (pending + done を渡す)
 */
export function buildStackItems(
  pendingTasks: readonly Task[],
  allTasks: readonly Task[],
): StackItemsResult {
  const tasksById = new Map<string, Task>();
  for (const t of allTasks) tasksById.set(t.id, t);

  const items: StackItem[] = [];
  for (const t of pendingTasks) {
    if (t.parentTaskId !== null) {
      const parent = tasksById.get(t.parentTaskId);
      if (parent) {
        items.push({ kind: "leaf-child", id: t.id, task: t, parent });
        continue;
      }
      // 親が無いデータ不整合は落とさず leaf-parent として表示
    }
    if (t.decomposeStatus === "decomposed") {
      // 子に置き換わるので Stack には出さない (ADR 0016 §1)
      continue;
    }
    items.push({ kind: "leaf-parent", id: t.id, task: t });
  }
  return { items, tasksById };
}

export type Progress = {
  total: number;
  doneCount: number;
  /** 1-based。0 を渡すと「現在なし」。Done セクション用。 */
  currentIndex: number;
  /** 子の見積もり合計 (分)。子全部が null なら null。Top カード下ゾーンの「合計」表示で使う。 */
  totalMinutes: number | null;
};

/**
 * 子タスクの進捗を計算する (ADR 0016 §5)。
 *
 * `currentIndex = doneCount + (Stack 残中の同親子における 1-based 位置)`。
 * done が増えると自分のセグメントが右へオフセットする。
 */
export function computeChildProgress(
  child: Task,
  parent: Task,
  allTasks: readonly Task[],
  pendingItems: readonly StackItem[],
): Progress {
  const { total, doneCount, totalEstimatedMinutes } = aggregateChildren(parent.id, allTasks);
  let position = 0;
  for (const it of pendingItems) {
    if (it.kind === "leaf-child" && it.parent.id === parent.id) {
      position++;
      if (it.task.id === child.id) {
        return {
          total,
          doneCount,
          currentIndex: doneCount + position,
          totalMinutes: totalEstimatedMinutes,
        };
      }
    }
  }
  return { total, doneCount, currentIndex: 0, totalMinutes: totalEstimatedMinutes };
}

/**
 * Done セクション用の進捗。current 強調なし (Stack 側の current と被らない)。
 */
export function computeDoneProgress(parent: Task, allTasks: readonly Task[]): Progress {
  const { total, doneCount, totalEstimatedMinutes } = aggregateChildren(parent.id, allTasks);
  return {
    total,
    doneCount,
    currentIndex: 0,
    totalMinutes: totalEstimatedMinutes,
  };
}
