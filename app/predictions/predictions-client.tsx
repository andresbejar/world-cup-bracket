"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { MatchCard } from "./match-card";
import { KnockoutCard } from "./knockout-card";
import { BracketSidebar } from "./bracket-sidebar";
import { ThirdPlaceCluster } from "./third-place-cluster";
import {
  FinalistPicks,
  type FinalistPicksState,
} from "./finalist-picks";
import {
  computeGroupStandings,
  computeKnockoutCascade,
  GROUP_LETTERS,
  populateR32Slots,
  THIRD_PLACE_SLOT_LABELS,
  type GroupStandings,
  type KnockoutMatchPrediction,
  type KnockoutRoundId,
  type MatchScore,
  type Team,
  type ThirdPlacePick,
} from "@/lib/bracket";
import type {
  HydratedFinalistPicks,
  HydratedKnockoutMatch,
  HydratedMatch,
  HydratedPrediction,
  HydratedRound,
  HydratedTeam,
  HydratedThirdPlacePick,
} from "@/lib/group-data";

const SAVE_DEBOUNCE_MS = 500;

interface Props {
  rounds: HydratedRound[];
  groupTeams: HydratedTeam[];
  groupMatches: HydratedMatch[];
  knockoutMatches: HydratedKnockoutMatch[];
  initialPredictions: HydratedPrediction[];
  initialThirdPlacePicks: HydratedThirdPlacePick[];
  initialFinalistPicks: HydratedFinalistPicks;
  slotLabelById: Record<string, string>;
  realTeamIdBySlotLabel: Record<string, string>;
}

interface PredictionState {
  home: number;
  away: number;
  /** Knockout matches only: which slot id (home_slot_id or away_slot_id) advances. */
  winner: string | null;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function PredictionsClient({
  rounds,
  groupTeams,
  groupMatches,
  knockoutMatches,
  initialPredictions,
  initialThirdPlacePicks,
  initialFinalistPicks,
  slotLabelById,
  realTeamIdBySlotLabel,
}: Props) {
  const [activeRoundId, setActiveRoundId] = useState<string>(
    rounds.find((r) => r.stage === "group")?.id ?? rounds[0]?.id ?? "",
  );

  // Single source of truth for every prediction (group + knockout), keyed by match_id.
  const [predictions, setPredictions] = useState<Map<string, PredictionState>>(
    () => {
      const m = new Map<string, PredictionState>();
      for (const p of initialPredictions) {
        m.set(p.match_id, {
          home: p.predicted_home_score,
          away: p.predicted_away_score,
          winner: p.predicted_winning_slot_id,
        });
      }
      return m;
    },
  );
  const [saveStatus, setSaveStatus] = useState<Map<string, SaveStatus>>(
    new Map(),
  );

  // Third-place picks: slot_id → predicted team_id. Saved separately via
  // /api/third-place-assignments (different schema + different RLS check).
  const [thirdPlacePicks, setThirdPlacePicks] = useState<Map<string, string>>(
    () => {
      const m = new Map<string, string>();
      for (const p of initialThirdPlacePicks) {
        m.set(p.slot_id, p.predicted_team_id);
      }
      return m;
    },
  );
  const [thirdPlaceSaveStatus, setThirdPlaceSaveStatus] = useState<
    Map<string, SaveStatus>
  >(new Map());

  // Tournament-wide podium bet (independent of bracket cascade).
  const [finalistPicks, setFinalistPicks] = useState<FinalistPicksState>(
    initialFinalistPicks,
  );
  const [finalistSaveStatus, setFinalistSaveStatus] =
    useState<SaveStatus>("idle");

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
    async (matchId: string, state: PredictionState) => {
      setSaveStatus((s) => new Map(s).set(matchId, "saving"));
      try {
        const res = await fetch("/api/predictions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            match_id: matchId,
            predicted_home_score: state.home,
            predicted_away_score: state.away,
            predicted_winning_slot_id: state.winner,
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

  const flushThirdPlaceSave = useCallback(
    async (slot_id: string, team_id: string | null) => {
      setThirdPlaceSaveStatus((s) => new Map(s).set(slot_id, "saving"));
      try {
        const res = await fetch("/api/third-place-assignments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slot_id, team_id }),
        });
        if (!res.ok) throw new Error(`save failed ${res.status}`);
        setThirdPlaceSaveStatus((s) => new Map(s).set(slot_id, "saved"));
      } catch (e) {
        console.error("[third-place] save failed", e);
        setThirdPlaceSaveStatus((s) => new Map(s).set(slot_id, "error"));
      }
    },
    [],
  );

  const flushFinalistSave = useCallback(
    async (next: FinalistPicksState) => {
      setFinalistSaveStatus("saving");
      try {
        const res = await fetch("/api/finalist-picks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
        if (!res.ok) throw new Error(`save failed ${res.status}`);
        setFinalistSaveStatus("saved");
      } catch (e) {
        console.error("[finalist-picks] save failed", e);
        setFinalistSaveStatus("error");
      }
    },
    [],
  );

  const writeFinalistPicks = useCallback(
    (next: FinalistPicksState) => {
      setFinalistPicks(next);
      const key = "finalist:row";
      const existing = pendingTimers.current.get(key);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        flushFinalistSave(next);
        pendingTimers.current.delete(key);
      }, SAVE_DEBOUNCE_MS);
      pendingTimers.current.set(key, timer);
    },
    [flushFinalistSave],
  );

  const writeThirdPlacePick = useCallback(
    (slot_id: string, team_id: string | null) => {
      setThirdPlacePicks((prev) => {
        const next = new Map(prev);
        if (team_id == null) next.delete(slot_id);
        else next.set(slot_id, team_id);
        return next;
      });
      const key = `third:${slot_id}`;
      const existing = pendingTimers.current.get(key);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        flushThirdPlaceSave(slot_id, team_id);
        pendingTimers.current.delete(key);
      }, SAVE_DEBOUNCE_MS);
      pendingTimers.current.set(key, timer);
    },
    [flushThirdPlaceSave],
  );

  const writePrediction = useCallback(
    (matchId: string, next: PredictionState) => {
      setPredictions((prev) => {
        const m = new Map(prev);
        m.set(matchId, next);
        return m;
      });
      const existing = pendingTimers.current.get(matchId);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        flushSave(matchId, next);
        pendingTimers.current.delete(matchId);
      }, SAVE_DEBOUNCE_MS);
      pendingTimers.current.set(matchId, timer);
    },
    [flushSave],
  );

  // Group cascade — computeGroupStandings × 12.
  //
  // Reality merge: for each group match, prefer the real 90+ET score when
  // status==='finished' (cron-populated from api-football); fall back to
  // the user's predicted score otherwise. As matches finish IRL, the
  // standings table morphs from "your prediction" to reality without the
  // user touching their picks. Pure swap — the slot-ID premise from the
  // design doc means downstream cascade still works either way.
  const standingsByGroup = useMemo<GroupStandings[]>(() => {
    const scoresByGroup = new Map<string, MatchScore[]>();
    for (const letter of GROUP_LETTERS) scoresByGroup.set(letter, []);
    for (const m of groupMatches) {
      const bucket = scoresByGroup.get(m.home.group_letter);
      if (!bucket) continue;
      const useReal =
        m.status === "finished" &&
        m.home_score != null &&
        m.away_score != null;
      if (useReal) {
        bucket.push({
          home_team_id: m.home.id,
          away_team_id: m.away.id,
          home_score: m.home_score!,
          away_score: m.away_score!,
        });
        continue;
      }
      const pred = predictions.get(m.id);
      if (!pred) continue;
      bucket.push({
        home_team_id: m.home.id,
        away_team_id: m.away.id,
        home_score: pred.home,
        away_score: pred.away,
      });
    }
    const teamsByGroup = new Map<string, Team[]>();
    for (const letter of GROUP_LETTERS) teamsByGroup.set(letter, []);
    for (const t of groupTeams) {
      teamsByGroup.get(t.group_letter)?.push({
        id: t.id,
        group_letter: t.group_letter,
      });
    }
    const result: GroupStandings[] = [];
    for (const letter of GROUP_LETTERS) {
      const teams = teamsByGroup.get(letter) ?? [];
      const scores = scoresByGroup.get(letter) ?? [];
      result.push({
        group_letter: letter,
        standings: computeGroupStandings(scores, teams),
      });
    }
    return result;
  }, [groupTeams, groupMatches, predictions]);

  // Per-group reality indicator for the standings sidebar: how many of
  // each group's 3 matches have finished. Drives the "REAL / PREDICTED"
  // pill under each group header.
  const realMatchCountByGroup = useMemo<Record<string, number>>(() => {
    const counts: Record<string, number> = {};
    for (const letter of GROUP_LETTERS) counts[letter] = 0;
    for (const m of groupMatches) {
      if (m.status === "finished") counts[m.home.group_letter] += 1;
    }
    return counts;
  }, [groupMatches]);

  // Resolve the 8 best-3rd slot_labels into the bracket_slot.ids the
  // user's third-place picks reference. The cluster UI uses these IDs;
  // the cascade just needs the slot_label → team_id pairs.
  const bestThirdSlots = useMemo<
    Array<{ slot_id: string; slot_label: string }>
  >(() => {
    const reverse: Record<string, string> = {};
    for (const [id, label] of Object.entries(slotLabelById)) {
      reverse[label] = id;
    }
    return THIRD_PLACE_SLOT_LABELS.map((label) => ({
      slot_label: label,
      slot_id: reverse[label] ?? "",
    }));
  }, [slotLabelById]);

  // The 12 teams the user's group predictions ranked 3rd (one per group).
  const predictedThirds = useMemo<HydratedTeam[]>(() => {
    const teamById = new Map(groupTeams.map((t) => [t.id, t]));
    const result: HydratedTeam[] = [];
    for (const g of standingsByGroup) {
      const third = g.standings.find((s) => s.rank === 3);
      const team = third ? teamById.get(third.team_id) : null;
      if (team) result.push(team);
    }
    return result;
  }, [standingsByGroup, groupTeams]);

  // Convert the cluster's slot_id-keyed picks into the slot_label-keyed
  // ThirdPlacePick[] shape that populateR32Slots wants. Picks where the
  // user hasn't chosen a team pass through as team_id: null.
  const thirdPlacePickList = useMemo<ThirdPlacePick[]>(() => {
    return bestThirdSlots.map(({ slot_id, slot_label }) => ({
      slot_label,
      team_id: thirdPlacePicks.get(slot_id) ?? null,
    }));
  }, [bestThirdSlots, thirdPlacePicks]);

  // Track whether every group-stage match has been predicted. The
  // third-place cluster is locked until this is true so the user's
  // predicted-thirds set has fully stabilized.
  const groupPredictionsComplete = useMemo(() => {
    if (groupMatches.length === 0) return false;
    return groupMatches.every((m) => predictions.has(m.id));
  }, [groupMatches, predictions]);

  // R32 → Final cascade. Best-3rd picks now feed in via thirdPlacePickList.
  //
  // Two parallel cascades are built here:
  //   - predictedSlotMap: pure prediction tree. Used to compute the
  //     "you predicted: X" annotation when reality replaces a team.
  //   - slotMap: predicted cascade with R32 input team_ids overridden
  //     by `bracket_slots.real_team_id` when present. This is what every
  //     downstream card displays.
  // Slot-ID premise: the user's "which slot advances" choice survives
  // reality replacement — the slot still points at the same downstream
  // node, just with the actual team behind it.
  const knockoutPreds = useMemo<KnockoutMatchPrediction[]>(() => {
    const out: KnockoutMatchPrediction[] = [];
    for (const m of knockoutMatches) {
      const state = predictions.get(m.id);
      const winner_label =
        state?.winner != null ? slotLabelById[state.winner] ?? null : null;
      out.push({
        round_id: m.round_id as KnockoutRoundId,
        match_index: m.match_index,
        home_slot_label: m.home_slot_label,
        away_slot_label: m.away_slot_label,
        predicted_winner_label: winner_label,
      });
    }
    return out;
  }, [knockoutMatches, predictions, slotLabelById]);

  const predictedSlotMap = useMemo<Map<string, string | null>>(() => {
    let r32Slots;
    try {
      r32Slots = populateR32Slots(standingsByGroup, thirdPlacePickList);
    } catch (e) {
      console.error("[predictions] populateR32Slots failed:", e);
      r32Slots = populateR32Slots(standingsByGroup, []);
    }
    return computeKnockoutCascade(r32Slots, knockoutPreds);
  }, [standingsByGroup, thirdPlacePickList, knockoutPreds]);

  const slotMap = useMemo<Map<string, string | null>>(() => {
    let r32Slots;
    try {
      r32Slots = populateR32Slots(standingsByGroup, thirdPlacePickList);
    } catch (e) {
      console.error("[predictions] populateR32Slots failed:", e);
      r32Slots = populateR32Slots(standingsByGroup, []);
    }
    // Override R32 input slot team_ids with reality when present. The
    // cascade walks downstream from these, so reality propagates into
    // R16+ via the user's slot-advancement picks.
    const realOverridden = r32Slots.map((s) => {
      const real = realTeamIdBySlotLabel[s.slot_label];
      return real ? { ...s, team_id: real } : s;
    });
    return computeKnockoutCascade(realOverridden, knockoutPreds);
  }, [
    standingsByGroup,
    thirdPlacePickList,
    knockoutPreds,
    realTeamIdBySlotLabel,
  ]);

  const teamCodeById = useMemo(
    () => new Map(groupTeams.map((t) => [t.id, t.code])),
    [groupTeams],
  );
  const teamNameById = useMemo(
    () => new Map(groupTeams.map((t) => [t.id, t.name])),
    [groupTeams],
  );

  // Resolve a slot_label → team code / name through the cascade + team registry.
  const teamCodeAtLabel = useCallback(
    (label: string): string | null => {
      const teamId = slotMap.get(label);
      if (!teamId) return null;
      return teamCodeById.get(teamId) ?? teamId;
    },
    [slotMap, teamCodeById],
  );
  const teamNameAtLabel = useCallback(
    (label: string): string | null => {
      const teamId = slotMap.get(label);
      if (!teamId) return null;
      return teamNameById.get(teamId) ?? null;
    },
    [slotMap, teamNameById],
  );

  // For "you predicted: X" annotation: return the user-predicted code at
  // a slot when (a) reality has overridden the cascade for that slot AND
  // (b) the predicted team differs from the real one. Returns null when
  // there's nothing meaningful to annotate.
  const predictedCodeIfDiffers = useCallback(
    (label: string): string | null => {
      const realId = slotMap.get(label);
      const predId = predictedSlotMap.get(label);
      if (!realId || !predId) return null;
      if (realId === predId) return null;
      return teamCodeById.get(predId) ?? predId;
    },
    [slotMap, predictedSlotMap, teamCodeById],
  );

  const groupMatchesByRound = useMemo(() => {
    const m = new Map<string, HydratedMatch[]>();
    for (const match of groupMatches) {
      const arr = m.get(match.round_id) ?? [];
      arr.push(match);
      m.set(match.round_id, arr);
    }
    return m;
  }, [groupMatches]);

  const knockoutMatchesByRound = useMemo(() => {
    const m = new Map<string, HydratedKnockoutMatch[]>();
    for (const match of knockoutMatches) {
      const arr = m.get(match.round_id) ?? [];
      arr.push(match);
      m.set(match.round_id, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => a.match_index - b.match_index);
    }
    return m;
  }, [knockoutMatches]);

  const activeRound = rounds.find((r) => r.id === activeRoundId);
  const isKnockoutRound = activeRound?.stage !== "group";

  const activeGroupMatches = groupMatchesByRound.get(activeRoundId) ?? [];
  const activeKnockoutMatches = knockoutMatchesByRound.get(activeRoundId) ?? [];

  const filledInActiveRound = isKnockoutRound
    ? activeKnockoutMatches.filter((m) => {
        const s = predictions.get(m.id);
        return s != null && s.winner != null;
      }).length
    : activeGroupMatches.filter((m) => predictions.has(m.id)).length;
  const totalInActiveRound = isKnockoutRound
    ? activeKnockoutMatches.length
    : activeGroupMatches.length;

  return (
    <div className="min-h-[100svh]">
      <main className="mx-auto max-w-[1440px] px-4 pb-24 pt-8 md:px-8">
        <RoundSelector
          rounds={rounds}
          activeId={activeRoundId}
          onChange={setActiveRoundId}
        />

        <div className="mt-8 grid grid-cols-1 gap-8 xl:grid-cols-[60fr_40fr] xl:gap-12">
          <section aria-label="Active round predictions">
            <SectionHeading
              eyebrow={
                activeRound
                  ? `${activeRound.stage === "group" ? "GROUP STAGE" : activeRound.stage.toUpperCase().replace("_", " ")} · ACTIVE ROUND`
                  : "ACTIVE ROUND"
              }
              title={activeRound?.name ?? "Round"}
              meta={meta(activeRound, filledInActiveRound, totalInActiveRound)}
            />

            {isKnockoutRound ? (
              <div className="mt-6">
                {activeRound?.stage === "r32" ? (
                  <ThirdPlaceCluster
                    slots={bestThirdSlots}
                    predictedThirds={predictedThirds}
                    picks={thirdPlacePicks}
                    saveStatus={thirdPlaceSaveStatus}
                    groupPredictionsComplete={groupPredictionsComplete}
                    realTeamIdBySlotLabel={realTeamIdBySlotLabel}
                    teamCodeById={teamCodeById}
                    teamNameById={teamNameById}
                    onChange={writeThirdPlacePick}
                  />
                ) : null}
                <div className="space-y-2">
                  {activeKnockoutMatches.map((match) => {
                    const state = predictions.get(match.id);
                    return (
                      <KnockoutCard
                        key={match.id}
                        match={match}
                        homeTeam={teamCodeAtLabel(match.home_slot_label)}
                        awayTeam={teamCodeAtLabel(match.away_slot_label)}
                        homeName={teamNameAtLabel(match.home_slot_label)}
                        awayName={teamNameAtLabel(match.away_slot_label)}
                        homePredictedCode={predictedCodeIfDiffers(
                          match.home_slot_label,
                        )}
                        awayPredictedCode={predictedCodeIfDiffers(
                          match.away_slot_label,
                        )}
                        homeScore={state?.home ?? null}
                        awayScore={state?.away ?? null}
                        predictedWinnerSlotId={state?.winner ?? null}
                        saveStatus={saveStatus.get(match.id) ?? "idle"}
                        onChange={(home, away, winner) =>
                          writePrediction(match.id, { home, away, winner })
                        }
                      />
                    );
                  })}
                  {activeKnockoutMatches.length === 0 ? (
                    <p className="rounded-md border border-border bg-surface p-6 font-mono text-xs uppercase tracking-[0.06em] text-text-dim">
                      No matches in this round yet.
                    </p>
                  ) : null}
                </div>
                {activeRound?.stage === "final" ? (
                  <FinalistPicks
                    teams={groupTeams}
                    picks={finalistPicks}
                    saveStatus={finalistSaveStatus}
                    onChange={writeFinalistPicks}
                  />
                ) : null}
              </div>
            ) : (
              <div className="mt-6 space-y-3">
                {groupedByGroup(activeGroupMatches).map(({ group, items }) => (
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
                              writePrediction(match.id, {
                                home: h,
                                away: a,
                                winner: null,
                              })
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
            className="xl:sticky xl:top-8 xl:self-start"
          >
            <BracketSidebar
              standingsByGroup={standingsByGroup}
              realMatchCountByGroup={realMatchCountByGroup}
              slotMap={slotMap}
              teamCodeById={teamCodeById}
              activeRound={activeRound}
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
  meta: ReactNode;
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
      <div className="whitespace-nowrap text-right font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
        {meta}
      </div>
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
): ReactNode {
  if (!round) return null;
  const countdown = formatCountdown(round.deadline_at);
  const counter =
    total > 0
      ? `${filled.toString().padStart(2, "0")}/${total.toString().padStart(2, "0")} PICKED`
      : null;
  if (!counter) return countdown;
  return (
    <>
      <span className="block">{countdown}</span>
      <span className="mt-1 block text-text-dim">{counter}</span>
    </>
  );
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
