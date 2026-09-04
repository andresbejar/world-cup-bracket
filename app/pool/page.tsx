import Link from "next/link";
import { pool, leaderboardEntries } from "@/lib/archive";
import { TopBar } from "@/app/_components/top-bar";

export const metadata = { title: "Prize Pool — World Cup Bracket" };

// Archive note: this page used to be interactive -- payment-method tiles
// with deep links, an "I paid" claim button, and an admin confirm/undo
// control. All of that is gone. The pool is settled and paid out, so the
// page is now a record of who was in it, not a way to join it.
//
// The PayPal Pool URL and every payment handle are deliberately absent:
// a live payment endpoint on a public, permanently-linked page is a
// standing liability with no remaining purpose.

const champion = leaderboardEntries[0];

export default function PoolPage() {
  return (
    <div className="min-h-[100svh]">
      <TopBar active="leaderboard" />
      <main className="mx-auto max-w-[640px] px-4 py-12 md:px-8">
        <header className="mb-10">
          <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-muted">
            PRIZE POOL · SETTLED
          </p>
          <h1
            className="mt-1 font-display text-5xl leading-tight tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            ${pool.potUsd.toLocaleString()}
          </h1>
          <p className="mt-3 max-w-[52ch] text-text-muted">
            {pool.confirmedCount} players at ${pool.buyInUsd} each. Tracked
            here, never held here — the app recorded who had paid, and the
            money moved directly between people.
          </p>
        </header>

        {champion ? (
          <section className="mb-10 rounded-md border border-accent-muted/40 bg-surface px-5 py-4">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-accent">
              PAID OUT TO
            </p>
            <p className="mt-1 font-display text-2xl text-text-primary">
              {champion.username}
            </p>
            <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.06em] text-text-dim tabular-nums">
              {champion.total_points} PTS · {champion.exact_count} EXACT ·{" "}
              {champion.outcome_count} OUTCOME
            </p>
          </section>
        ) : null}

        <h2 className="mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-text-muted">
          Entrants
        </h2>
        <ol className="overflow-hidden rounded-md border border-border bg-surface">
          {pool.roster.map((row, idx) => (
            <li
              key={row.player_id}
              className={
                "flex items-center gap-3 px-5 py-3 " +
                (idx === pool.roster.length - 1 ? "" : "border-b border-border")
              }
            >
              {row.profile_pic ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={row.profile_pic}
                  alt=""
                  width={28}
                  height={28}
                  className="h-7 w-7 shrink-0 rounded-sm bg-surface-high"
                />
              ) : (
                <div
                  aria-hidden
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-surface-high font-mono text-[10px] uppercase text-text-muted"
                >
                  {(row.username ?? "??").slice(0, 2)}
                </div>
              )}
              <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                {row.username ?? "player"}
              </span>
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.06em] text-correct">
                {row.entry?.status === "confirmed" ? "PAID" : "—"}
              </span>
            </li>
          ))}
        </ol>

        <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim">
          <Link href="/leaderboard" className="hover:text-text-primary">
            ← Final standings
          </Link>
        </p>
      </main>
    </div>
  );
}
