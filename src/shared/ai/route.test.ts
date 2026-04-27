import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/shared/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/shared/supabase/server";

import { withAiRoute } from "./route";

type SessionShape = { user: { id: string } } | null;

function makeSupabase(session: SessionShape): SupabaseClient {
  return {
    auth: {
      getSession: vi.fn(async () => ({ data: { session }, error: null })),
    },
  } as unknown as SupabaseClient;
}

function makeRequest(): Request {
  return new Request("http://localhost/api/ai/ping", { method: "POST" });
}

describe("withAiRoute", () => {
  const original = {
    aiEnabled: process.env.AI_ENABLED,
    geminiApiKey: process.env.GEMINI_API_KEY,
  };

  beforeEach(() => {
    delete process.env.AI_ENABLED;
    delete process.env.GEMINI_API_KEY;
    vi.mocked(createClient).mockReset();
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

  test("AI_ENABLED=false (default) → handler は呼ばれず 200 skipped", async () => {
    const handler = vi.fn();

    const response = await withAiRoute(makeRequest(), handler);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { skipped: boolean; reason: string };
    expect(body).toEqual({ skipped: true, reason: "ai_disabled" });
    expect(handler).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  test("AI_ENABLED=true でも GEMINI_API_KEY 未設定 → 200 skipped (fail-soft)", async () => {
    process.env.AI_ENABLED = "true";
    const handler = vi.fn();

    const response = await withAiRoute(makeRequest(), handler);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { skipped: boolean };
    expect(body.skipped).toBe(true);
    expect(handler).not.toHaveBeenCalled();
  });

  test("AI 有効 + 未ログイン → 401 unauthorized", async () => {
    process.env.AI_ENABLED = "true";
    process.env.GEMINI_API_KEY = "k";
    vi.mocked(createClient).mockResolvedValue(makeSupabase(null));
    const handler = vi.fn();

    const response = await withAiRoute(makeRequest(), handler);

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
    expect(handler).not.toHaveBeenCalled();
  });

  test("AI 有効 + ログイン済み → handler に userId と supabase が渡る", async () => {
    process.env.AI_ENABLED = "true";
    process.env.GEMINI_API_KEY = "k";
    const supabase = makeSupabase({ user: { id: "user-1" } });
    vi.mocked(createClient).mockResolvedValue(supabase);
    const handler = vi.fn(async () => ({ ok: true }));

    const response = await withAiRoute(makeRequest(), handler);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean };
    expect(body).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", supabase }));
  });

  test("handler が throw → 500 ai_failed (ユーザー操作は別経路で続行する前提)", async () => {
    process.env.AI_ENABLED = "true";
    process.env.GEMINI_API_KEY = "k";
    vi.mocked(createClient).mockResolvedValue(makeSupabase({ user: { id: "user-1" } }));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await withAiRoute(makeRequest(), async () => {
      throw new Error("gemini quota exceeded");
    });

    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("ai_failed");
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
