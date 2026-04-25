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
 * tasks / events / projects / action_logs を順に消す。
 * task_time_entries は tasks の CASCADE / SET NULL で連動して消える。
 */
export async function purgeUserData(admin: SupabaseClient, userId: string): Promise<void> {
  for (const table of ["tasks", "events", "projects", "action_logs"] as const) {
    const { error } = await admin.from(table).delete().eq("user_id", userId);
    if (error) {
      throw new Error(`[e2e] purge ${table} failed: ${error.message}`);
    }
  }
}

export function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`[e2e] Missing env: ${name}`);
  }
  return v;
}
