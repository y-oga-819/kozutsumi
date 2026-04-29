/**
 * AI タスク分類の fire-and-forget 起動 (P3-4, ADR 0015 / 0013)。
 *
 * AppShell の onCreateTask 成功後にこれを呼ぶ。await しない:
 * - latency をタスク追加 UX に乗せない (ADR 0013 augmentation only)
 * - AI 失敗 / `AI_ENABLED=false` で 200 skipped が返っても呼び出し元は知らない
 * - `task_category` は server 側で fire-and-forget に書かれる。UI には数秒後の
 *   refetch (action_log invalidate / TanStack Query refetchOnFocus 等) で反映される
 *
 * 戻り値は無し。例外も握り潰す (fire-and-forget の契約)。
 */
export function triggerCategorize(taskId: string): void {
  void fetch("/api/ai/categorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task_id: taskId }),
  }).catch((err) => {
    // 失敗しても core は止まらない。dev では console に出して気付けるようにする
    console.error("[ai/categorize] fire-and-forget failed", err);
  });
}
