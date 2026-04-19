"use client";

import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/shared/types/database";

import { getSupabaseEnv } from "./env";

/**
 * ブラウザ実行環境向けの Supabase クライアント。
 *
 * Next.js の Client Component から使う。セッションは cookie に保持され、
 * middleware 経由でサーバーとも同期する。
 */
export function createClient() {
  const { url, anonKey } = getSupabaseEnv();
  return createBrowserClient<Database>(url, anonKey);
}
