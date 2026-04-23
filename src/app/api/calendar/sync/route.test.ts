import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/shared/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/shared/supabase/server";

import { POST } from "./route";

type SessionShape = {
  provider_token?: string | null;
  provider_refresh_token?: string | null;
};

function makeSupabase(session: SessionShape | null): SupabaseClient {
  return {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session },
        error: null,
      })),
    },
  } as unknown as SupabaseClient;
}

describe("POST /api/calendar/sync", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("未ログイン時は 401 を返す", async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabase(null));

    const response = await POST();

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  test("provider_token が無ければ 401 (Google 連携が必要)", async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabase({
        provider_token: null,
        provider_refresh_token: null,
      }),
    );

    const response = await POST();

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("provider_token_missing");
  });

  test("session と provider_token が揃っていれば骨格として 200 を返す", async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabase({
        provider_token: "access-1",
        provider_refresh_token: "refresh-1",
      }),
    );

    const response = await POST();

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ synced: 0, deleted: 0 });
  });
});
