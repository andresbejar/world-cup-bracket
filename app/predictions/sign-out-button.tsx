"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="font-mono text-xs uppercase tracking-[0.08em] text-text-muted transition-colors duration-[var(--motion-micro)] hover:text-text-primary disabled:opacity-60"
    >
      {pending ? "…" : "Sign out"}
    </button>
  );
}
