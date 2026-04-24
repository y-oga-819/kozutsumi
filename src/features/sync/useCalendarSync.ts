"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import {
  ACTION_TYPES,
  log,
} from "@/entities/action-log/logger";
import type { CalendarSyncTrigger } from "@/entities/action-log/types";

const SYNC_ENDPOINT = "/api/calendar/sync";
const EVENTS_QUERY_KEY = ["events"] as const;

export type CalendarSyncResult = {
  synced: number;
  deleted: number;
  lastSyncedAt: string;
};

/**
 * `/api/calendar/sync` が返す 401 のうち、再ログイン (OAuth 再同意) が必要な
 * provider_token_missing だけを識別する目印。UI はこれを見て Reauth バナーを出す。
 */
export const CALENDAR_SYNC_REAUTH_REQUIRED = "reauth_required" as const;

export type UseCalendarSyncResult = {
  /** 同期を発火する (fire-and-forget)。結果は hook の state で観測する。 */
  triggerSync: (trigger: CalendarSyncTrigger) => void;
  isPending: boolean;
  /** `provider_token_missing` (401) を受けた場合に true。Reauth バナー表示に使う。 */
  needsReauth: boolean;
  dismissReauth: () => void;
  /** 直近の同期成功時刻 (ISO8601)。まだ一度も成功していなければ null。 */
  lastSyncedAt: string | null;
};

/**
 * カレンダー同期を発火するフック。
 * ADR 0007 の「手動 + 起動時遅延」どちらの経路からも同じ実装を通す。
 *
 * AppShell で 1 回だけ呼び、`CalendarSyncButton` / `ReauthBanner` / 起動時遅延
 * (Phase 5) へ result を props 渡しする想定。
 */
export function useCalendarSync(): UseCalendarSyncResult {
  const queryClient = useQueryClient();
  const [needsReauth, setNeedsReauth] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const mutation = useMutation<CalendarSyncResult, Error, CalendarSyncTrigger>({
    mutationFn: async (trigger) => {
      const res = await fetch(SYNC_ENDPOINT, { method: "POST" });
      if (res.status === 401) {
        throw new Error(CALENDAR_SYNC_REAUTH_REQUIRED);
      }
      if (!res.ok) {
        const body = (await safeJson(res)) as { message?: string } | null;
        throw new Error(body?.message ?? `sync_failed: ${res.status}`);
      }
      const body = (await res.json()) as CalendarSyncResult;
      log(ACTION_TYPES.CALENDAR_SYNCED, {
        synced: body.synced,
        deleted: body.deleted,
        trigger,
      });
      return body;
    },
    onSuccess: (data) => {
      setNeedsReauth(false);
      setLastSyncedAt(data.lastSyncedAt);
      void queryClient.invalidateQueries({ queryKey: EVENTS_QUERY_KEY });
    },
    onError: (err) => {
      if (err.message === CALENDAR_SYNC_REAUTH_REQUIRED) {
        setNeedsReauth(true);
      }
    },
  });

  const triggerSync = useCallback(
    (trigger: CalendarSyncTrigger) => {
      mutation.mutate(trigger);
    },
    [mutation],
  );

  const dismissReauth = useCallback(() => setNeedsReauth(false), []);

  return {
    triggerSync,
    isPending: mutation.isPending,
    needsReauth,
    dismissReauth,
    lastSyncedAt,
  };
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
