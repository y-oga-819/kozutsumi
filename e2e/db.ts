import { expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * e2e から service_role 経由でデータ操作するためのヘルパー (ADR 0011)。
 *
 * 役割:
 * - global-setup と各テスト fixture の双方から共有して使う
 * - prod Supabase に向いた状態で test ユーザー作成 / purge が走るのを防ぐため、
 *   URL の hostname を localhost / 127.0.0.1 に限定する (ADR 0011 二重ガード)。
 */
const ALLOWED_E2E_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);

function assertLocalSupabaseUrl(url: string): void {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error(`[e2e] Invalid NEXT_PUBLIC_SUPABASE_URL: ${url}`);
  }
  if (!ALLOWED_E2E_HOSTNAMES.has(hostname)) {
    throw new Error(
      `[e2e] Refusing to use non-local Supabase (${hostname}). e2e must run against local Supabase only.`,
    );
  }
}

export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("[e2e] Missing env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }
  assertLocalSupabaseUrl(url);
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function findTestUserId(admin: SupabaseClient, email: string): Promise<string | null> {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) {
    throw new Error(`[e2e] listUsers failed: ${error.message}`);
  }
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
}

/**
 * テストユーザーを idempotent に用意する (なければ create / あれば password を上書きで揃える)。
 * email_confirm は createUser でだけ有効。既存ユーザーは update でパスワードのみ上書き。
 */
export async function ensureTestUser(
  admin: SupabaseClient,
  email: string,
  password: string,
): Promise<string> {
  const existingId = await findTestUserId(admin, email);
  if (existingId) {
    const { error } = await admin.auth.admin.updateUserById(existingId, { password });
    if (error) {
      throw new Error(`[e2e] updateUserById failed: ${error.message}`);
    }
    return existingId;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`[e2e] createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return data.user.id;
}

/**
 * RLS を service_role でバイパスし、対象 user_id の関連データを全削除する。
 * tasks / events / projects / action_logs を順に消し、最後に external_accounts を消す
 * (cascade で user_calendar_subscriptions / user_calendar_sync_state も連動して消える)。
 * task_time_entries は tasks の CASCADE / SET NULL で連動して消える。
 *
 * Issue #144: calendar subscription / external_account を test 間で持ち越さないようにする。
 * 持ち越すと calendar-settings spec が `auto_promote=false` で残した subscription を
 * 後続 spec (gcal-event-readonly 等) が拾って DayTimeline 表示判定が変わる。
 */
export async function purgeUserData(admin: SupabaseClient, userId: string): Promise<void> {
  for (const table of ["tasks", "events", "projects", "action_logs"] as const) {
    const { error } = await admin.from(table).delete().eq("user_id", userId);
    if (error) {
      throw new Error(`[e2e] purge ${table} failed: ${error.message}`);
    }
  }
  const { error: extErr } = await admin.from("external_accounts").delete().eq("user_id", userId);
  if (extErr) {
    throw new Error(`[e2e] purge external_accounts failed: ${extErr.message}`);
  }
}

export function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`[e2e] Missing env: ${name}`);
  }
  return v;
}

// =====================================================================
// Assertion helpers (Issue #67)
//
// 行動データ (action_logs / task_time_entries / tasks.status) は
// kozutsumi の差別化の核 (vision.md)。UI が "それっぽく" 動いていても
// DB に正しく落ちていなければ Phase 3 の学習基盤が壊れる。
// service_role で直接 DB を query して、UI と DB の整合を踏みに行く。
// =====================================================================

export type ActionLogRow = {
  id: string;
  user_id: string;
  action_type: string;
  task_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type TimeEntryRow = {
  id: string;
  task_id: string;
  started_at: string;
  paused_at: string | null;
  pause_reason: "meeting" | "interruption" | "voluntary" | null;
  duration_seconds: number | null;
};

export type DecomposeStatus = "none" | "decomposing" | "decomposed" | "skipped" | "failed";

export type TaskRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  title: string;
  body: string;
  estimated_minutes: number | null;
  status: "idle" | "active" | "paused" | "done";
  stack_order: number | null;
  depends_on_event_id: string | null;
  task_category: "coding" | "doc" | "research" | "admin" | "other" | null;
  task_size: "15m" | "30m" | "1h" | "2h" | "4h" | "1d" | "large" | null;
  parent_task_id: string | null;
  decompose_status: DecomposeStatus;
  completed_at: string | null;
};

export type ProjectRow = {
  id: string;
  user_id: string;
  name: string;
  color: string;
  is_primary: boolean;
  created_at: string;
};

export type EventRow = {
  id: string;
  user_id: string;
  title: string;
  start_time: string;
  end_time: string;
  project_id: string | null;
  meet_url: string | null;
  has_attachments: boolean;
  description: string;
  source: "manual" | "google_calendar";
  external_id: string | null;
};

/** ユーザーの action_logs を created_at 昇順で取得する。 */
export async function getActionLogs(
  admin: SupabaseClient,
  userId: string,
  opts: { actionType?: string } = {},
): Promise<ActionLogRow[]> {
  let query = admin
    .from("action_logs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (opts.actionType) {
    query = query.eq("action_type", opts.actionType);
  }
  const { data, error } = await query;
  if (error) {
    throw new Error(`[e2e] getActionLogs failed: ${error.message}`);
  }
  return (data ?? []) as ActionLogRow[];
}

/**
 * action_logs は logger が fire-and-forget で書き込むため、UI 操作直後に
 * SELECT しても未到達のことがある。条件を満たす行が現れるまで poll する。
 */
export async function waitForActionLog(
  admin: SupabaseClient,
  userId: string,
  predicate: (row: ActionLogRow) => boolean,
  opts: { timeoutMs?: number; intervalMs?: number; description?: string } = {},
): Promise<ActionLogRow> {
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const intervalMs = opts.intervalMs ?? 100;
  const deadline = Date.now() + timeoutMs;
  let lastSeen: ActionLogRow[] = [];
  while (Date.now() < deadline) {
    const logs = await getActionLogs(admin, userId);
    lastSeen = logs;
    const hit = logs.find(predicate);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  const desc = opts.description ?? "matching action_log";
  throw new Error(
    `[e2e] timed out waiting for ${desc}. seen action_types: ${lastSeen
      .map((l) => l.action_type)
      .join(", ")}`,
  );
}

/** タスクの time_entries を started_at 昇順で取得する。 */
export async function getTimeEntries(
  admin: SupabaseClient,
  taskId: string,
): Promise<TimeEntryRow[]> {
  const { data, error } = await admin
    .from("task_time_entries")
    .select("*")
    .eq("task_id", taskId)
    .order("started_at", { ascending: true });
  if (error) {
    throw new Error(`[e2e] getTimeEntries failed: ${error.message}`);
  }
  return (data ?? []) as TimeEntryRow[];
}

/**
 * UI を経由せずに tasks 行を 1 件 insert する (P3-11)。
 *
 * AddPanel 経路は AppShell の triggerDecompose / triggerCategorize を巻き込むため、
 * `decompose_status` や `parent_task_id` を狙った状態で seed したいケース
 * (例: `decomposed` 親 + 子、`none` の leaf-parent) ではこちらを使う。
 *
 * RLS は service_role でバイパスされる。
 */
export async function seedTask(
  admin: SupabaseClient,
  input: {
    userId: string;
    projectId: string;
    title: string;
    stackOrder: number;
    parentTaskId?: string | null;
    decomposeStatus?: DecomposeStatus;
    estimatedMinutes?: number | null;
    status?: TaskRow["status"];
    taskCategory?: TaskRow["task_category"];
    body?: string;
    completedAt?: string | null;
  },
): Promise<TaskRow> {
  const { data, error } = await admin
    .from("tasks")
    .insert({
      user_id: input.userId,
      project_id: input.projectId,
      title: input.title,
      body: input.body ?? "",
      stack_order: input.stackOrder,
      parent_task_id: input.parentTaskId ?? null,
      decompose_status: input.decomposeStatus ?? "none",
      estimated_minutes: input.estimatedMinutes ?? null,
      status: input.status ?? "idle",
      task_category: input.taskCategory ?? null,
      completed_at: input.completedAt ?? null,
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`[e2e] seedTask(${input.title}) failed: ${error?.message ?? "no row"}`);
  }
  return data as TaskRow;
}

/**
 * UI を経由せずに projects 行を 1 件 insert する (P3-11)。
 * seedTask と組で使い、AddPanel を踏まずに DB を準備する。
 */
export async function seedProject(
  admin: SupabaseClient,
  input: { userId: string; name: string; color?: string; isPrimary?: boolean },
): Promise<ProjectRow> {
  const { data, error } = await admin
    .from("projects")
    .insert({
      user_id: input.userId,
      name: input.name,
      color: input.color ?? "#5B8DEF",
      is_primary: input.isPrimary ?? false,
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`[e2e] seedProject(${input.name}) failed: ${error?.message ?? "no row"}`);
  }
  return data as ProjectRow;
}

export async function getTaskByTitle(
  admin: SupabaseClient,
  userId: string,
  title: string,
): Promise<TaskRow> {
  const { data, error } = await admin
    .from("tasks")
    .select("*")
    .eq("user_id", userId)
    .eq("title", title)
    .single();
  if (error || !data) {
    throw new Error(`[e2e] getTaskByTitle(${title}) failed: ${error?.message ?? "not found"}`);
  }
  return data as TaskRow;
}

/**
 * ユーザーの tasks を一括取得する (P3-11 で「子レコードが作られないこと」を踏むのに使う)。
 */
export async function getTasksForUser(admin: SupabaseClient, userId: string): Promise<TaskRow[]> {
  const { data, error } = await admin
    .from("tasks")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) {
    throw new Error(`[e2e] getTasksForUser failed: ${error.message}`);
  }
  return (data ?? []) as TaskRow[];
}

export async function getProjectByName(
  admin: SupabaseClient,
  userId: string,
  name: string,
): Promise<ProjectRow> {
  const { data, error } = await admin
    .from("projects")
    .select("*")
    .eq("user_id", userId)
    .eq("name", name)
    .single();
  if (error || !data) {
    throw new Error(`[e2e] getProjectByName(${name}) failed: ${error?.message ?? "not found"}`);
  }
  return data as ProjectRow;
}

export async function getEventByTitle(
  admin: SupabaseClient,
  userId: string,
  title: string,
): Promise<EventRow> {
  const { data, error } = await admin
    .from("events")
    .select("*")
    .eq("user_id", userId)
    .eq("title", title)
    .single();
  if (error || !data) {
    throw new Error(`[e2e] getEventByTitle(${title}) failed: ${error?.message ?? "not found"}`);
  }
  return data as EventRow;
}

/**
 * 状態遷移 (idle -> active -> paused -> done など) は楽観的更新で UI が
 * 先に変わり、DB は数十ms 遅れて反映される。期待 status まで poll する。
 */
export async function expectTaskStatus(
  admin: SupabaseClient,
  taskId: string,
  expected: TaskRow["status"],
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<TaskRow> {
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const intervalMs = opts.intervalMs ?? 100;
  const deadline = Date.now() + timeoutMs;
  let lastStatus: string | null = null;
  while (Date.now() < deadline) {
    const { data, error } = await admin.from("tasks").select("*").eq("id", taskId).single();
    if (error || !data) {
      throw new Error(`[e2e] expectTaskStatus fetch failed: ${error?.message ?? "not found"}`);
    }
    lastStatus = (data as TaskRow).status;
    if (lastStatus === expected) return data as TaskRow;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `[e2e] timed out waiting for tasks.status=${expected} on ${taskId}. last=${lastStatus}`,
  );
}

/**
 * time_entries が期待数まで増える / 期待 entry の paused_at が埋まる、
 * のような条件を満たすまで poll する。state machine (ADR 0004) を踏むのに使う。
 */
export async function waitForTimeEntries(
  admin: SupabaseClient,
  taskId: string,
  predicate: (entries: TimeEntryRow[]) => boolean,
  opts: { timeoutMs?: number; intervalMs?: number; description?: string } = {},
): Promise<TimeEntryRow[]> {
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const intervalMs = opts.intervalMs ?? 100;
  const deadline = Date.now() + timeoutMs;
  let lastSeen: TimeEntryRow[] = [];
  while (Date.now() < deadline) {
    lastSeen = await getTimeEntries(admin, taskId);
    if (predicate(lastSeen)) return lastSeen;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  const desc = opts.description ?? "matching time_entries";
  throw new Error(
    `[e2e] timed out waiting for ${desc}. last entries: ${JSON.stringify(lastSeen, null, 2)}`,
  );
}

/**
 * task_time_entries の不変条件 (ADR 0004):
 * - open entry (paused_at is null) は高々 1 件
 * - close 済み entry は paused_at + duration_seconds が必ず埋まる
 * - duration_seconds は 0 以上 (DB 制約と二重チェック)
 */
export function assertTimeEntriesInvariants(entries: readonly TimeEntryRow[]): void {
  const openCount = entries.filter((e) => e.paused_at === null).length;
  expect(openCount, "open entry must be at most 1").toBeLessThanOrEqual(1);
  for (const e of entries) {
    if (e.paused_at !== null) {
      expect(e.duration_seconds, `closed entry ${e.id} must have duration_seconds`).not.toBeNull();
      expect(e.duration_seconds ?? -1).toBeGreaterThanOrEqual(0);
    } else {
      expect(e.duration_seconds, `open entry ${e.id} must have null duration_seconds`).toBeNull();
      expect(e.pause_reason, `open entry ${e.id} must have null pause_reason`).toBeNull();
    }
  }
}
