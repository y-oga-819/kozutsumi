import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/shared/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/entities/event/sync", () => ({
  syncGoogleCalendar: vi.fn(),
}));

import { syncGoogleCalendar } from "@/entities/event/sync";
import { ProviderTokenMissingError, RefreshTokenExpiredError } from "@/shared/google/token";
import { createClient } from "@/shared/supabase/server";

import { POST } from "./route";

type SessionShape = {
  provider_token?: string | null;
  provider_refresh_token?: string | null;
};

function makeSupabase(session: SessionShape | null): SupabaseClient {
  // session が null なら getUser も null。正常系は明示的にユーザーを返す。
  const user = session ? { id: "user-1" } : null;
  return {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session },
        error: null,
      })),
      getUser: vi.fn(async () => ({
        data: { user },
        error: null,
      })),
    },
    // event_deleted_by_source / task_event_dependency_lost 用の action_logs INSERT
    // (route は outcomes 経由で発火する)。ここでは fire-and-forget の resolve のみ提供。
    from: vi.fn(() => ({
      insert: vi.fn(async () => ({ data: null, error: null })),
    })),
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
    vi.mocked(syncGoogleCalendar).mockRejectedValue(new ProviderTokenMissingError("no token"));

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
    vi.mocked(syncGoogleCalendar).mockRejectedValue(new RefreshTokenExpiredError("refresh failed"));

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
      outcomes: [],
      skipped: [],
    });

    const response = await POST();

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({
      synced: 5,
      deleted: 1,
      lastSyncedAt: "2026-04-24T00:00:00.000Z",
      skipped: [],
    });
    expect(syncGoogleCalendar).toHaveBeenCalledTimes(1);
  });

  test("正常系: skipped がある場合はそのまま 200 で配列を返す", async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabase({
        provider_token: "access-1",
        provider_refresh_token: "refresh-1",
      }),
    );
    vi.mocked(syncGoogleCalendar).mockResolvedValue({
      synced: 2,
      deleted: 0,
      lastSyncedAt: "2026-04-24T00:00:00.000Z",
      outcomes: [],
      skipped: [
        {
          externalCalendarId: "shared@group.calendar.google.com",
          externalId: "evt-broken",
          title: "ゼロ長",
          reason: "invalid_time_range",
        },
      ],
    });

    const response = await POST();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { skipped: unknown };
    expect(body.skipped).toEqual([
      {
        externalCalendarId: "shared@group.calendar.google.com",
        externalId: "evt-broken",
        title: "ゼロ長",
        reason: "invalid_time_range",
      },
    ]);
  });

  test("その他の例外は 500 を返す", async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabase({
        provider_token: "access-1",
        provider_refresh_token: "refresh-1",
      }),
    );
    vi.mocked(syncGoogleCalendar).mockRejectedValue(new Error("unexpected failure"));

    const response = await POST();

    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("sync_failed");
  });
});
