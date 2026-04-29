import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import type { ActionLogGateway } from "@/entities/action-log/gateway";
import type { EventGateway } from "@/entities/event/gateway";
import type { ProjectGateway } from "@/entities/project/gateway";
import type { TaskGateway } from "@/entities/task/gateway";
import type { TaskTimeEntryGateway } from "@/entities/task/time-entry-gateway";

import { GatewayProvider, type GatewayBundle } from "./GatewayContext";

/**
 * 未指定メソッドへのアクセスで明示的に throw するストリクトなモック Gateway を返す。
 * 「呼ばれるはずのないメソッドが呼ばれた」「テストが足りないモックを要求している」状況を
 * テスト失敗として検出する（undefined 関数呼び出しによる TypeError より診断しやすい）。
 */
function strictMockGateway<T extends object>(name: string, override: Partial<T> = {}): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      const val = (override as Record<string | symbol, unknown>)[prop as string];
      if (val !== undefined) return val;
      throw new Error(
        `[withGateways] ${name}.${String(prop)} が未指定です。テストで使うメソッドをオーバーライドに渡してください。`,
      );
    },
  });
}

export type GatewayOverrides = {
  taskGateway?: Partial<TaskGateway>;
  taskTimeEntryGateway?: Partial<TaskTimeEntryGateway>;
  projectGateway?: Partial<ProjectGateway>;
  eventGateway?: Partial<EventGateway>;
  actionLogGateway?: Partial<ActionLogGateway>;
};

export type WithGatewaysResult = {
  Wrapper: (props: { children: ReactNode }) => ReactNode;
  queryClient: QueryClient;
  bundle: GatewayBundle;
};

/**
 * renderHook / render 用のラッパー。QueryClientProvider と GatewayProvider を
 * まとめて挿入する。`overrides` で渡した Gateway メソッドのみが呼び出し可能で、
 * 未指定メソッドへのアクセスは即 throw する。
 */
export function withGateways(overrides: GatewayOverrides = {}): WithGatewaysResult {
  const bundle: GatewayBundle = {
    taskGateway: strictMockGateway<TaskGateway>("TaskGateway", overrides.taskGateway),
    taskTimeEntryGateway: strictMockGateway<TaskTimeEntryGateway>(
      "TaskTimeEntryGateway",
      overrides.taskTimeEntryGateway,
    ),
    projectGateway: strictMockGateway<ProjectGateway>("ProjectGateway", overrides.projectGateway),
    eventGateway: strictMockGateway<EventGateway>("EventGateway", overrides.eventGateway),
    actionLogGateway: strictMockGateway<ActionLogGateway>(
      "ActionLogGateway",
      overrides.actionLogGateway,
    ),
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <GatewayProvider value={bundle}>{children}</GatewayProvider>
      </QueryClientProvider>
    );
  }
  return { Wrapper, queryClient, bundle };
}
