/**
 * Supabase 環境変数の読み取り。
 *
 * 必須変数が無い場合は起動時に早期失敗させる。
 * クライアント側でも使うため NEXT_PUBLIC_ プレフィクス必須。
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `[kozutsumi] Missing env: ${name}. See .env.local.example`,
    );
  }
  return value;
}

export function getSupabaseEnv() {
  return {
    url: required(
      "NEXT_PUBLIC_SUPABASE_URL",
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    ),
    anonKey: required(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
  };
}
