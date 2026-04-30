/**
 * AI タスク再分解 (子の resplit) の fire-and-forget 起動 (Issue #121, ADR 0027 / 0028 / 0029 / 0030)。
 *
 * 子タスクの詳細パネル「もっと細かく」ボタン押下時にこれを呼ぶ。
 *
 * 戻り値が `Promise<void>` なのは、呼び出し元 (AppShell) が `.finally(...)` で
 * 完了時の query invalidation (= tasks の refetch トリガ) を起こすため。
 * 親分解 (`triggerDecompose`) と違い、resplit は server 側で target row が物理 delete
 * + 新規子が insert される。fire-and-forget で client が refetch しないと UI に
 * 削除済み target が「decomposing」のまま残り続け、HC-2 (Stack 粒度と
 * ParallelogramProgress の一致) が transient に破れる。
 *
 * 呼び出し元が `.finally` を付けない場合は実質的に従来の fire-and-forget と同じ挙動
 * (例外も握り潰す)。await しないことでレイテンシを UI 操作に乗せない。
 */
export function triggerResplit(taskId: string): Promise<void> {
  return fetch("/api/ai/decompose/resplit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task_id: taskId }),
  })
    .then(() => {
      // 戻り値 (outcome) は使わない。fire-and-forget client は server の skipped /
      // failed / resplit_succeeded を区別する責務を持たない (ADR 0013)。
    })
    .catch((err) => {
      console.error("[ai/decompose/resplit] fire-and-forget failed", err);
    });
}
