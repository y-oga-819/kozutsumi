"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/shared/supabase/client";

type UserMenuProps = {
  email: string | null;
  avatarUrl: string | null;
  onResetSample?: () => void;
  onClearAll?: () => void;
};

/**
 * ヘッダー右端のアバター。タップでログアウト／サンプル操作メニューを開く。
 */
export function UserMenu({ email, avatarUrl, onResetSample, onClearAll }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  async function onSignOut() {
    setPending(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  const initial = (email?.[0] ?? "?").toUpperCase();

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="アカウントメニュー"
        className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-bg-divider text-[11px] font-semibold text-fg-emphasized"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          initial
        )}
      </button>
      {open ? (
        <div className="absolute right-0 top-9 z-50 w-52 rounded-md border border-bg-divider bg-bg-elevated p-2 shadow-lg">
          {email ? (
            <div className="truncate px-2 py-1 text-[11px] text-fg-muted">{email}</div>
          ) : null}
          {onResetSample ? (
            <button
              type="button"
              onClick={() => {
                onResetSample();
                setOpen(false);
              }}
              className="mt-1 w-full rounded px-2 py-1.5 text-left text-[12px] text-fg-emphasized transition-colors hover:bg-bg-divider"
            >
              サンプルを再投入
            </button>
          ) : null}
          {onClearAll ? (
            <button
              type="button"
              onClick={() => {
                onClearAll();
                setOpen(false);
              }}
              className="w-full rounded px-2 py-1.5 text-left text-[12px] text-fg-emphasized transition-colors hover:bg-bg-divider"
            >
              サンプルを全削除
            </button>
          ) : null}
          <button
            type="button"
            onClick={onSignOut}
            disabled={pending}
            className="mt-1 w-full rounded px-2 py-1.5 text-left text-[12px] text-fg-emphasized transition-colors hover:bg-bg-divider disabled:opacity-60"
          >
            {pending ? "ログアウト中..." : "ログアウト"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
