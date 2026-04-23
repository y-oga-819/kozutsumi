/**
 * Google OAuth の client_id / client_secret を読み取る。
 *
 * provider_token の refresh で Google OAuth token endpoint を直接叩くために必要
 * (ADR 0009)。同じ OAuth client の値だが supabase/config.toml 用の
 * SUPABASE_AUTH_GOOGLE_* とは別名で扱う (あちらは Supabase CLI 用で runtime では未使用)。
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `[kozutsumi] Missing env: ${name}. See .env.local.example`,
    );
  }
  return value;
}

export function getGoogleOAuthEnv() {
  return {
    clientId: required(
      "GOOGLE_OAUTH_CLIENT_ID",
      process.env.GOOGLE_OAUTH_CLIENT_ID,
    ),
    clientSecret: required(
      "GOOGLE_OAUTH_CLIENT_SECRET",
      process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    ),
  };
}
