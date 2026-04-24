import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, test, vi } from "vitest";

import type { Database } from "@/shared/types/database";

import { SupabaseCalendarSyncStateGateway } from "./supabase-gateway";

type Sb = SupabaseClient<Database>;

function makeSupabase(overrides: {
  getUserId?: string | null;
  selectResult?: {
    data: {
      user_id: string;
      last_synced_at: string;
      sync_token: string | null;
      updated_at: string;
    } | null;
    error: { code?: string; message?: string } | null;
  };
  upsertError?: { message: string } | null;
}) {
  const userId = overrides.getUserId === undefined ? "user-1" : overrides.getUserId;
  const maybeSingle = vi.fn(async () =>
    overrides.selectResult ?? { data: null, error: null },
  );
  const eqSelect = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq: eqSelect }));
  const upsert = vi.fn<
    (
      payload: Record<string, unknown>,
      options: { onConflict: string },
    ) => Promise<{ error: { message: string } | null }>
  >(async () => ({ error: overrides.upsertError ?? null }));
  const from = vi.fn(() => ({ select, upsert }));
  const supabase = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      })),
    },
    from,
  } as unknown as Sb;
  return { supabase, from, select, eqSelect, maybeSingle, upsert };
}

describe("SupabaseCalendarSyncStateGateway.get", () => {
  test("行があれば CalendarSyncState を返す", async () => {
    const { supabase, from, select, eqSelect } = makeSupabase({
      selectResult: {
        data: {
          user_id: "user-1",
          last_synced_at: "2026-04-24T10:00:00.000Z",
          sync_token: null,
          updated_at: "2026-04-24T10:00:00.000Z",
        },
        error: null,
      },
    });

    const gw = new SupabaseCalendarSyncStateGateway(supabase);
    const state = await gw.get();

    expect(state).toEqual({
      lastSyncedAt: "2026-04-24T10:00:00.000Z",
      syncToken: null,
    });
    expect(from).toHaveBeenCalledWith("user_calendar_sync_state");
    expect(select).toHaveBeenCalledWith(
      "user_id, last_synced_at, sync_token, updated_at",
    );
    expect(eqSelect).toHaveBeenCalledWith("user_id", "user-1");
  });

  test("行がなければ null を返す", async () => {
    const { supabase } = makeSupabase({
      selectResult: { data: null, error: null },
    });

    const gw = new SupabaseCalendarSyncStateGateway(supabase);
    const state = await gw.get();

    expect(state).toBeNull();
  });

  test("未ログイン時は null を返す (RLS に到達させず先に弾く)", async () => {
    const { supabase, from } = makeSupabase({ getUserId: null });
    const gw = new SupabaseCalendarSyncStateGateway(supabase);

    const state = await gw.get();

    expect(state).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  test("Supabase が error を返したら throw する", async () => {
    const { supabase } = makeSupabase({
      selectResult: {
        data: null,
        error: { code: "500", message: "db down" },
      },
    });
    const gw = new SupabaseCalendarSyncStateGateway(supabase);

    await expect(gw.get()).rejects.toMatchObject({ message: "db down" });
  });
});

describe("SupabaseCalendarSyncStateGateway.upsertLastSyncedAt", () => {
  test("user_id + last_synced_at を on conflict user_id で upsert する", async () => {
    const { supabase, from, upsert } = makeSupabase({});
    const gw = new SupabaseCalendarSyncStateGateway(supabase);

    await gw.upsertLastSyncedAt("2026-04-24T10:00:00.000Z");

    expect(from).toHaveBeenCalledWith("user_calendar_sync_state");
    expect(upsert).toHaveBeenCalledTimes(1);
    const [payload, options] = upsert.mock.calls[0]!;
    expect(payload).toMatchObject({
      user_id: "user-1",
      last_synced_at: "2026-04-24T10:00:00.000Z",
    });
    // sync_token は触らない (P2-6 予約枠、既存値を保持)
    expect(payload).not.toHaveProperty("sync_token");
    expect(options).toEqual({ onConflict: "user_id" });
  });

  test("未ログイン時は throw する (Route Handler 以外からの呼び出しを防ぐ)", async () => {
    const { supabase } = makeSupabase({ getUserId: null });
    const gw = new SupabaseCalendarSyncStateGateway(supabase);

    await expect(
      gw.upsertLastSyncedAt("2026-04-24T10:00:00.000Z"),
    ).rejects.toThrow(/not authenticated/i);
  });

  test("Supabase が error を返したら throw する", async () => {
    const { supabase } = makeSupabase({
      upsertError: { message: "insert failed" },
    });
    const gw = new SupabaseCalendarSyncStateGateway(supabase);

    await expect(
      gw.upsertLastSyncedAt("2026-04-24T10:00:00.000Z"),
    ).rejects.toMatchObject({ message: "insert failed" });
  });
});
