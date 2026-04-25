import type { SupabaseClient } from "@supabase/supabase-js";

import { getGoogleOAuthEnv } from "./env";

/**
 * Google provider token の取得と refresh。
 *
 * Supabase Auth の session に格納された Google OAuth token を扱う。
 * 401 を受けた呼び出し側が refreshAccessToken で新しい access_token を得て 1 回 retry する (ADR 0009)。
 *
 * 新しい access_token は in-memory で使う想定。Supabase session への書き戻しは
 * 現時点では見送り、次回同期で再度 refresh する。
 */

const GOOGLE_OAUTH_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export type GoogleProviderAccess = {
  accessToken: string;
  refreshToken: string;
};

export class ProviderTokenMissingError extends Error {
  readonly name = "ProviderTokenMissingError";
}

export class RefreshTokenExpiredError extends Error {
  readonly name = "RefreshTokenExpiredError";
}

export async function getValidAccessToken(supabase: SupabaseClient): Promise<GoogleProviderAccess> {
  const { accessToken, refreshToken } = await readProviderTokens(supabase);
  if (!accessToken) {
    throw new ProviderTokenMissingError("No Google provider_token in Supabase session");
  }
  return { accessToken, refreshToken };
}

export async function refreshAccessToken(supabase: SupabaseClient): Promise<GoogleProviderAccess> {
  const { refreshToken } = await readProviderTokens(supabase);
  const { clientId, clientSecret } = getGoogleOAuthEnv();

  const response = await fetch(GOOGLE_OAUTH_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });

  if (!response.ok) {
    // 400 invalid_grant 等は refresh_token 自体が expired / revoked。
    // 呼び出し側は再ログインバナー (P2-3) に誘導する。
    throw new RefreshTokenExpiredError(
      `Google OAuth refresh failed: ${response.status} ${response.statusText}`,
    );
  }

  const json = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
  };

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? refreshToken,
  };
}

async function readProviderTokens(
  supabase: SupabaseClient,
): Promise<{ accessToken: string | null; refreshToken: string }> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    throw new ProviderTokenMissingError("No Supabase session");
  }
  const refreshToken = data.session.provider_refresh_token;
  if (!refreshToken) {
    throw new ProviderTokenMissingError("No Google provider_refresh_token in Supabase session");
  }
  return {
    accessToken: data.session.provider_token ?? null,
    refreshToken,
  };
}
