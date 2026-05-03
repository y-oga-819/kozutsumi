"use client";

import { useEffect, useRef } from "react";

import type { CalendarSyncState, CalendarSyncStateGateway } from "@/entities/calendar-sync/gateway";
import { SupabaseCalendarSyncStateGateway } from "@/entities/calendar-sync/supabase-gateway";
import type { CalendarSyncTrigger } from "@/entities/action-log/types";
import { createClient } from "@/shared/supabase/client";

import { SYNC_STALE_THRESHOLD_MINUTES } from "./constants";

export type UseLazyCalendarSyncDeps = {
  getState: () => Promise<CalendarSyncState | null>;
  now: () => Date;
};

export type UseLazyCalendarSyncOptions = {
  triggerSync: (trigger: CalendarSyncTrigger) => void;
  deps?: Partial<UseLazyCalendarSyncDeps>;
};

/**
 * 起動時遅延同期 (ADR 0007) の副作用フック。
 *
 * マウント時に最終同期時刻を 1 回だけ読み取り、{@link SYNC_STALE_THRESHOLD_MINUTES} 分
 * 以上経過していれば `triggerSync('lazy')` をバックグラウンドで呼ぶ。
 * ref ガードで React.StrictMode の 2 重 fire と、親の再レンダリングによる再実行を防ぐ。
 */
export function useLazyCalendarSync({ triggerSync, deps }: UseLazyCalendarSyncOptions): void {
  const hasRunRef = useRef(false);

  useEffect(() => {
    if (hasRunRef.current) return;
    hasRunRef.current = true;

    const getState = deps?.getState ?? defaultGetState;
    const now = deps?.now ?? (() => new Date());

    void (async () => {
      try {
        const state = await getState();
        if (shouldTriggerLazy(state, now())) {
          triggerSync("lazy");
        }
      } catch (err) {
        // 状態取得に失敗したらユーザー操作 (手動ボタン) に任せる。
        console.error("[lazy-sync] failed to read sync state", err);
      }
    })();
  }, [triggerSync, deps]);
}

export function shouldTriggerLazy(state: CalendarSyncState | null, now: Date): boolean {
  if (!state) return true;
  const then = new Date(state.lastSyncedAt).getTime();
  if (Number.isNaN(then)) return true;
  const elapsedMin = (now.getTime() - then) / 60000;
  return elapsedMin >= SYNC_STALE_THRESHOLD_MINUTES;
}

async function defaultGetState(): Promise<CalendarSyncState | null> {
  const supabase = createClient();
  // ADR 0031/0033: sync_state は (source, external_account_id, external_calendar_id) で識別する。
  // client 側では read-only に primary Google account を解決し、未存在なら null を返して
  // 「sync が一度も走っていない」(= trigger 候補) として扱う。
  // external_accounts の lazy 作成は server 側 sync 経路 (sync.ts) で行う。
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: account } = await supabase
    .from("external_accounts")
    .select("id")
    .eq("user_id", user.id)
    .eq("source", "google_calendar")
    .limit(1)
    .maybeSingle();
  if (!account) return null;
  const gateway: CalendarSyncStateGateway = new SupabaseCalendarSyncStateGateway(supabase);
  return gateway.get({
    source: "google_calendar",
    externalAccountId: account.id,
    externalCalendarId: "primary",
  });
}
