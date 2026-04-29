"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { ActionLogGateway } from "@/entities/action-log/gateway";
import type { EventGateway } from "@/entities/event/gateway";
import type { ProjectGateway } from "@/entities/project/gateway";
import type { TaskGateway } from "@/entities/task/gateway";
import type { TaskTimeEntryGateway } from "@/entities/task/time-entry-gateway";

import { createSupabaseGateways } from "./createSupabaseGateways";

export type GatewayBundle = {
  taskGateway: TaskGateway;
  taskTimeEntryGateway: TaskTimeEntryGateway;
  projectGateway: ProjectGateway;
  eventGateway: EventGateway;
  actionLogGateway: ActionLogGateway;
};

const GatewayContext = createContext<GatewayBundle | null>(null);

/**
 * `value` 未指定時は `createSupabaseGateways()` の結果をマウント中に固定する。
 * テスト / デモモード (#47) は `value` に mock / InMemory 実装を渡して差し替える。
 *
 * 参照安定性の境界:
 * - 未指定経路 (page.tsx 経由): マウント単位で同一参照。page 遷移 (/ ↔ /tree) で
 *   Provider が再マウントされた場合は新インスタンスになる — この判断は設計書の
 *   「AppShell 周囲に挿入」に従った結果で、現状許容。Query キャッシュが跨ぐことは
 *   想定していない。
 * - 指定経路 (テスト / デモ): `value` をそのまま透過する。呼び出し側が参照安定を担保する。
 */
export function GatewayProvider({
  value,
  children,
}: {
  value?: GatewayBundle;
  children: ReactNode;
}) {
  const resolved = useMemo(() => value ?? createSupabaseGateways(), [value]);
  return <GatewayContext.Provider value={resolved}>{children}</GatewayContext.Provider>;
}

function useGatewayBundle(): GatewayBundle {
  const ctx = useContext(GatewayContext);
  if (!ctx) {
    throw new Error(
      "GatewayProvider が見つかりません。ツリー上位で <GatewayProvider> を挿入してください。",
    );
  }
  return ctx;
}

export function useTaskGateway(): TaskGateway {
  return useGatewayBundle().taskGateway;
}

export function useTaskTimeEntryGateway(): TaskTimeEntryGateway {
  return useGatewayBundle().taskTimeEntryGateway;
}

export function useProjectGateway(): ProjectGateway {
  return useGatewayBundle().projectGateway;
}

export function useEventGateway(): EventGateway {
  return useGatewayBundle().eventGateway;
}

export function useActionLogGateway(): ActionLogGateway {
  return useGatewayBundle().actionLogGateway;
}
