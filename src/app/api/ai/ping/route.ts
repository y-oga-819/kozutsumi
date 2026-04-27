import { createGeminiClient } from "@/shared/ai/client";
import { withAiRoute } from "@/shared/ai/route";

/**
 * AI 基盤の疎通確認用ダミー endpoint (P3-1)。
 *
 * - `AI_ENABLED=false` → 共通 helper が 200 `{ skipped: true }` で返す。e2e はここで止まる。
 * - `AI_ENABLED=true` + `GEMINI_API_KEY` 設定済み → Gemini に最小 prompt を投げて
 *   応答テキストを返す。dev での疎通確認専用 (本番 / e2e で叩く想定なし)。
 *
 * 本物の機能 endpoint は categorize / decompose 等として別 issue (P3-4 / P3-6) で立てる。
 */
export async function POST(request: Request) {
  return withAiRoute(request, async () => {
    const client = createGeminiClient();
    const model = client.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent("Reply with exactly: pong");
    return {
      ok: true,
      text: result.response.text(),
    };
  });
}
