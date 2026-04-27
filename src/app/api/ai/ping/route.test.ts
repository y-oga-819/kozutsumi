import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/shared/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/shared/ai/client", () => ({
  createGeminiClient: vi.fn(),
}));

import { createGeminiClient } from "@/shared/ai/client";
import { createClient } from "@/shared/supabase/server";

import { POST } from "./route";

function makeSupabase(): SupabaseClient {
  return {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { user: { id: "user-1" } } },
        error: null,
      })),
    },
  } as unknown as SupabaseClient;
}

function makeRequest(): Request {
  return new Request("http://localhost/api/ai/ping", { method: "POST" });
}

describe("POST /api/ai/ping", () => {
  const original = {
    aiEnabled: process.env.AI_ENABLED,
    geminiApiKey: process.env.GEMINI_API_KEY,
  };

  beforeEach(() => {
    delete process.env.AI_ENABLED;
    delete process.env.GEMINI_API_KEY;
    vi.mocked(createClient).mockReset();
    vi.mocked(createGeminiClient).mockReset();
  });

  afterEach(() => {
    if (original.aiEnabled === undefined) {
      delete process.env.AI_ENABLED;
    } else {
      process.env.AI_ENABLED = original.aiEnabled;
    }
    if (original.geminiApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = original.geminiApiKey;
    }
    vi.restoreAllMocks();
  });

  test("AI_ENABLED=false → Gemini を呼ばずに 200 skipped (e2e と同じ経路)", async () => {
    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    const body = (await response.json()) as { skipped: boolean };
    expect(body.skipped).toBe(true);
    expect(createGeminiClient).not.toHaveBeenCalled();
  });

  test("AI 有効 + 認証済み → Gemini 応答を返す", async () => {
    process.env.AI_ENABLED = "true";
    process.env.GEMINI_API_KEY = "k";
    vi.mocked(createClient).mockResolvedValue(makeSupabase());
    vi.mocked(createGeminiClient).mockReturnValue({
      getGenerativeModel: () => ({
        generateContent: async () => ({
          response: { text: () => "pong" },
        }),
      }),
    } as unknown as ReturnType<typeof createGeminiClient>);

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; text: string };
    expect(body).toEqual({ ok: true, text: "pong" });
  });
});
