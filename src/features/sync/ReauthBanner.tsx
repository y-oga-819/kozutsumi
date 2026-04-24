"use client";

import { useState } from "react";

import { createClient } from "@/shared/supabase/client";

// ログイン時と同じ scope を指定して再同意させる。
// LoginButton.tsx と重複するが、単一コンポーネントに畳むと認証/バナーの責務が混ざるので分けておく。
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.readonly",
].join(" ");

type ReauthBannerProps = {
  visible: boolean;
  onDismiss: () => void;
};

/**
 * `provider_token_missing` (401) を受けたときに出す再ログインバナー。
 * 「再連携」ボタンで `signInWithOAuth` を起動して OAuth 再同意へ誘導する。
 */
export function ReauthBanner({ visible, onDismiss }: ReauthBannerProps) {
  const [pending, setPending] = useState(false);
  if (!visible) return null;

  async function onReauth() {
    setPending(true);
    const supabase = createClient();
    const origin = window.location.origin;
    const { error } = await supabase.auth.signInWithOAuth({
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
    if (error) {
      console.error("[reauth] signInWithOAuth failed", error);
      setPending(false);
    }
  }

  return (
    <div
      role="alert"
      className="flex items-center gap-3 border-b border-accent-red/40 bg-accent-red/10 px-4 py-2 text-[12px] text-fg-emphasized"
    >
      <span className="flex-1">
        Google カレンダーの連携が失効しました。再連携すると同期が再開します。
      </span>
      <button
        type="button"
        onClick={onReauth}
        disabled={pending}
        className="rounded bg-accent-red px-3 py-1 text-[11px] font-medium text-fg-invert transition-colors hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "リダイレクト中..." : "Google と連携し直す"}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="バナーを閉じる"
        className="text-fg-muted transition-colors hover:text-fg-emphasized"
      >
        ×
      </button>
    </div>
  );
}
