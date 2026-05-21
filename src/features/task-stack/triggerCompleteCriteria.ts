/**
 * AI 後追い完了条件補完の fire-and-forget 起動 (#245, ADR 0064 / 0066 / 0067)。
 *
 * タスク詳細画面の閲覧時にこれを呼ぶ。await しない:
 * - latency を詳細画面の表示 UX に乗せない (ADR 0013 augmentation only)
 * - AI 失敗 / `AI_ENABLED=false` で 200 skipped が返っても呼び出し元は知らない
 * - 完了条件 (deliverable / done / first_step) は server 側で未補完フィールドのみ
 *   fire-and-forget に書かれる (ADR 0067 Decision 5)
 *
 * 戻り値が `Promise<void>` なのは、呼び出し元が `.finally(...)` で tasks query
 * invalidate (= 補完値の refetch トリガ) を起こすため。await しないのは契約通り。
 * 例外も握り潰す。
 */
export function triggerCompleteCriteria(taskId: string): Promise<void> {
  return fetch("/api/ai/complete-criteria", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task_id: taskId }),
  })
    .then(() => {
      // outcome は使わない。完了タイミングだけが呼び出し元の `.finally` invalidate で意味を持つ。
    })
    .catch((err) => {
      // 失敗しても core は止まらない。dev では console に出して気付けるようにする
      console.error("[ai/complete-criteria] fire-and-forget failed", err);
    });
}
