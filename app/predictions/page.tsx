import { redirect } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "./sign-out-button";

export const metadata = { title: "Predictions — World Cup Bracket" };

const ROUNDS = [
  { id: "groups", label: "GROUPS", note: "JUN 11 → JUN 27" },
  { id: "r32", label: "R32", note: "JUN 28 → JUL 03" },
  { id: "r16", label: "R16", note: "JUL 04 → JUL 07" },
  { id: "qf", label: "QF", note: "JUL 09 → JUL 11" },
  { id: "sf", label: "SF", note: "JUL 14 → JUL 15" },
  { id: "third", label: "3RD", note: "JUL 18" },
  { id: "final", label: "FINAL", note: "JUL 19" },
] as const;

export default async function PredictionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data: profile } = await supabase
    .from("users")
    .select("username, profile_pic, total_points")
    .eq("id", user.id)
    .maybeSingle();

  const username = profile?.username ?? "player";
  const avatar = profile?.profile_pic ?? null;
  const points = profile?.total_points ?? 0;

  return (
    <div className="min-h-[100svh]">
      <TopBar username={username} avatar={avatar} points={points} email={user.email ?? ""} />

      <main className="mx-auto max-w-[1440px] px-4 pb-24 pt-8 md:px-8">
        <RoundSelector activeId="groups" />

        <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-[60fr_40fr] md:gap-12">
          <section aria-label="Active round predictions">
            <SectionHeading
              eyebrow="ACTIVE ROUND · GROUP STAGE"
              title="Matchday 1"
              meta="LOCKS IN 32D 04H"
            />
            <div className="mt-6 space-y-3">
              <MatchRowPlaceholder home="MEX" away="USA" venue="Estadio Azteca · Mexico City" />
              <MatchRowPlaceholder home="ARG" away="KSA" venue="MetLife Stadium · East Rutherford" />
              <MatchRowPlaceholder home="BRA" away="CMR" venue="SoFi Stadium · Inglewood" />
            </div>
            <p className="mt-6 font-mono text-xs uppercase tracking-[0.08em] text-text-dim">
              Match data &amp; score inputs ship in APT-19. Real bracket logic in APT-12 → APT-17.
            </p>
          </section>

          <aside
            aria-label="Bracket tree"
            className="md:sticky md:top-8 md:self-start"
          >
            <SectionHeading
              eyebrow="BRACKET"
              title="Knockout tree"
              meta="48 TEAMS · 32 ADVANCE"
            />
            <BracketTreePlaceholder />
          </aside>
        </div>
      </main>
    </div>
  );
}

function TopBar({
  username,
  avatar,
  points,
  email,
}: {
  username: string;
  avatar: string | null;
  points: number;
  email: string;
}) {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between px-4 py-5 md:px-8">
        <p
          className="font-display text-2xl leading-none"
          style={{ fontFamily: "var(--font-display)" }}
        >
          World Cup{" "}
          <em
            className="not-italic"
            style={{ fontStyle: "italic", color: "var(--accent)" }}
          >
            Bracket
          </em>
        </p>
        <div className="flex items-center gap-4">
          <p className="hidden font-mono text-xs uppercase tracking-[0.08em] text-text-muted sm:block">
            <span className="tabular-nums">{points.toString().padStart(3, "0")}</span> PTS
          </p>
          <div className="flex items-center gap-3 rounded-full border border-border bg-surface py-1.5 pl-1.5 pr-3">
            {avatar ? (
              <Image
                src={avatar}
                alt=""
                width={28}
                height={28}
                className="rounded-full"
                unoptimized
              />
            ) : (
              <div
                aria-hidden
                className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-high font-mono text-[10px] uppercase text-text-muted"
              >
                {username.slice(0, 2)}
              </div>
            )}
            <span
              className="text-sm"
              title={email}
            >
              {username}
            </span>
          </div>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}

function RoundSelector({ activeId }: { activeId: string }) {
  return (
    <nav
      aria-label="Tournament rounds"
      className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0"
    >
      <ul className="flex min-w-max items-center gap-2">
        {ROUNDS.map((round) => {
          const active = round.id === activeId;
          return (
            <li key={round.id}>
              <button
                type="button"
                aria-current={active ? "page" : undefined}
                className={
                  "group flex flex-col items-start gap-0.5 rounded-full border px-4 py-2 transition-colors duration-[var(--motion-micro)] " +
                  (active
                    ? "border-transparent bg-accent text-bg"
                    : "border-border bg-surface text-text-muted hover:text-text-primary")
                }
              >
                <span className="font-mono text-xs font-bold uppercase tracking-[0.08em]">
                  {round.label}
                </span>
                <span
                  className={
                    "font-mono text-[10px] uppercase tracking-[0.06em] " +
                    (active ? "text-bg/70" : "text-text-dim")
                  }
                >
                  {round.note}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function SectionHeading({
  eyebrow,
  title,
  meta,
}: {
  eyebrow: string;
  title: string;
  meta: string;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-muted">
          {eyebrow}
        </p>
        <h2
          className="mt-1 font-display text-3xl leading-tight tracking-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {title}
        </h2>
      </div>
      <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
        {meta}
      </p>
    </div>
  );
}

function MatchRowPlaceholder({
  home,
  away,
  venue,
}: {
  home: string;
  away: string;
  venue: string;
}) {
  return (
    <article className="flex items-center justify-between rounded-md border border-border bg-surface px-5 py-4">
      <div className="flex flex-col gap-1.5">
        <TeamLine code={home} />
        <TeamLine code={away} />
      </div>
      <div className="flex flex-col items-end gap-2">
        <div className="flex items-center gap-2">
          <ScoreCell />
          <span className="font-mono text-xs text-text-dim">:</span>
          <ScoreCell />
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim">
          {venue}
        </p>
      </div>
    </article>
  );
}

function TeamLine({ code }: { code: string }) {
  return (
    <div className="flex items-center gap-3">
      <div
        aria-hidden
        className="h-5 w-7 rounded-sm bg-surface-high"
      />
      <span className="font-mono text-sm font-bold uppercase tracking-[0.06em]">
        {code}
      </span>
    </div>
  );
}

function ScoreCell() {
  return (
    <div
      aria-hidden
      className="h-9 w-10 rounded-sm border border-border bg-bg"
    />
  );
}

function BracketTreePlaceholder() {
  // Six columns of slot rectangles, narrowing toward the trophy.
  // Pure visual chrome — APT-13/APT-18 wires real slot data.
  const columns = [
    { count: 16, label: "R32" },
    { count: 8, label: "R16" },
    { count: 4, label: "QF" },
    { count: 2, label: "SF" },
    { count: 1, label: "F" },
  ];
  return (
    <div className="mt-6 rounded-md border border-border bg-surface p-5">
      <div className="flex items-stretch justify-between gap-2">
        {columns.map((col) => (
          <div key={col.label} className="flex flex-1 flex-col items-center gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-dim">
              {col.label}
            </span>
            <div className="flex w-full flex-col gap-1">
              {Array.from({ length: col.count }).map((_, i) => (
                <div
                  key={i}
                  className={
                    "h-9 rounded-sm border border-border bg-surface-high " +
                    (col.label === "R32" ? "border-accent-muted/60" : "")
                  }
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim">
        Real slot data wires up in APT-13 &amp; APT-18.
      </p>
    </div>
  );
}
