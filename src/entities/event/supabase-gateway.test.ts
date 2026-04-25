import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, test, vi } from "vitest";

import type { Database, Tables } from "@/shared/types/database";

import type { UpdateEventInput } from "./gateway";
import { SupabaseEventGateway } from "./supabase-gateway";

type Sb = SupabaseClient<Database>;
type EventRow = Tables<"events">;

function makeRow(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: "e1",
    user_id: "user-1",
    title: "Test",
    start_time: "2026-04-23T01:00:00.000Z",
    end_time: "2026-04-23T02:00:00.000Z",
    project_id: null,
    meet_url: null,
    has_attachments: false,
    description: "",
    source: "manual",
    external_id: null,
    created_at: "2026-04-23T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Supabase fluent client のテスト用モック。
 * `from(table)` を呼ぶと chain ビルダーを返し、終端 (single / maybeSingle / そのまま await) で
 * `nextResults` の先頭を取り出す。テストごとに必要なレスポンスを順番に積む。
 *
 * - `select(...).eq(...).maybeSingle()` -> nextResults から { data, error }
 * - `update(...).eq(...).select(...).single()` -> nextResults から { data, error }
 * - `delete().eq(...)` -> nextResults から { error }
 */
function makeSupabase(opts: {
  userId?: string;
  results: Array<{
    data?: unknown;
    error?: { message: string } | null;
  }>;
}) {
  const userId = opts.userId ?? "user-1";
  const results = [...opts.results];

  function takeResult() {
    const next = results.shift();
    if (!next) throw new Error("supabase mock: no more results queued");
    return { data: next.data ?? null, error: next.error ?? null };
  }

  const calls: { table: string; method: string; args: unknown[] }[] = [];

  function record(table: string, method: string, args: unknown[]) {
    calls.push({ table, method, args });
  }

  function makeBuilder(table: string) {
    const builder: Record<string, (...args: unknown[]) => unknown> = {};
    builder.select = (...args) => {
      record(table, "select", args);
      return builder;
    };
    builder.update = (...args) => {
      record(table, "update", args);
      return builder;
    };
    builder.delete = (...args) => {
      record(table, "delete", args);
      return builder;
    };
    builder.eq = (...args) => {
      record(table, "eq", args);
      return builder;
    };
    builder.single = async () => {
      record(table, "single", []);
      return takeResult();
    };
    builder.maybeSingle = async () => {
      record(table, "maybeSingle", []);
      return takeResult();
    };
    // delete().eq(...) はそのまま await されるので thenable にする
    (builder as { then?: unknown }).then = (
      onFulfilled: (value: unknown) => unknown,
    ) => {
      record(table, "await", []);
      return Promise.resolve(takeResult()).then(onFulfilled);
    };
    return builder;
  }

  const from = vi.fn((table: string) => makeBuilder(table));

  const supabase = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: userId } },
        error: null,
      })),
    },
    from,
  } as unknown as Sb;

  return { supabase, from, calls };
}

// ---------------------------------------------------------------------------
// update: ADR 0010 / P2-4 — google_calendar の Google 側属性は read-only
// ---------------------------------------------------------------------------
describe("SupabaseEventGateway.update", () => {
  test("manual: title など Google 由来属性も更新できる", async () => {
    const updated = makeRow({ title: "Renamed", source: "manual" });
    const { supabase, calls } = makeSupabase({
      results: [
        { data: { source: "manual" } }, // fetchSource
        { data: updated }, // update().eq().select().single()
      ],
    });
    const gw = new SupabaseEventGateway(supabase);

    const result = await gw.update("e1", { title: "Renamed" });

    expect(result.title).toBe("Renamed");
    // fetchSource → update の順で events テーブルを叩いている
    const eventsCalls = calls.filter((c) => c.table === "events");
    expect(eventsCalls[0]).toMatchObject({ method: "select", args: ["source"] });
    expect(
      eventsCalls.some(
        (c) =>
          c.method === "update" &&
          (c.args[0] as Record<string, unknown>).title === "Renamed",
      ),
    ).toBe(true);
  });

  test("google_calendar: projectId のみの更新は許可 (source 確認すらスキップ)", async () => {
    const updated = makeRow({
      project_id: "slo",
      source: "google_calendar",
      external_id: "ext-1",
    });
    const { supabase, calls } = makeSupabase({
      results: [
        { data: updated }, // update のみ。fetchSource は呼ばれない
      ],
    });
    const gw = new SupabaseEventGateway(supabase);

    const result = await gw.update("g1", { projectId: "slo" });

    expect(result.projectId).toBe("slo");
    // select("source") は呼ばれていない (touchesGoogleOwned が false なので)
    const sourceSelects = calls.filter(
      (c) => c.method === "select" && (c.args[0] as string) === "source",
    );
    expect(sourceSelects).toHaveLength(0);
  });

  test("google_calendar: title の更新は throw する", async () => {
    const { supabase } = makeSupabase({
      results: [
        { data: { source: "google_calendar" } }, // fetchSource
      ],
    });
    const gw = new SupabaseEventGateway(supabase);

    await expect(gw.update("g1", { title: "Hijack" })).rejects.toThrow(
      /google_calendar event is read-only/,
    );
  });

  test("google_calendar: meetUrl / description / startTime なども throw する", async () => {
    const cases: UpdateEventInput[] = [
      { meetUrl: "https://evil.example/" },
      { description: "tampered" },
      { startTime: "2099-01-01T00:00:00.000Z" },
      { endTime: "2099-01-01T01:00:00.000Z" },
      { hasAttachments: true },
    ];
    for (const patch of cases) {
      const { supabase } = makeSupabase({
        results: [{ data: { source: "google_calendar" } }],
      });
      const gw = new SupabaseEventGateway(supabase);
      await expect(gw.update("g1", patch)).rejects.toThrow(
        /google_calendar event is read-only/,
      );
    }
  });

  test("google_calendar: projectId と title を同時更新も throw (Google 側属性が混ざっていれば NG)", async () => {
    const { supabase } = makeSupabase({
      results: [{ data: { source: "google_calendar" } }],
    });
    const gw = new SupabaseEventGateway(supabase);

    await expect(
      gw.update("g1", { projectId: "slo", title: "x" }),
    ).rejects.toThrow(/google_calendar event is read-only/);
  });
});

// ---------------------------------------------------------------------------
// delete: ADR 0010 / P2-4 — google_calendar は UI から削除不可
// ---------------------------------------------------------------------------
describe("SupabaseEventGateway.delete", () => {
  test("manual: 削除できる", async () => {
    const { supabase } = makeSupabase({
      results: [
        { data: { source: "manual" } }, // fetchSource
        { data: null }, // delete().eq() の await
      ],
    });
    const gw = new SupabaseEventGateway(supabase);

    await expect(gw.delete("e1")).resolves.toBeUndefined();
  });

  test("google_calendar: 削除は throw する", async () => {
    const { supabase } = makeSupabase({
      results: [
        { data: { source: "google_calendar" } }, // fetchSource
      ],
    });
    const gw = new SupabaseEventGateway(supabase);

    await expect(gw.delete("g1")).rejects.toThrow(
      /google_calendar event cannot be deleted/,
    );
  });
});
