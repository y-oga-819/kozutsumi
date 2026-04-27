import { createGeminiClient } from "@/shared/ai/client";
import { withAiRoute } from "@/shared/ai/route";
import { decomposeTask } from "@/entities/task/decompose-server";

/**
 * AI タスク分解 endpoint (P3-6, ADR 0017 / 0018 / 0016)。
 *
 * 期待フロー:
 * - client がタスク作成成功後に fire-and-forget で POST する (`{ task_id }`)
 * - `withAiRoute` が AI_ENABLED / 認証を吸収する。AI_ENABLED=false なら 200 skipped で終わり
 * - 本体は `decomposeTask` (ADR 0017 race guard / parser / bulk insert / action_log) を呼ぶ
 * - 失敗 / parse 不能のときは親が `decompose_status='none'` のまま残り、core はそのまま動く
 *   (ADR 0013 augmentation only)
 *
 * クライアント側はレスポンスを使わない (fire-and-forget)。それでも outcome を返すのは
 * dev / curl / 将来の retry で観測できるようにするため。
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

    const outcome = await decomposeTask({
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
