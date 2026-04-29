import { categorizeTask } from "@/entities/task/categorize-server";
import { createGeminiClient } from "@/shared/ai/client";
import { withAiRoute } from "@/shared/ai/route";

/**
 * AI タスク分類 endpoint (P3-4, ADR 0015 / 0013)。
 *
 * 期待フロー:
 * - client がタスク作成成功後に fire-and-forget で POST する (`{ task_id }`)
 * - `withAiRoute` が AI_ENABLED / 認証を吸収する。AI_ENABLED=false なら 200 skipped で終わり
 * - 本体は `categorizeTask` (race guard / parser / 条件付き UPDATE) を呼ぶ
 * - 失敗 / parse 不能のときは `task_category` は null のまま残る (ADR 0013 augmentation only)
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

    const outcome = await categorizeTask({
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
