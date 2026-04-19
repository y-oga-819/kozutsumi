"use client";

import { useState } from "react";

import { createClient } from "@/shared/supabase/client";

/**
 * Google OAuth でログインを開始する。
 *
 * scope に calendar.readonly を先行付与することで、Phase 2 の
 * Google Calendar 連携時に再認証を回避する (phase1.md Step 2)。
 */
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.readonly",
].join(" ");

export function LoginButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSignIn() {
    setPending(true);
    setError(null);
    const supabase = createClient();
    const origin = window.location.origin;
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${origin}/auth/callback`,
        scopes: GOOGLE_SCOPES,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });
    if (signInError) {
      setError(signInError.message);
      setPending(false);
    }
  }

  return (
    <div className="flex w-full max-w-[320px] flex-col gap-3">
      <button
        type="button"
        onClick={onSignIn}
        disabled={pending}
        className="flex h-11 items-center justify-center gap-2 rounded-md bg-bg-elevated px-4 text-[13px] font-medium text-fg-emphasized transition-colors hover:bg-bg-divider disabled:opacity-60"
      >
        {pending ? "リダイレクト中..." : "Google でログイン"}
      </button>
      {error ? (
        <p role="alert" className="text-[11px] text-accent-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}
