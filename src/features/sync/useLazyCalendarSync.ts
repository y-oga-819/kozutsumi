"use client";

import { useEffect, useRef } from "react";

import type { CalendarSyncState } from "@/entities/calendar-sync/gateway";
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
  // ADR 0052: external_calendar_id は Google API resolve した実 id (primary なら email)。
  // client から特定 calendar 行を狙い撃ちできないので、user の google_calendar sync_state 行のうち
  // **最新の lastSyncedAt** を staleness 判定に使う。「直近どこかが sync 成功したか」が判断軸。
  // 行が 1 件もなければ未 sync として null を返し、lazy trigger 候補にする。
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: rows, error } = await supabase
    .from("user_calendar_sync_state")
    .select("last_synced_at, sync_token")
    .eq("user_id", user.id)
    .eq("source", "google_calendar")
    .order("last_synced_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = rows?.[0];
  if (!row) return null;
  return {
    lastSyncedAt: row.last_synced_at,
    syncToken: row.sync_token,
  };
}
