/**
 * AI (Gemini) 関連 env の読み取り (ADR 0012 / 0013 / 0014)。
 *
 * - `AI_ENABLED`: 全 `/api/ai/*` の kill-switch。`"true"` のときだけ AI 経路を通す。
 *   未設定 / 任意の他の値はすべて off (default false)。e2e と Vercel preview のデフォルト
 *   も off で、本番のみ明示的に on にする運用。
 * - `GEMINI_API_KEY`: server-only。`NEXT_PUBLIC_` prefix を付けてはいけない
 *   (client bundle に出ると流出する)。
 *
 * `AI_ENABLED=true` でも `GEMINI_API_KEY` が無ければ AI 経路は止める (ADR 0013 fail-soft)。
 * 設定漏れでユーザー操作を 500 で止めないため、`isAiEnabled()` は両方揃った時だけ true を返す。
 */
export function isAiEnabled(): boolean {
  if (process.env.AI_ENABLED !== "true") return false;
  if (!process.env.GEMINI_API_KEY) return false;
  return true;
}

export function getGeminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("[kozutsumi] Missing env: GEMINI_API_KEY. See .env.local.example");
  }
  return key;
}
