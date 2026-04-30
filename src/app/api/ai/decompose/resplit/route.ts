import { resplitChildTask } from "@/entities/task/resplit-server";
import { createGeminiClient } from "@/shared/ai/client";
import { withAiRoute } from "@/shared/ai/route";

/**
 * AI タスク再分解 endpoint (Issue #121, ADR 0027 / 0028 / 0029 / 0030)。
 *
 * 期待フロー:
 * - client が子タスクの詳細パネル「もっと細かく」ボタンを押すと fire-and-forget で
 *   POST する (`{ task_id: 子タスク id }`)
 * - `withAiRoute` が AI_ENABLED / 認証を吸収する。AI_ENABLED=false なら 200 skipped で終わり
 *   (e2e バイパス、ADR 0014)
 * - 本体は `resplitChildTask` (race guard / 兄弟取得 / parser / fn_resplit_child_task RPC /
 *   action_log) を呼ぶ
 * - 失敗 / parse 不能のときは子が `decompose_status='failed'` に倒れ、core はそのまま動く
 *   (ADR 0021 / 0013 augmentation only)
 *
 * 親分解 (`/api/ai/decompose`) と入口を分けることで、URL から「親への分解」と「子への
 * 再分解」を区別する。orchestrator も別 (`resplitChildTask` vs `decomposeTask`)。
 */

const MODEL_ID = "gemini-2.5-flash";

export async function POST(request: Request) {
  return withAiRoute(request, async ({ supabase, userId, request: req }) => {
    const body = await safeJsonBody(req);
    const taskId = typeof body?.task_id === "string" ? body.task_id : null;
    if (!taskId) {
      return { ok: false, error: "missing task_id" };
    }

    const client = createGeminiClient();
    const model = client.getGenerativeModel({ model: MODEL_ID });

    const outcome = await resplitChildTask({
      supabase,
      userId,
      taskId,
      generate: async (prompt) => {
        const result = await model.generateContent(prompt);
        return result.response.text();
      },
    });

    return { ok: true, outcome };
  });
}

async function safeJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const data = (await req.json()) as unknown;
    if (typeof data !== "object" || data === null) return null;
    return data as Record<string, unknown>;
  } catch {
    return null;
  }
}
