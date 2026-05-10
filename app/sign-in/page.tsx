import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { GoogleSignInButton } from "./google-button";

export const metadata = { title: "Sign in — World Cup Bracket" };

export default async function SignInPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/predictions");

  return (
    <main className="mx-auto flex min-h-[100svh] max-w-md flex-col justify-center px-8 py-24">
      <p className="font-mono text-xs uppercase tracking-[0.08em] text-text-muted">
        FIFA World Cup 2026 &middot; Friends &amp; Family Pool
      </p>
      <h1
        className="mt-4 font-display text-6xl leading-[1.05] tracking-tight"
        style={{ fontFamily: "var(--font-display)" }}
      >
        World Cup{" "}
        <em
          className="not-italic"
          style={{ fontStyle: "italic", color: "var(--accent)" }}
        >
          Bracket
        </em>
      </h1>
      <p
        className="mt-6 text-lg italic text-text-primary/90"
        style={{ fontFamily: "var(--font-display)" }}
      >
        104 matches. One leaderboard. Bragging rights through July.
      </p>

      <div className="mt-12">
        <GoogleSignInButton />
      </div>

      <p className="mt-8 font-mono text-xs uppercase tracking-[0.08em] text-text-dim">
        Sign-in is invite-light: anyone with the link can join the pool.
      </p>
    </main>
  );
}
