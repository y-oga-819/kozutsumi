import { NextResponse } from "next/server";

// `/views` 配下 (kozutsumi-html-design-doc skill が生成する設計書 HTML) は
// preview / local 開発でのみ閲覧可能。production deployment では 404。
//
// 運用上、HTML view は PR ブランチで commit & push して Vercel preview で読み、
// PR マージ前に削除コミットを追加することで main には残さない (運用は SKILL.md §3 参照)。
// 万一マージされてしまった場合の保険として production を 404 にしておく。
export function middleware() {
  if (process.env.VERCEL_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/views", "/views/:path*"],
};
