import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// withAiRoute の中で require する supabase server client を mock
vi.mock("@/shared/supabase/server", () => ({
  createClient: vi.fn(),
}));

// Gemini SDK を mock (テストでは API key 不要・実通信なし)
const generateContentMock = vi.fn();
vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: function MockGoogleGenerativeAI() {
    return {
      getGenerativeModel: () => ({
        generateContent: generateContentMock,
      }),
    };
  },
}));

// categorizeTask 本体は別 test で踏むので、ここでは call 検証だけ行う
const categorizeTaskMock = vi.fn();
vi.mock("@/entities/task/categorize-server", () => ({
  categorizeTask: (...args: unknown[]) => categorizeTaskMock(...args),
}));

import { createClient } from "@/shared/supabase/server";

import { POST } from "./route";

function makeSupabase(user: { id: string } | null): SupabaseClient {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user }, error: null })),
    },
  } as unknown as SupabaseClient;
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/ai/categorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/ai/categorize", () => {
  const original = {
    aiEnabled: process.env.AI_ENABLED,
    geminiApiKey: process.env.GEMINI_API_KEY,
  };

  beforeEach(() => {
    delete process.env.AI_ENABLED;
    delete process.env.GEMINI_API_KEY;
    vi.mocked(createClient).mockReset();
    categorizeTaskMock.mockReset();
    generateContentMock.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    if (original.aiEnabled === undefined) delete process.env.AI_ENABLED;
    else process.env.AI_ENABLED = original.aiEnabled;
    if (original.geminiApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = original.geminiApiKey;
    vi.restoreAllMocks();
  });

  test("AI_ENABLED=false → 200 skipped, categorizeTask は呼ばれない (e2e バイパス、ADR 0014)", async () => {
    const response = await POST(makeRequest({ task_id: "t1" }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { skipped: boolean; reason: string };
    expect(body).toEqual({ skipped: true, reason: "ai_disabled" });
    expect(categorizeTaskMock).not.toHaveBeenCalled();
  });

  test("未ログイン → 401 unauthorized", async () => {
    process.env.AI_ENABLED = "true";
    process.env.GEMINI_API_KEY = "k";
    vi.mocked(createClient).mockResolvedValue(makeSupabase(null));

    const response = await POST(makeRequest({ task_id: "t1" }));

    expect(response.status).toBe(401);
    expect(categorizeTaskMock).not.toHaveBeenCalled();
  });

  test("body に task_id が無い → ok:false で error を返す (200、fire-and-forget client は無視)", async () => {
    process.env.AI_ENABLED = "true";
    process.env.GEMINI_API_KEY = "k";
    vi.mocked(createClient).mockResolvedValue(makeSupabase({ id: "u1" }));

    const response = await POST(makeRequest({ wrong_field: "x" }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; error: string };
    expect(body).toEqual({ ok: false, error: "missing task_id" });
    expect(categorizeTaskMock).not.toHaveBeenCalled();
  });

  test("body が JSON でない → ok:false で error を返す (parse エラーで 500 にしない)", async () => {
    process.env.AI_ENABLED = "true";
    process.env.GEMINI_API_KEY = "k";
    vi.mocked(createClient).mockResolvedValue(makeSupabase({ id: "u1" }));

    const response = await POST(makeRequest("not json"));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(categorizeTaskMock).not.toHaveBeenCalled();
  });

  test("正常系: categorizeTask を userId / taskId / generate 付きで呼び出す", async () => {
    process.env.AI_ENABLED = "true";
    process.env.GEMINI_API_KEY = "k";
    vi.mocked(createClient).mockResolvedValue(makeSupabase({ id: "u1" }));
    categorizeTaskMock.mockResolvedValue({ kind: "categorized", category: "coding" });
    generateContentMock.mockResolvedValue({ response: { text: () => "coding" } });

    const response = await POST(makeRequest({ task_id: "task-1" }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; outcome: unknown };
    expect(body).toEqual({
      ok: true,
      outcome: { kind: "categorized", category: "coding" },
    });

    expect(categorizeTaskMock).toHaveBeenCalledOnce();
    const callArg = categorizeTaskMock.mock.calls[0][0] as {
      userId: string;
      taskId: string;
      generate: (p: string) => Promise<string>;
    };
    expect(callArg.userId).toBe("u1");
    expect(callArg.taskId).toBe("task-1");
    expect(typeof callArg.generate).toBe("function");

    // generate を実行すると Gemini が呼ばれることを確認
    const text = await callArg.generate("dummy prompt");
    expect(generateContentMock).toHaveBeenCalledWith("dummy prompt");
    expect(text).toBe("coding");
  });

  test("categorizeTask が throw → 500 ai_failed (fail-soft、client は握り潰す)", async () => {
    process.env.AI_ENABLED = "true";
    process.env.GEMINI_API_KEY = "k";
    vi.mocked(createClient).mockResolvedValue(makeSupabase({ id: "u1" }));
    categorizeTaskMock.mockRejectedValue(new Error("unexpected db error"));

    const response = await POST(makeRequest({ task_id: "t1" }));

    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("ai_failed");
  });
});
