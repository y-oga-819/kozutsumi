import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * e2e 共通 setup (ADR 0011)。
 *
 * 1. 必須環境変数を検証する
 * 2. service_role で auth admin API を叩いてテストユーザーを idempotent に用意する
 * 3. テストユーザーの projects / tasks / events を空にしてから e2e を始める
 *    (前回実行の残骸を引きずらない)
 *
 * Phase 1 自動 seed (AppShell) は localStorage の `kozutsumi.sample-data.v1=cleared`
 * フラグで止める。これは fixture 側で page.goto 前に addInitScript で書き込む。
 */
async function globalSetup(): Promise<void> {
  const url = required("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const email = required("E2E_TEST_USER_EMAIL");
  const password = required("E2E_TEST_USER_PASSWORD");

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const userId = await ensureTestUser(admin, email, password);
  await purgeUserData(admin, userId);
}

async function ensureTestUser(
  admin: SupabaseClient,
  email: string,
  password: string,
): Promise<string> {
  // listUsers でメールに一致するものを探す。1ページ目で十分 (ローカル DB に
  // ユーザーが大量に存在することはない前提)。
  const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (listError) {
    throw new Error(`[e2e] listUsers failed: ${listError.message}`);
  }
  const existing = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (existing) {
    // password を毎回上書きして「known good」状態に揃える
    const { error: updErr } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
    });
    if (updErr) {
      throw new Error(`[e2e] updateUserById failed: ${updErr.message}`);
    }
    return existing.id;
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError || !created.user) {
    throw new Error(`[e2e] createUser failed: ${createError?.message ?? "no user returned"}`);
  }
  return created.user.id;
}

/**
 * RLS を service_role でバイパスし、対象 user_id の関連データを全削除。
 * tasks → events → projects の順 (FK / RLS の依存関係に合わせる)。
 * task_time_entries / action_logs は親テーブル CASCADE / SET NULL で連動する。
 */
async function purgeUserData(admin: SupabaseClient, userId: string): Promise<void> {
  for (const table of ["tasks", "events", "projects", "action_logs"] as const) {
    const { error } = await admin.from(table).delete().eq("user_id", userId);
    if (error) {
      throw new Error(`[e2e] purge ${table} failed: ${error.message}`);
    }
  }
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`[e2e] Missing env: ${name}`);
  }
  return v;
}

export default globalSetup;
