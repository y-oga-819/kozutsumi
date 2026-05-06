"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import type {
  CalendarSubscription,
  SetAutoPromoteResult,
} from "@/entities/calendar-subscription/types";
import type { SkippedEvent } from "@/entities/event/sync";
import { setSkippedEvents } from "@/features/sync/skippedEventsCache";
import { showSyncToast } from "@/features/sync/useCalendarSync";
import type { GoogleCalendarListEntry } from "@/shared/google/calendar";

const SUBSCRIPTIONS_QUERY_KEY = ["calendar", "subscriptions"] as const;
const CALENDAR_LIST_QUERY_KEY = ["calendar", "google", "list"] as const;
const EVENTS_QUERY_KEY = ["events"] as const;

export type CalendarListItem = Pick<
  GoogleCalendarListEntry,
  | "id"
  | "summary"
  | "description"
  | "backgroundColor"
  | "foregroundColor"
  | "primary"
  | "accessRole"
>;

type SubscribeArgs = {
  externalAccountId: string;
  externalCalendarId: string;
  autoPromoteToTimeline?: boolean;
  displayName?: string | null;
  color?: string | null;
};

/**
 * Settings UI 用の subscription / Google calendar list クエリ + mutation の集約。
 *
 * - subscription / Google list はそれぞれ独立に fetch (失敗 / pending を独立に表示できる)。
 * - subscribe / unsubscribe / toggle は完了後 subscriptions と events を invalidate。
 *   events を invalidate するのは、subscribe 直後に過去 N 日分が同期され、unsubscribe で
 *   events 行が物理削除されるため。
 */
export function useCalendarSubscriptions() {
  const queryClient = useQueryClient();

  const subscriptionsQuery = useQuery<CalendarSubscription[]>({
    queryKey: SUBSCRIPTIONS_QUERY_KEY,
    queryFn: async () => {
      const res = await fetch("/api/calendar/subscriptions");
      if (!res.ok) throw new Error(`subscriptions_failed: ${res.status}`);
      const body = (await res.json()) as { subscriptions: CalendarSubscription[] };
      return body.subscriptions;
    },
  });

  const calendarListQuery = useQuery<{ items: CalendarListItem[]; needsReauth: boolean }>({
    queryKey: CALENDAR_LIST_QUERY_KEY,
    queryFn: async () => {
      const res = await fetch("/api/calendar/list");
      if (res.status === 401) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        if (body?.error === "provider_token_missing") {
          return { items: [], needsReauth: true };
        }
        throw new Error("unauthorized");
      }
      if (!res.ok) throw new Error(`list_failed: ${res.status}`);
      const body = (await res.json()) as { items: CalendarListItem[] };
      return { items: body.items, needsReauth: false };
    },
    // 設定 panel を開いている間だけ叩く前提。staleTime 短めで「再オープン時に再取得」を許容。
    staleTime: 30_000,
  });

  const invalidate = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: EVENTS_QUERY_KEY }),
    ]);
  }, [queryClient]);

  const subscribe = useMutation({
    mutationFn: async (args: SubscribeArgs) => {
      const res = await fetch("/api/calendar/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `subscribe_failed: ${res.status}`);
      }
      return (await res.json()) as {
        subscription: CalendarSubscription;
        sync: {
          synced: number;
          deleted: number;
          lastSyncedAt: string;
          skipped: SkippedEvent[];
        } | null;
      };
    },
    onSuccess: (data) => {
      void invalidate();
      // 初回同期は手動操作の延長なので、結果トースト + skipped をバナー用キャッシュに反映する。
      // sync が null のケース (provider_token_missing 等で初回同期がスキップされた場合) は無視。
      if (data.sync) {
        setSkippedEvents(queryClient, data.sync.skipped);
        showSyncToast(data.sync.synced, data.sync.skipped.length);
      }
    },
  });

  const unsubscribe = useMutation({
    mutationFn: async (subscriptionId: string) => {
      const res = await fetch(`/api/calendar/subscriptions/${subscriptionId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `unsubscribe_failed: ${res.status}`);
      }
      return (await res.json()) as { deleted_events: number; affected_tasks: number };
    },
    onSuccess: () => {
      void invalidate();
    },
  });

  const toggleAutoPromote = useMutation({
    mutationFn: async (args: { subscriptionId: string; autoPromoteToTimeline: boolean }) => {
      const res = await fetch(`/api/calendar/subscriptions/${args.subscriptionId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ autoPromoteToTimeline: args.autoPromoteToTimeline }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `toggle_failed: ${res.status}`);
      }
      return (await res.json()) as { result: SetAutoPromoteResult };
    },
    onSuccess: () => {
      void invalidate();
    },
  });

  return {
    subscriptionsQuery,
    calendarListQuery,
    subscribe,
    unsubscribe,
    toggleAutoPromote,
  };
}
