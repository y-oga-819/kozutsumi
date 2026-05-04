/**
 * AI タスク分解の fire-and-forget 起動 (P3-6, ADR 0017)。
 *
 * AppShell の onCreateTask 成功後にこれを呼ぶ。await しない:
 * - レイテンシをタスク追加 UX に乗せない (ADR 0017 Decision 1-2)
 * - AI 失敗 / `AI_ENABLED=false` で 200 skipped が返っても呼び出し元は知らない (ADR 0013)
 *
 * server 側 (`/api/ai/decompose`) が `decompose_status` を `decomposing` に倒すため、
 * UI に分解中 pill を即時出したい場合は呼び出し元で optimistic update を別途行うこと
 * (ADR 0017 Notes / Variant E status pill / P3-7)。
 *
 * 戻り値が `Promise<void>` なのは、呼び出し元 (`createTaskWithAi` /
 * `triggerDecomposeWithOptimistic`) が `.finally(...)` で server 側完了後の
 * tasks query invalidate (= 親 `decomposed` への遷移と子フラット化の refetch トリガ)
 * を起こすため (issue #167)。await しないのは契約通り (latency を UI に乗せない)。
 * 例外も握り潰す。
 */
export function triggerDecompose(taskId: string): Promise<void> {
  return fetch("/api/ai/decompose", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task_id: taskId }),
  })
    .then(() => {
      // outcome (decomposed / skipped / failed) は使わない。完了したことだけが
      // 呼び出し元の `.finally` invalidate で意味を持つ (ADR 0013)。
    })
    .catch((err) => {
      // 失敗しても core は止まらない。dev では console に出して気付けるようにする
      console.error("[ai/decompose] fire-and-forget failed", err);
    });
}
