import { redirect } from "next/navigation";

import { createClient } from "@/shared/supabase/server";

import { AppShell } from "../AppShell";

export default async function TreePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  return (
    <AppShell
      initialView="tree"
      user={{
        email: user.email ?? null,
        avatarUrl: typeof meta.avatar_url === "string" ? meta.avatar_url : null,
      }}
    />
  );
}
