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
 * - 親タスク (`parentTaskId === null`):
 *   - `decompose_status === 'decomposed'` → 自身は Stack に出さず、その親に紐づく
 *     pending な子をその位置に連続して emit する (ADR 0016 §1 + Issue #204)。
 *   - それ以外 (`none` / `decomposing` / `skipped`) → `leaf-parent` で出す
 * - 子タスク (`parentTaskId !== null`):
 *   - 親が pending 側にいる decomposed parent なら、親の位置で既に emit 済みなので skip。
 *   - 親が `allTasks` には居るが pending 側に居ない (親が done 等の不整合) ケース、
 *     および親が完全に missing なケースは natural order でその場に emit する (落とさない)。
 *
 * Issue #204: 旧実装は decomposed 親を skip しつつ子を natural order で emit していたため、
 * トップレベル親と子が同じ `stack_order` を取り得る AI 分解直後 (fn_decompose_parent_task は
 * 親の stack_order をそのまま base にして子を 0..N-1 で振る) に、`(stack_order, created_at)`
 * 昇順だと「親兄弟と子」が交互に挟まる並びになっていた (例: ABCDE で B を分解 →
 * A b C b D b E)。子を「親の位置」に集約して emit することで連続させる。
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

  // pending 側に存在する decomposed 親の id 集合。子の「親の位置に集約」と
  // 「自然位置での重複 emit 抑止」の両方の判定に使う。
  const decomposedParentIds = new Set<string>();
  for (const t of pendingTasks) {
    if (t.parentTaskId === null && t.decomposeStatus === "decomposed") {
      decomposedParentIds.add(t.id);
    }
  }

  // 入力順 = stack_order 昇順を保ったまま、上記 decomposed 親に紐づく pending 子配列を作る。
  // 親が pending に居ない (= done 等) ケースの子は集約対象外なので含めない。
  const pendingChildrenByParent = new Map<string, Task[]>();
  for (const t of pendingTasks) {
    if (t.parentTaskId === null) continue;
    if (!decomposedParentIds.has(t.parentTaskId)) continue;
    const arr = pendingChildrenByParent.get(t.parentTaskId);
    if (arr) arr.push(t);
    else pendingChildrenByParent.set(t.parentTaskId, [t]);
  }

  const items: StackItem[] = [];
  for (const t of pendingTasks) {
    if (t.parentTaskId !== null) {
      // 親が pending 側の decomposed parent なら、その親の位置でまとめて emit するので
      // 自然位置では出さない (Issue #204)。
      if (decomposedParentIds.has(t.parentTaskId)) continue;
      const parent = tasksById.get(t.parentTaskId);
      if (parent) {
        // 親が done / decompose_status != decomposed 等の不整合系。落とさず自然位置に。
        items.push({ kind: "leaf-child", id: t.id, task: t, parent });
        continue;
      }
      // 親が allTasks にも無いデータ不整合は leaf-parent で fallback。
      items.push({ kind: "leaf-parent", id: t.id, task: t });
      continue;
    }
    if (t.decomposeStatus === "decomposed") {
      // 子を「この親の位置」に連続 emit (Issue #204)。
      const children = pendingChildrenByParent.get(t.id) ?? [];
      for (const c of children) {
        items.push({ kind: "leaf-child", id: c.id, task: c, parent: t });
      }
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
