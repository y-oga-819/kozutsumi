import { redirect } from "next/navigation";

import { createClient } from "@/shared/supabase/server";

import { LoginButton } from "./LoginButton";

export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 px-6">
      <div className="text-center">
        <div className="font-jp text-[28px] font-bold -tracking-[0.02em]">
          <span className="text-accent-blue">kozu</span>
          <span className="text-fg-faint">tsumi</span>
        </div>
        <p className="mt-3 text-[12px] text-fg-weak">個人特化AI秘書システム</p>
      </div>
      <LoginButton />
    </div>
  );
}
