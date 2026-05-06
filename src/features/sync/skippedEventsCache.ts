"use client";

import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import type { SkippedEvent } from "@/entities/event/sync";

/**
 * 直近の sync で取り込みをスキップした予定一覧を保持するキャッシュ。
 *
 * - 任意のユーザー操作 (手動 sync / subscribe) や lazy sync が完了したら `setSkippedEvents` で書き換える
 * - `SyncSkippedBanner` / 詳細 dialog が `useSkippedEvents` で読む
 * - セッション中は値が残るので、ユーザーがページ遷移しても broken event の存在に気づける
 *   (β 案: in-session permanence。リロードで消えるが、次の sync で復活する)
 */
export const SKIPPED_EVENTS_QUERY_KEY = ["calendar", "sync", "skipped"] as const;

export function useSkippedEvents(): SkippedEvent[] {
  const { data } = useQuery<SkippedEvent[]>({
    queryKey: SKIPPED_EVENTS_QUERY_KEY,
    // setQueryData で外から更新する前提。queryFn は initial fetch を抑止するためのダミー。
    queryFn: () => [],
    staleTime: Infinity,
    initialData: [],
  });
  return data ?? [];
}

export function setSkippedEvents(client: QueryClient, skipped: SkippedEvent[]): void {
  client.setQueryData<SkippedEvent[]>(SKIPPED_EVENTS_QUERY_KEY, skipped);
}

export function useDismissSkippedEvents(): () => void {
  const client = useQueryClient();
  return useCallback(() => {
    setSkippedEvents(client, []);
  }, [client]);
}
