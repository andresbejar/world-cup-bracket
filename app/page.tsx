import Link from "next/link";
import {
  meta,
  pool,
  finalStandings,
  leaderboardEntries,
  getTeam,
  getPodiumMatches,
  getDateRange,
} from "@/lib/archive";
import { TopBar } from "@/app/_components/top-bar";

export const metadata = {
  title: "World Cup Bracket — 2026 Archive",
  description:
    "A friends-and-family FIFA World Cup 2026 prediction pool. 16 players, 104 matches, one leaderboard. Archived.",
};

// The end-of-tournament moment the live app never had.
//
// DESIGN.md § AI Slop Anti-Patterns forbids trophy/star/sparkle icons,
// gold tinting to draw the eye, centred-everything layouts and celebratory
// motion -- so this is deliberately editorial rather than a podium
// graphic: hierarchy comes from type size, and the flags carry the colour
// (DESIGN.md § Color Rules: "country flags render in their full colour;
// UI chrome stays out of the way").

const MONTH = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function fmt(iso: string) {
  const d = new Date(iso);
  return `${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export default function ArchiveHomePage() {
  const { final, thirdPlace } = getPodiumMatches();
  const range = getDateRange();
  const podium = [
    { label: "Champion", teamId: finalStandings.first_place_team_id, lead: true },
    { label: "Runner-up", teamId: finalStandings.second_place_team_id, lead: false },
    { label: "Third", teamId: finalStandings.third_place_team_id, lead: false },
  ];
  const top3 = leaderboardEntries.slice(0, 3);

  return (
    <div className="min-h-[100svh]">
      <TopBar active="home" />
      <main className="mx-auto max-w-[840px] px-4 py-16 md:px-8">
        <header className="mb-16">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-text-muted">
            FIFA World Cup 2026 · Friends &amp; family pool ·{" "}
            {fmt(range.first)} – {fmt(range.last)}
          </p>
          <h1
            className="mt-3 font-display text-4xl leading-[1.05] tracking-tight md:text-6xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            The tournament is over.
          </h1>
          <p className="mt-4 max-w-[58ch] text-text-muted">
            Sixteen of us predicted every one of the {meta.counts.matches_total}{" "}
            matches — group stage to the final — and scored them against
            reality as the results came in. This is the finished record.
          </p>
        </header>

        {/* ---- reality's podium ---- */}
        <section className="mb-16" aria-labelledby="world-champion">
          <h2
            id="world-champion"
            className="mb-5 font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-text-muted"
          >
            On the pitch
          </h2>
          <ol className="divide-y divide-border border-y border-border">
            {podium.map(({ label, teamId, lead }) => {
              const team = getTeam(teamId);
              return (
                <li
                  key={label}
                  className="flex items-center gap-4 py-5"
                >
                  <span className="w-24 shrink-0 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted">
                    {label}
                  </span>
                  {team?.flag_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={team.flag_url}
                      alt=""
                      className={
                        "shrink-0 rounded-sm bg-surface-high " +
                        (lead ? "h-10 w-14" : "h-7 w-10")
                      }
                    />
                  ) : null}
                  <span
                    className={
                      "min-w-0 flex-1 font-display leading-tight " +
                      (lead ? "text-3xl md:text-4xl" : "text-xl")
                    }
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    {team?.name ?? "—"}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.06em] text-text-dim tabular-nums">
                    {team?.code}
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim tabular-nums">
            {final && final.home_score != null ? (
              <>
                FINAL {final.home_score}–{final.away_score}
              </>
            ) : null}
            {thirdPlace && thirdPlace.home_score != null ? (
              <>
                {" · "}THIRD PLACE {thirdPlace.home_score}–
                {thirdPlace.away_score}
              </>
            ) : null}
          </p>
        </section>

        {/* ---- the pool ---- */}
        <section className="mb-16" aria-labelledby="pool-champion">
          <h2
            id="pool-champion"
            className="mb-5 font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-text-muted"
          >
            In the pool
          </h2>
          <ol className="divide-y divide-border border-y border-border">
            {top3.map((e, i) => (
              <li key={e.user_id} className="flex items-center gap-4 py-5">
                <span className="w-24 shrink-0 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted">
                  {i === 0 ? "Winner" : `${i + 1}${i === 1 ? "nd" : "rd"}`}
                </span>
                <span
                  className={
                    "min-w-0 flex-1 font-display leading-tight " +
                    (i === 0 ? "text-3xl md:text-4xl" : "text-xl")
                  }
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {e.username}
                </span>
                <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-text-primary">
                  {e.total_points}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim tabular-nums">
            ${pool.potUsd.toLocaleString()} POOL · SETTLED · TOP TWO FINISHED
            LEVEL ON {top3[0]?.total_points}, SPLIT BY THE TIEBREAKER CHAIN
          </p>
        </section>

        {/* ---- by the numbers ---- */}
        <section className="mb-16" aria-labelledby="by-the-numbers">
          <h2
            id="by-the-numbers"
            className="mb-5 font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-text-muted"
          >
            By the numbers
          </h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
            {[
              ["Matches", meta.counts.matches_finished],
              ["Players", meta.counts.players],
              ["Predictions scored", meta.counts.predictions_scored],
              ["Exact scorelines", meta.counts.exact_scores],
            ].map(([label, value]) => (
              <div key={label as string}>
                <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                  {label}
                </dt>
                <dd className="mt-1 font-mono text-2xl font-bold tabular-nums text-text-primary">
                  {(value as number).toLocaleString()}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* ---- doors ---- */}
        <nav aria-label="Archive sections" className="mb-16 flex flex-wrap gap-3">
          {[
            { href: "/leaderboard", label: "Final standings" },
            { href: "/predictions", label: "Browse the brackets" },
            { href: "/how-to-play", label: "How it worked" },
          ].map((d) => (
            <Link
              key={d.href}
              href={d.href}
              className="inline-flex min-h-[44px] items-center rounded-full border border-border bg-surface px-5 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-text-muted transition-colors duration-[var(--motion-micro)] hover:border-accent-muted hover:text-text-primary"
            >
              {d.label} →
            </Link>
          ))}
        </nav>

        <footer className="border-t border-border pt-6">
          <a
            href="https://github.com/andresbejar/world-cup-bracket"
            className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim underline decoration-border underline-offset-4 transition-colors duration-[var(--motion-micro)] hover:text-text-primary"
          >
            Source on GitHub
          </a>
        </footer>
      </main>
    </div>
  );
}
