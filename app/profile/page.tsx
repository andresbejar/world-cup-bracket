import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TopBar } from "@/app/_components/top-bar";
import { isAdminUserId } from "@/lib/auth-guard";
import { ProfileForm } from "./profile-form";
import { CalendarSubscribe } from "./calendar-subscribe";

export const metadata = { title: "Profile — World Cup Bracket" };

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data: profile } = await supabase
    .from("users")
    .select("username, profile_pic, total_points, is_banned")
    .eq("id", user.id)
    .maybeSingle();

  const username = profile?.username ?? "player";
  const avatar = profile?.profile_pic ?? null;
  const points = profile?.total_points ?? 0;
  const banned = profile?.is_banned ?? false;
  const isAdmin = isAdminUserId(user.id);

  // Derive the public host server-side (avoids a client hydration mismatch
  // from window.location) to build the calendar subscription links.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const calendarPath = "/api/calendar/world-cup.ics";
  const httpsUrl = `https://${host}${calendarPath}`;
  const webcalUrl = `webcal://${host}${calendarPath}`;

  return (
    <div className="min-h-[100svh]">
      <TopBar
        active="predictions"
        username={username}
        avatar={avatar}
        points={points}
        email={user.email ?? ""}
      />
      <main className="mx-auto max-w-[640px] px-4 pb-24 pt-8 md:px-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-muted">
          ACCOUNT
        </p>
        <h1
          className="mt-1 font-display text-3xl leading-tight tracking-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Your profile
        </h1>

        <section
          aria-label="Username"
          className="mt-8 rounded-md border border-border bg-surface p-6"
        >
          <ProfileForm
            initialUsername={username}
            email={user.email ?? ""}
            banned={banned}
          />
        </section>

        <section
          aria-label="Match reminders"
          className="mt-6 rounded-md border border-border bg-surface p-6"
        >
          <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-muted">
            REMINDERS
          </p>
          <h2
            className="mt-1 font-display text-xl leading-tight tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Match reminders
          </h2>
          <p className="mt-2 text-sm text-text-dim">
            Add the match calendar to your phone to get a notification 30
            minutes before every match kicks off — also your last chance to lock
            in a prediction.
          </p>
          <div className="mt-4">
            <CalendarSubscribe webcalUrl={webcalUrl} httpsUrl={httpsUrl} />
          </div>
        </section>

        {isAdmin ? (
          <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.08em] text-accent">
            ADMIN — moderation tools at <code>/api/admin/moderate</code>;
            confirm prize-pool payments on{" "}
            <a href="/pool" className="underline hover:text-text-primary">
              /pool
            </a>
            .
          </p>
        ) : null}
      </main>
    </div>
  );
}
