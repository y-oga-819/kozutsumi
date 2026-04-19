import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "@/shared/types/database";

import { getSupabaseEnv } from "./env";

/**
 * Server Component / Route Handler 向け Supabase クライアント。
 *
 * Next.js 15 以降は `cookies()` が Promise を返すため await する。
 * Server Component からは cookie を set できないので、setAll は
 * 例外を握り潰す (セッション更新は middleware が担う)。
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabaseEnv();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component からの set は無視して OK。middleware が refresh する。
        }
      },
    },
  });
}
