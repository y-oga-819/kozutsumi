import type { NextRequest } from "next/server";

import { updateSession } from "@/shared/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Next.js の静的アセットと画像は除外。
     * - _next/static, _next/image
     * - favicon.ico
     * - 画像拡張子
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
