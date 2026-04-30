/**
 * AI タスク再分解 (子の resplit) の fire-and-forget 起動 (Issue #121, ADR 0027 / 0028 / 0029 / 0030)。
 *
 * 子タスクの詳細パネル「もっと細かく」ボタン押下時にこれを呼ぶ。await しない:
 * - レイテンシを UI 操作に乗せない (ADR 0017 と同じ方針)
 * - AI 失敗 / `AI_ENABLED=false` で 200 skipped が返っても呼び出し元は知らない (ADR 0013)
 *
 * server 側 (`/api/ai/decompose/resplit`) が `decompose_status` を `decomposing` に倒すため、
 * UI に分解中 pill を即時出したい場合は呼び出し元で optimistic update を別途行うこと
 * (AppShell の onTriggerResplit で対応)。
 *
 * 戻り値は無し。例外も握り潰す (fire-and-forget の契約)。
 */
export function triggerResplit(taskId: string): void {
  void fetch("/api/ai/decompose/resplit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task_id: taskId }),
  }).catch((err) => {
    console.error("[ai/decompose/resplit] fire-and-forget failed", err);
  });
}
