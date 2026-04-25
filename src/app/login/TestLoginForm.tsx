"use client";

import { useState } from "react";

import { createClient } from "@/shared/supabase/client";

/**
 * E2E テスト専用の password sign-in フォーム。
 *
 * `NODE_ENV !== "production"` かつ `NEXT_PUBLIC_E2E_TEST_AUTH=true` のときだけ
 * 描画される (ADR 0011 二重ガード)。本番ビルドでは early return で消える。
 *
 * 役割:
 * - Playwright が Google OAuth を踏まずに本物の Supabase へログインするための導線
 * - 本番コードパス (@supabase/ssr の cookie ハンドリング) を変えずに通すため、
 *   browser client の signInWithPassword をそのまま呼ぶ
 */
export function TestLoginForm() {
  // 二重ガード: page.tsx 側 (server) のガードが env 漏れで素通りしても、
  // client 側のここで止める。NODE_ENV / NEXT_PUBLIC_E2E_TEST_AUTH は build 時に
  // inline されるため、prod build からはこの分岐ごと落ちる。
  if (process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_E2E_TEST_AUTH !== "true") {
    return null;
  }
  return <TestLoginFormInner />;
}

function TestLoginFormInner() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) {
      setError(signInError.message);
      setPending(false);
      return;
    }
    // ハードナビにする。soft nav (router.replace) だと Playwright の
    // page.waitForURL (default waitUntil:"load") が load イベントを取れず
    // タイムアウトする。サーバー側 middleware も次回 request で cookie を読める。
    window.location.assign("/");
  }

  return (
    <form
      onSubmit={onSubmit}
      data-testid="e2e-login-form"
      className="flex w-full max-w-[320px] flex-col gap-2 rounded-md border border-dashed border-bg-divider p-3"
    >
      <div className="font-jp text-[10px] text-fg-faint">E2E テスト用ログイン</div>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="email"
        autoComplete="username"
        data-testid="e2e-login-email"
        className="rounded border border-bg-divider bg-bg-elevated px-3 py-2 text-[13px] text-fg-default outline-none focus:border-accent-blue"
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="password"
        autoComplete="current-password"
        data-testid="e2e-login-password"
        className="rounded border border-bg-divider bg-bg-elevated px-3 py-2 text-[13px] text-fg-default outline-none focus:border-accent-blue"
      />
      <button
        type="submit"
        disabled={pending}
        data-testid="e2e-login-submit"
        className="flex h-9 items-center justify-center rounded bg-bg-elevated px-3 text-[12px] font-medium text-fg-emphasized hover:bg-bg-divider disabled:opacity-60"
      >
        {pending ? "ログイン中..." : "ログイン"}
      </button>
      {error ? (
        <p role="alert" className="text-[11px] text-accent-red">
          {error}
        </p>
      ) : null}
    </form>
  );
}
