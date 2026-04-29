import { redirect } from "next/navigation";

import { GatewayProvider } from "@/shared/gateway/GatewayContext";
import { isAiEnabled } from "@/shared/ai/env";
import { createClient } from "@/shared/supabase/server";

import { AppShell } from "./AppShell";

export default async function Page() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  return (
    <GatewayProvider>
      <AppShell
        initialView="stack"
        aiEnabled={isAiEnabled()}
        user={{
          email: user.email ?? null,
          avatarUrl: typeof meta.avatar_url === "string" ? meta.avatar_url : null,
        }}
      />
    </GatewayProvider>
  );
}
