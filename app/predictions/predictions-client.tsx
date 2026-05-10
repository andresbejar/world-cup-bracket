"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MatchCard } from "./match-card";
import { BracketTreeSidebar } from "./bracket-tree-sidebar";
import type {
  HydratedMatch,
  HydratedPrediction,
  HydratedRound,
  HydratedTeam,
} from "@/lib/group-data";

const SAVE_DEBOUNCE_MS = 500;

interface Props {
  rounds: HydratedRound[];
  groupTeams: HydratedTeam[];
  groupMatches: HydratedMatch[];
  initialPredictions: HydratedPrediction[];
}

interface Score {
  home: number;
  away: number;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function PredictionsClient({
  rounds,
  groupTeams,
  groupMatches,
  initialPredictions,
}: Props) {
  const groupRounds = rounds.filter((r) => r.stage === "group");
  const knockoutRounds = rounds.filter((r) => r.stage !== "group");

  const [activeRoundId, setActiveRoundId] = useState<string>(
    groupRounds[0]?.id ?? rounds[0]?.id ?? "",
  );

  // Single source of truth for all 72 group predictions, keyed by match_id.
  const [predictions, setPredictions] = useState<Map<string, Score>>(() => {
    const m = new Map<string, Score>();
    for (const p of initialPredictions) {
      m.set(p.match_id, {
        home: p.predicted_home_score,
        away: p.predicted_away_score,
      });
    }
    return m;
  });
  const [saveStatus, setSaveStatus] = useState<Map<string, SaveStatus>>(
    new Map(),
  );

  // One pending-save timer per match — a fast typist editing two scores
  // back-to-back shouldn't fire the first save.
  const pendingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  useEffect(() => {
    return () => {
      for (const t of pendingTimers.current.values()) clearTimeout(t);
      pendingTimers.current.clear();
    };
  }, []);

  const flushSave = useCallback(
    async (matchId: string, score: Score) => {
      setSaveStatus((s) => new Map(s).set(matchId, "saving"));
      try {
        const res = await fetch("/api/predictions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            match_id: matchId,
            predicted_home_score: score.home,
            predicted_away_score: score.away,
          }),
        });
        if (!res.ok) throw new Error(`save failed ${res.status}`);
        setSaveStatus((s) => new Map(s).set(matchId, "saved"));
      } catch (e) {
        console.error("[predictions] save failed", e);
        setSaveStatus((s) => new Map(s).set(matchId, "error"));
      }
    },
    [],
  );

  const handleScoreChange = useCallback(
    (matchId: string, home: number, away: number) => {
      setPredictions((prev) => {
        const next = new Map(prev);
        next.set(matchId, { home, away });
        return next;
      });
      const existing = pendingTimers.current.get(matchId);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        flushSave(matchId, { home, away });
        pendingTimers.current.delete(matchId);
      }, SAVE_DEBOUNCE_MS);
      pendingTimers.current.set(matchId, timer);
    },
    [flushSave],
  );

  const matchesByRound = useMemo(() => {
    const m = new Map<string, HydratedMatch[]>();
    for (const match of groupMatches) {
      const arr = m.get(match.round_id) ?? [];
      arr.push(match);
      m.set(match.round_id, arr);
    }
    return m;
  }, [groupMatches]);

  const activeMatches = matchesByRound.get(activeRoundId) ?? [];
  const activeRound = rounds.find((r) => r.id === activeRoundId);
  const isKnockoutRound = activeRound?.stage !== "group";
  const filledInActiveRound = activeMatches.filter((m) =>
    predictions.has(m.id),
  ).length;

  return (
    <div className="min-h-[100svh]">
      <main className="mx-auto max-w-[1440px] px-4 pb-24 pt-8 md:px-8">
        <RoundSelector
          rounds={rounds}
          activeId={activeRoundId}
          onChange={setActiveRoundId}
        />

        <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-[60fr_40fr] md:gap-12">
          <section aria-label="Active round predictions">
            <SectionHeading
              eyebrow={
                activeRound
                  ? `${activeRound.stage === "group" ? "GROUP STAGE" : activeRound.stage.toUpperCase()} · ACTIVE ROUND`
                  : "ACTIVE ROUND"
              }
              title={activeRound?.name ?? "Round"}
              meta={meta(activeRound, filledInActiveRound, activeMatches.length)}
            />

            {isKnockoutRound ? (
              <p className="mt-6 rounded-md border border-border bg-surface p-6 font-mono text-xs uppercase tracking-[0.06em] text-text-muted">
                Knockout-round prediction UI ships in APT-20. Pick your group
                scores first — they cascade into this round&rsquo;s slots in
                the bracket on the right.
              </p>
            ) : (
              <div className="mt-6 space-y-3">
                {groupedByGroup(activeMatches).map(({ group, items }) => (
                  <div key={group}>
                    <p className="mb-2 mt-4 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted first:mt-0">
                      Group {group}
                    </p>
                    <div className="space-y-2">
                      {items.map((match, idx) => {
                        const score = predictions.get(match.id);
                        return (
                          <MatchCard
                            key={match.id}
                            match={match}
                            matchIndex={idx + 1}
                            homeScore={score?.home ?? null}
                            awayScore={score?.away ?? null}
                            saveStatus={saveStatus.get(match.id) ?? "idle"}
                            onChange={(h, a) =>
                              handleScoreChange(match.id, h, a)
                            }
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <aside
            aria-label="Bracket tree"
            className="md:sticky md:top-8 md:self-start"
          >
            <BracketTreeSidebar
              groupTeams={groupTeams}
              groupMatches={groupMatches}
              predictions={predictions}
            />
          </aside>
        </div>
      </main>
    </div>
  );
}

function RoundSelector({
  rounds,
  activeId,
  onChange,
}: {
  rounds: HydratedRound[];
  activeId: string;
  onChange: (id: string) => void;
}) {
  return (
    <nav
      aria-label="Tournament rounds"
      className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0"
    >
      <ul className="flex min-w-max items-center gap-2">
        {rounds.map((r) => {
          const active = r.id === activeId;
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onChange(r.id)}
                aria-current={active ? "page" : undefined}
                className={
                  "group flex flex-col items-start gap-0.5 rounded-full border px-4 py-2 transition-colors duration-[var(--motion-micro)] " +
                  (active
                    ? "border-transparent bg-accent text-bg"
                    : "border-border bg-surface text-text-muted hover:text-text-primary")
                }
              >
                <span className="font-mono text-xs font-bold uppercase tracking-[0.08em]">
                  {pillLabel(r)}
                </span>
                <span
                  className={
                    "font-mono text-[10px] uppercase tracking-[0.06em] " +
                    (active ? "text-bg/70" : "text-text-dim")
                  }
                >
                  {pillNote(r)}
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
      <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted whitespace-nowrap">
        {meta}
      </p>
    </div>
  );
}

function pillLabel(r: HydratedRound): string {
  if (r.stage === "group") return `M${r.matchday}`;
  if (r.stage === "third_place") return "3RD";
  return r.stage.toUpperCase();
}

function pillNote(r: HydratedRound): string {
  const d = new Date(r.deadline_at);
  return d
    .toLocaleString(undefined, { month: "short", day: "numeric" })
    .toUpperCase();
}

function meta(
  round: HydratedRound | undefined,
  filled: number,
  total: number,
): string {
  if (!round) return "";
  if (round.stage === "group") {
    return `${filled.toString().padStart(2, "0")}/${total.toString().padStart(2, "0")} PICKED`;
  }
  return formatCountdown(round.deadline_at);
}

function formatCountdown(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "LOCKED";
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  return `LOCKS IN ${days}D ${hours.toString().padStart(2, "0")}H`;
}

function groupedByGroup(
  matches: HydratedMatch[],
): { group: string; items: HydratedMatch[] }[] {
  const map = new Map<string, HydratedMatch[]>();
  for (const m of matches) {
    const arr = map.get(m.home.group_letter) ?? [];
    arr.push(m);
    map.set(m.home.group_letter, arr);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, items]) => ({ group, items }));
}
