import { GoogleGenerativeAI } from "@google/generative-ai";

import { getGeminiApiKey } from "./env";

/**
 * Gemini SDK クライアントの薄い factory (ADR 0012)。
 *
 * - 呼び出し側 (`/api/ai/*` Route Handler 内) で必要になった時に毎回作る。
 * - `GEMINI_API_KEY` 未設定なら `getGeminiApiKey` が throw するので、
 *   呼び出し側は `isAiEnabled()` で先にガードしてから呼ぶこと。
 */
export function createGeminiClient(): GoogleGenerativeAI {
  return new GoogleGenerativeAI(getGeminiApiKey());
}
