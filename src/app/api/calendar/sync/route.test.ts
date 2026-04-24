import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/shared/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/entities/event/sync", () => ({
  syncGoogleCalendar: vi.fn(),
}));

import { syncGoogleCalendar } from "@/entities/event/sync";
import {
  ProviderTokenMissingError,
  RefreshTokenExpiredError,
} from "@/shared/google/token";
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
    vi.mocked(syncGoogleCalendar).mockReset();
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
    expect(syncGoogleCalendar).not.toHaveBeenCalled();
  });

  test("ProviderTokenMissingError → 401 provider_token_missing (再ログイン誘導)", async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabase({ provider_token: null, provider_refresh_token: null }),
    );
    vi.mocked(syncGoogleCalendar).mockRejectedValue(
      new ProviderTokenMissingError("no token"),
    );

    const response = await POST();

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("provider_token_missing");
  });

  test("RefreshTokenExpiredError → 401 provider_token_missing (再ログイン誘導)", async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabase({
        provider_token: "access-1",
        provider_refresh_token: "expired",
      }),
    );
    vi.mocked(syncGoogleCalendar).mockRejectedValue(
      new RefreshTokenExpiredError("refresh failed"),
    );

    const response = await POST();

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("provider_token_missing");
  });

  test("正常系: syncGoogleCalendar の結果 {synced, deleted, lastSyncedAt} を 200 で返す", async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabase({
        provider_token: "access-1",
        provider_refresh_token: "refresh-1",
      }),
    );
    vi.mocked(syncGoogleCalendar).mockResolvedValue({
      synced: 5,
      deleted: 1,
      lastSyncedAt: "2026-04-24T00:00:00.000Z",
    });

    const response = await POST();

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({
      synced: 5,
      deleted: 1,
      lastSyncedAt: "2026-04-24T00:00:00.000Z",
    });
    expect(syncGoogleCalendar).toHaveBeenCalledTimes(1);
  });

  test("その他の例外は 500 を返す", async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabase({
        provider_token: "access-1",
        provider_refresh_token: "refresh-1",
      }),
    );
    vi.mocked(syncGoogleCalendar).mockRejectedValue(
      new Error("unexpected failure"),
    );

    const response = await POST();

    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("sync_failed");
  });
});
