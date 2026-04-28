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
 * 戻り値は無し。例外も握り潰す (fire-and-forget の契約)。
 */
export function triggerDecompose(taskId: string): void {
  // void で結果を捨てる。catch で error も握り潰す
  void fetch("/api/ai/decompose", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task_id: taskId }),
  }).catch((err) => {
    // 失敗しても core は止まらない。dev では console に出して気付けるようにする
    console.error("[ai/decompose] fire-and-forget failed", err);
  });
}
