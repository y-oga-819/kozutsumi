import { SupabaseEventGateway } from "@/entities/event/supabase-gateway";
import { SupabaseProjectGateway } from "@/entities/project/supabase-gateway";
import { SupabaseTaskGateway } from "@/entities/task/supabase-gateway";
import { SupabaseTaskTimeEntryGateway } from "@/entities/task/supabase-time-entry-gateway";
import { createClient } from "@/shared/supabase/client";

import type { GatewayBundle } from "./GatewayContext";

/**
 * Supabase 版 Gateway 群を 1 つの SupabaseClient 上に束ねて生成する。
 * `createClient()` はブラウザ環境前提のため、呼び出しは必ずクライアント境界内で行う。
 */
export function createSupabaseGateways(): GatewayBundle {
  const supabase = createClient();
  return {
    taskGateway: new SupabaseTaskGateway(supabase),
    taskTimeEntryGateway: new SupabaseTaskTimeEntryGateway(supabase),
    projectGateway: new SupabaseProjectGateway(supabase),
    eventGateway: new SupabaseEventGateway(supabase),
  };
}
