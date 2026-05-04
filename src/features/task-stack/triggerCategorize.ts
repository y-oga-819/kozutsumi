/**
 * AI タスク分類の fire-and-forget 起動 (P3-4, ADR 0015 / 0013)。
 *
 * AppShell の onCreateTask 成功後にこれを呼ぶ。await しない:
 * - latency をタスク追加 UX に乗せない (ADR 0013 augmentation only)
 * - AI 失敗 / `AI_ENABLED=false` で 200 skipped が返っても呼び出し元は知らない
 * - `task_category` は server 側で fire-and-forget に書かれる
 *
 * 戻り値が `Promise<void>` なのは、呼び出し元が `.finally(...)` で
 * tasks query invalidate (= AI ラベルの refetch トリガ) を起こすため (issue #167)。
 * await しないのは契約通り (latency を UI に乗せない)。例外も握り潰す。
 */
export function triggerCategorize(taskId: string): Promise<void> {
  return fetch("/api/ai/categorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task_id: taskId }),
  })
    .then(() => {
      // outcome は使わない。完了タイミングだけが意味を持つ (ADR 0013)。
    })
    .catch((err) => {
      // 失敗しても core は止まらない。dev では console に出して気付けるようにする
      console.error("[ai/categorize] fire-and-forget failed", err);
    });
}
