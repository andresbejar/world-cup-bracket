"use client";

import {
  Suspense,
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
import { ThirdPlaceCluster, type ThirdPlaceRow } from "./third-place-cluster";
import { PredictedVsRealCard } from "./predicted-vs-real-card";
import { PodiumBanner } from "./podium-banner";
import { OtherPicksButton } from "./other-picks-modal";
import {
  FinalistPicks,
  type FinalistPicksState,
} from "./finalist-picks";
import {
  computeGroupStandings,
  computeKnockoutCascade,
  computeMatchPoints,
  deriveBestThirdGroups,
  GROUP_LETTERS,
  populateR32Slots,
  THIRD_PLACE_WINNER_GROUPS,
  type ActualMatch,
  type GroupLetter,
  type GroupStandings,
  type KnockoutMatchPrediction,
  type KnockoutRoundId,
  type MatchPrediction,
  type MatchScore,
  type Team,
} from "@/lib/bracket";
import { hasMatchStarted, hasRealResult } from "@/lib/match-display";
import { checkMatchLock } from "@/lib/lock-check";
import type {
  HydratedFinalistPicks,
  HydratedKnockoutMatch,
  HydratedMatch,
  HydratedPrediction,
  HydratedRound,
  HydratedTeam,
} from "@/lib/group-data";

const SAVE_DEBOUNCE_MS = 500;

// Run computeGroupStandings for all 12 groups given a per-group score map.
// Shared by the blended, predicted-only, and real-only standings memos.
function buildStandings(
  scoresByGroup: ReadonlyMap<string, MatchScore[]>,
  groupTeams: readonly HydratedTeam[],
): GroupStandings[] {
  const teamsByGroup = new Map<string, Team[]>();
  for (const letter of GROUP_LETTERS) teamsByGroup.set(letter, []);
  for (const t of groupTeams) {
    teamsByGroup.get(t.group_letter)?.push({
      id: t.id,
      group_letter: t.group_letter,
    });
  }
  return GROUP_LETTERS.map((letter) => ({
    group_letter: letter,
    standings: computeGroupStandings(
      scoresByGroup.get(letter) ?? [],
      teamsByGroup.get(letter) ?? [],
    ),
  }));
}

// Bucket group-match scores by group_letter, sourcing each match's score via a
// caller-supplied selector (real-only, predicted-only, or blended). Matches the
// selector returns null for are skipped — that's what produces partial real
// standings before all matches are played. Feeds buildStandings.
function fillScoresByGroup(
  groupMatches: readonly HydratedMatch[],
  selectScore: (m: HydratedMatch) => { home: number; away: number } | null,
): Map<string, MatchScore[]> {
  const scoresByGroup = new Map<string, MatchScore[]>();
  for (const letter of GROUP_LETTERS) scoresByGroup.set(letter, []);
  for (const m of groupMatches) {
    const bucket = scoresByGroup.get(m.home.group_letter);
    if (!bucket) continue;
    const score = selectScore(m);
    if (!score) continue;
    bucket.push({
      home_team_id: m.home.id,
      away_team_id: m.away.id,
      home_score: score.home,
      away_score: score.away,
    });
  }
  return scoresByGroup;
}

// The real 90'+ET score for a finished group match, or null if it hasn't been
// played (or scores aren't populated yet). hasRealResult guards against
// phantom future-dated finishes.
function realScore(m: HydratedMatch): { home: number; away: number } | null {
  if (!hasRealResult(m) || m.home_score == null || m.away_score == null) {
    return null;
  }
  return { home: m.home_score, away: m.away_score };
}

interface Props {
  rounds: HydratedRound[];
  groupTeams: HydratedTeam[];
  groupMatches: HydratedMatch[];
  knockoutMatches: HydratedKnockoutMatch[];
  initialPredictions: HydratedPrediction[];
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

  // Knockout variant: a tied score with no penalty-winner pick is not yet
  // a valid prediction — the API rejects it (validateKnockoutPrediction),
  // which used to flash a spurious "retry". Update local state so the
  // penalty picker appears, but hold the save until the pick lands (the
  // card re-fires onChange with the winner set).
  const writeKnockoutPrediction = useCallback(
    (matchId: string, next: PredictionState) => {
      const awaitingPenaltyPick =
        next.home === next.away && next.winner == null;
      if (!awaitingPenaltyPick) {
        writePrediction(matchId, next);
        return;
      }
      setPredictions((prev) => {
        const m = new Map(prev);
        m.set(matchId, next);
        return m;
      });
      const existing = pendingTimers.current.get(matchId);
      if (existing) {
        clearTimeout(existing);
        pendingTimers.current.delete(matchId);
      }
    },
    [writePrediction],
  );

  // Group cascade — computeGroupStandings × 12.
  //
  // Reality merge: for each group match, prefer the real 90+ET score when
  // status==='finished' (cron-populated from api-football); fall back to
  // the user's predicted score otherwise. As matches finish IRL, the
  // standings table morphs from "your prediction" to reality without the
  // user touching their picks. Pure swap — the slot-ID premise from the
  // design doc means downstream cascade still works either way.
  const predictedScore = useCallback(
    (m: HydratedMatch): { home: number; away: number } | null => {
      const pred = predictions.get(m.id);
      return pred ? { home: pred.home, away: pred.away } : null;
    },
    [predictions],
  );

  const standingsByGroup = useMemo<GroupStandings[]>(
    () =>
      buildStandings(
        fillScoresByGroup(groupMatches, (m) => realScore(m) ?? predictedScore(m)),
        groupTeams,
      ),
    [groupTeams, groupMatches, predictedScore],
  );

  // APT-61 — pure view variants for the sidebar predicted/real toggle.
  // standingsByGroup (above) stays *blended* (real where finished, else
  // predicted) and still feeds thirdPlaceRows + the editing column. These
  // two are display-only: one ignores reality entirely, the other ignores
  // predictions entirely.
  const standingsByGroupPredicted = useMemo<GroupStandings[]>(
    () => buildStandings(fillScoresByGroup(groupMatches, predictedScore), groupTeams),
    [groupTeams, groupMatches, predictedScore],
  );

  const standingsByGroupReal = useMemo<GroupStandings[]>(
    () => buildStandings(fillScoresByGroup(groupMatches, realScore), groupTeams),
    [groupTeams, groupMatches],
  );

  // Per-group reality indicator for the standings sidebar: how many of
  // each group's 3 matches have finished. Drives the "REAL / PREDICTED"
  // pill under each group header.
  const realMatchCountByGroup = useMemo<Record<string, number>>(() => {
    const counts: Record<string, number> = {};
    for (const letter of GROUP_LETTERS) counts[letter] = 0;
    for (const m of groupMatches) {
      if (hasRealResult(m)) counts[m.home.group_letter] += 1;
    }
    return counts;
  }, [groupMatches]);

  // The 12 teams the user's group predictions ranked 3rd, one per group,
  // sorted by FIFA's first 3 tiebreakers (points → GD → GS, descending).
  // Display-only ordering for the selector + its "below the cutoff" line.
  const thirdPlaceRows = useMemo<ThirdPlaceRow[]>(() => {
    const teamById = new Map(groupTeams.map((t) => [t.id, t]));
    const rows: ThirdPlaceRow[] = [];
    for (const g of standingsByGroup) {
      const third = g.standings.find((s) => s.rank === 3);
      const team = third ? teamById.get(third.team_id) : null;
      if (!third || !team) continue;
      rows.push({
        group_letter: g.group_letter,
        team,
        points: third.points,
        goal_difference: third.goal_difference,
        goals_for: third.goals_for,
      });
    }
    rows.sort(
      (a, b) =>
        b.points - a.points ||
        b.goal_difference - a.goal_difference ||
        b.goals_for - a.goals_for,
    );
    return rows;
  }, [standingsByGroup, groupTeams]);

  // Auto-derived qualifying set: the 8 groups whose 3rd-placed team ranks
  // highest (points → GD → goals for). Replaces the retired manual pick, so
  // there's nothing for a user to copy from reality. Blended (real where a
  // match has finished, else predicted) feeds the main cascade; a pure-
  // predicted variant feeds the predicted-only sidebar view so it stays
  // consistent with its own standings. derivedQualifyingGroups (blended)
  // drives the read-only cluster highlight.
  const qualifyingGroupsArray = useMemo<GroupLetter[]>(
    () => deriveBestThirdGroups(standingsByGroup).groups,
    [standingsByGroup],
  );
  const qualifyingGroupsArrayPredicted = useMemo<GroupLetter[]>(
    () => deriveBestThirdGroups(standingsByGroupPredicted).groups,
    [standingsByGroupPredicted],
  );
  const derivedQualifyingGroups = useMemo<Set<string>>(
    () => new Set(qualifyingGroupsArray),
    [qualifyingGroupsArray],
  );

  // FIFA's real 8 qualifying 3rd-placed team_ids, read off the settled
  // "best-3rd-vs-{winner}" slots. Null until all 8 are populated — drives
  // the selector's results mode + correctness scoring.
  const realQualifyingThirdTeamIds = useMemo<Set<string> | null>(() => {
    const ids: string[] = [];
    for (const g of THIRD_PLACE_WINNER_GROUPS) {
      const id = realTeamIdBySlotLabel[`best-3rd-vs-${g}`];
      if (id) ids.push(id);
    }
    return ids.length === THIRD_PLACE_WINNER_GROUPS.length
      ? new Set(ids)
      : null;
  }, [realTeamIdBySlotLabel]);

  // Track whether every group-stage match has been predicted. The
  // third-place cluster is locked until this is true so the user's
  // predicted-thirds set has fully stabilized.
  const groupPredictionsComplete = useMemo(() => {
    if (groupMatches.length === 0) return false;
    return groupMatches.every((m) => predictions.has(m.id));
  }, [groupMatches, predictions]);

  // R32 → Final cascade. The qualifying set feeds Annex C inside
  // populateR32Slots to place the 8 third-placed teams.
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
      r32Slots = populateR32Slots(standingsByGroup, qualifyingGroupsArray);
    } catch (e) {
      console.error("[predictions] populateR32Slots failed:", e);
      r32Slots = populateR32Slots(standingsByGroup, []);
    }
    return computeKnockoutCascade(r32Slots, knockoutPreds);
  }, [standingsByGroup, qualifyingGroupsArray, knockoutPreds]);

  const slotMap = useMemo<Map<string, string | null>>(() => {
    let r32Slots;
    try {
      r32Slots = populateR32Slots(standingsByGroup, qualifyingGroupsArray);
    } catch (e) {
      console.error("[predictions] populateR32Slots failed:", e);
      r32Slots = populateR32Slots(standingsByGroup, []);
    }
    // Override R32 input slot team_ids with reality when present. The
    // cascade walks downstream from these via the user's predicted
    // winners, filling R16+ labels with the *predicted* advancer.
    const realOverridden = r32Slots.map((s) => {
      const real = realTeamIdBySlotLabel[s.slot_label];
      return real ? { ...s, team_id: real } : s;
    });
    const map = computeKnockoutCascade(realOverridden, knockoutPreds);
    // Then overlay reality onto any downstream slot label the cron has
    // already advanced (r32-match-N-winner, etc.), so a settled match's
    // "actual" matchup shows who really advanced — not the user's
    // predicted cascade. predictedSlotMap stays pure-prediction, so the
    // "you predicted X" annotation still compares correctly.
    for (const [label, teamId] of Object.entries(realTeamIdBySlotLabel)) {
      map.set(label, teamId);
    }
    return map;
  }, [
    standingsByGroup,
    qualifyingGroupsArray,
    knockoutPreds,
    realTeamIdBySlotLabel,
  ]);

  // APT-61 — pure view variants for the sidebar predicted/real toggle.
  //   - bracketSlotMapPredicted: the user's full bracket, R32 inputs from
  //     their *predicted* standings (not the blend) cascaded by their
  //     winner picks. No reality overlay.
  //   - bracketSlotMapReal: reality only — exactly the slots the cron has
  //     filled (real group results, FIFA best-thirds, real advancers).
  //     Unsettled labels are absent → the sidebar renders them as "—".
  const bracketSlotMapPredicted = useMemo<Map<string, string | null>>(() => {
    let r32Slots;
    try {
      r32Slots = populateR32Slots(
        standingsByGroupPredicted,
        qualifyingGroupsArrayPredicted,
      );
    } catch (e) {
      console.error("[predictions] populateR32Slots failed:", e);
      r32Slots = populateR32Slots(standingsByGroupPredicted, []);
    }
    return computeKnockoutCascade(r32Slots, knockoutPreds);
  }, [standingsByGroupPredicted, qualifyingGroupsArrayPredicted, knockoutPreds]);

  const bracketSlotMapReal = useMemo<Map<string, string | null>>(
    () => new Map(Object.entries(realTeamIdBySlotLabel)),
    [realTeamIdBySlotLabel],
  );

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

  // Podium = tournament-wide side bet. Surfaces as a virtual round at
  // the start of the round selector so users find it WAY before the
  // FINAL tab "feels active" — by which time these picks have been
  // locked for a month. Locks at first match kickoff, not at any
  // round's 4hr-pre-deadline.
  const finalistFilledCount =
    (finalistPicks.first_place_team_id ? 1 : 0) +
    (finalistPicks.second_place_team_id ? 1 : 0) +
    (finalistPicks.third_place_team_id ? 1 : 0);
  const firstKickoffAt = groupMatches[0]?.scheduled_at ?? null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const podiumLocked = firstKickoffAt
    ? now >= new Date(firstKickoffAt).getTime()
    : false;

  const isPodium = activeRoundId === "podium";
  const activeRound = isPodium
    ? undefined
    : rounds.find((r) => r.id === activeRoundId);
  const isKnockoutRound = !isPodium && activeRound?.stage !== "group";

  // Per-match lock — client-side mirror of the API's checkMatchLock
  // (lib/lock-check.ts is the shared pure helper, so semantics can't
  // drift). Each match freezes at its own kickoff; the round's admin
  // `locked_at` still hard-locks every match. The server stays
  // authoritative — an admin lock set after page load isn't visible here
  // until reload, and those writes still 403 → "retry".
  const isMatchLocked = useCallback(
    (kickoffAt: string) =>
      !checkMatchLock(
        { round_locked_at: activeRound?.locked_at ?? null, kickoff_at: kickoffAt },
        now,
      ).editable,
    [activeRound, now],
  );

  const activeGroupMatches = groupMatchesByRound.get(activeRoundId) ?? [];
  const activeKnockoutMatches = knockoutMatchesByRound.get(activeRoundId) ?? [];

  // Earliest still-open kickoff in the active round — the next match to
  // lock. Drives the round header countdown so it reads "NEXT LOCK IN …"
  // (or "ALL LOCKED") instead of a single round-wide deadline. Cheap to
  // recompute (≤16 matches), like activeGroupMatches above it.
  const nextLockAt: number | null = (() => {
    const matches = isKnockoutRound ? activeKnockoutMatches : activeGroupMatches;
    let min: number | null = null;
    for (const m of matches) {
      const t = new Date(m.scheduled_at).getTime();
      if (Number.isFinite(t) && t > now && (min == null || t < min)) min = t;
    }
    return min;
  })();

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
        {isPodium ? null : (
          <PodiumBanner
            filledCount={finalistFilledCount}
            totalCount={3}
            firstKickoffAt={firstKickoffAt}
            onJump={() => setActiveRoundId("podium")}
          />
        )}

        <RoundSelector
          rounds={rounds}
          activeId={activeRoundId}
          onChange={setActiveRoundId}
          podiumFilled={finalistFilledCount}
          podiumLocked={podiumLocked}
        />

        <div className="mt-8 grid grid-cols-1 gap-8 xl:grid-cols-[60fr_40fr] xl:gap-12">
          <section aria-label="Active round predictions">
            {isPodium ? (
              <SectionHeading
                eyebrow="TOURNAMENT-WIDE BET · LOCKS AT FIRST KICKOFF"
                title="Podium picks"
                meta={
                  <>
                    <span className="block">
                      {finalistFilledCount}/3 PICKED
                    </span>
                    {firstKickoffAt && !podiumLocked ? (
                      <span className="mt-1 block text-text-dim">
                        LOCKS {formatLockShort(firstKickoffAt)}
                      </span>
                    ) : null}
                    {podiumLocked ? (
                      <span className="mt-1 block text-text-dim">LOCKED</span>
                    ) : null}
                  </>
                }
              />
            ) : (
              <SectionHeading
                eyebrow={
                  activeRound
                    ? `${activeRound.stage === "group" ? "GROUP STAGE" : activeRound.stage.toUpperCase().replace("_", " ")} · ACTIVE ROUND`
                    : "ACTIVE ROUND"
                }
                title={activeRound?.name ?? "Round"}
                meta={meta(
                  activeRound,
                  filledInActiveRound,
                  totalInActiveRound,
                  nextLockAt,
                )}
              />
            )}

            {isPodium ? (
              <div className="mt-6">
                <FinalistPicks
                  teams={groupTeams}
                  picks={finalistPicks}
                  saveStatus={finalistSaveStatus}
                  locked={podiumLocked}
                  onChange={writeFinalistPicks}
                />
              </div>
            ) : isKnockoutRound ? (
              <div className="mt-6">
                {activeRound?.stage === "r32" ? (
                  <ThirdPlaceCluster
                    rows={thirdPlaceRows}
                    derived={derivedQualifyingGroups}
                    groupPredictionsComplete={groupPredictionsComplete}
                    realQualifyingThirdTeamIds={realQualifyingThirdTeamIds}
                  />
                ) : null}
                <div className="space-y-2">
                  {activeKnockoutMatches.map((match) => {
                    const state = predictions.get(match.id);
                    if (hasRealResult(match)) {
                      const homeCode =
                        teamCodeAtLabel(match.home_slot_label) ?? "—";
                      const awayCode =
                        teamCodeAtLabel(match.away_slot_label) ?? "—";
                      // Actual winner: authoritative, off the match row's
                      // winning_slot_id (the cron sets it from the
                      // regulation score OR the penalty shootout). A still-
                      // null winner (shootout not yet ingested) shows a dash.
                      const actualWinningSlotId = match.winning_slot_id;
                      const actualWinnerCode =
                        actualWinningSlotId === match.home_slot_id
                          ? homeCode
                          : actualWinningSlotId === match.away_slot_id
                            ? awayCode
                            : null;
                      const predictedWinnerCode = state?.winner
                        ? state.winner === match.home_slot_id
                          ? homeCode
                          : awayCode
                        : null;
                      return (
                        <PredictedVsRealCard
                          key={match.id}
                          meta={`${knockoutRoundLabel(match.round_id)} · M${match.match_index
                            .toString()
                            .padStart(2, "0")} · ${formatShort(match.scheduled_at)}`}
                          homeName={teamNameAtLabel(match.home_slot_label)}
                          awayName={teamNameAtLabel(match.away_slot_label)}
                          predicted={
                            state
                              ? {
                                  homeCode,
                                  awayCode,
                                  homeScore: state.home,
                                  awayScore: state.away,
                                  winnerCode: predictedWinnerCode,
                                }
                              : null
                          }
                          actual={{
                            homeCode,
                            awayCode,
                            homeScore: match.home_score,
                            awayScore: match.away_score,
                            winnerCode: actualWinnerCode,
                          }}
                          pointsAwarded={scoreKnockoutPoints(
                            match,
                            state,
                            actualWinningSlotId,
                          )}
                          footer={
                            <OtherPicksButton
                              matchId={match.id}
                              homeCode={homeCode}
                              awayCode={awayCode}
                              homeSlotId={match.home_slot_id}
                              awaySlotId={match.away_slot_id}
                            />
                          }
                        />
                      );
                    }
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
                        locked={isMatchLocked(match.scheduled_at)}
                        lockHint={formatLockHint(match.scheduled_at, now)}
                        footer={
                          hasMatchStarted(match, now) ? (
                            <OtherPicksButton
                              matchId={match.id}
                              homeCode={
                                teamCodeAtLabel(match.home_slot_label) ?? "—"
                              }
                              awayCode={
                                teamCodeAtLabel(match.away_slot_label) ?? "—"
                              }
                              homeSlotId={match.home_slot_id}
                              awaySlotId={match.away_slot_id}
                            />
                          ) : null
                        }
                        onChange={(home, away, winner) =>
                          writeKnockoutPrediction(match.id, {
                            home,
                            away,
                            winner,
                          })
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
                        if (hasRealResult(match)) {
                          return (
                            <PredictedVsRealCard
                              key={match.id}
                              meta={`GROUP ${group} · M${(idx + 1)
                                .toString()
                                .padStart(2, "0")} · ${formatShort(match.scheduled_at)}`}
                              homeName={match.home.name}
                              awayName={match.away.name}
                              predicted={
                                score
                                  ? {
                                      homeCode: match.home.code,
                                      awayCode: match.away.code,
                                      homeScore: score.home,
                                      awayScore: score.away,
                                      winnerCode: null,
                                    }
                                  : null
                              }
                              actual={{
                                homeCode: match.home.code,
                                awayCode: match.away.code,
                                homeScore: match.home_score,
                                awayScore: match.away_score,
                                winnerCode: null,
                              }}
                              pointsAwarded={scoreGroupPoints(match, score)}
                              footer={
                                <OtherPicksButton
                                  matchId={match.id}
                                  homeCode={match.home.code}
                                  awayCode={match.away.code}
                                  homeSlotId={match.home_slot_id}
                                  awaySlotId={match.away_slot_id}
                                />
                              }
                            />
                          );
                        }
                        return (
                          <MatchCard
                            key={match.id}
                            match={match}
                            matchIndex={idx + 1}
                            homeScore={score?.home ?? null}
                            awayScore={score?.away ?? null}
                            saveStatus={saveStatus.get(match.id) ?? "idle"}
                            locked={isMatchLocked(match.scheduled_at)}
                            lockHint={formatLockHint(match.scheduled_at, now)}
                            footer={
                              hasMatchStarted(match, now) ? (
                                <OtherPicksButton
                                  matchId={match.id}
                                  homeCode={match.home.code}
                                  awayCode={match.away.code}
                                  homeSlotId={match.home_slot_id}
                                  awaySlotId={match.away_slot_id}
                                />
                              ) : null
                            }
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
            {/* Suspense boundary scopes BracketSidebar's useSearchParams()
                read: /predictions is auth-dynamic today so it never bails to
                CSR, but the boundary keeps the build robust if the route is
                ever made static. */}
            <Suspense fallback={null}>
              <BracketSidebar
                standingsByGroupPredicted={standingsByGroupPredicted}
                standingsByGroupReal={standingsByGroupReal}
                realMatchCountByGroup={realMatchCountByGroup}
                bracketSlotMapPredicted={bracketSlotMapPredicted}
                bracketSlotMapReal={bracketSlotMapReal}
                teamCodeById={teamCodeById}
                activeRound={activeRound}
              />
            </Suspense>
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
  podiumFilled,
  podiumLocked,
}: {
  rounds: HydratedRound[];
  activeId: string;
  onChange: (id: string) => void;
  podiumFilled: number;
  podiumLocked: boolean;
}) {
  const podiumActive = activeId === "podium";
  const podiumComplete = podiumFilled >= 3;
  // Note color: amber accent for incomplete (action needed), green for
  // done, dim once the deadline passed. Stands out from the temporal
  // round pills so users register "this one is different."
  const podiumNoteClass = podiumActive
    ? "text-bg/70"
    : podiumLocked
      ? "text-text-dim"
      : podiumComplete
        ? "text-green-correct"
        : "text-accent";
  const podiumNote = podiumLocked
    ? "LOCKED"
    : podiumComplete
      ? "FILLED"
      : `${podiumFilled}/3 PICKED`;

  return (
    <nav
      aria-label="Tournament rounds"
      className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0"
    >
      <ul className="flex min-w-max items-center gap-2">
        <li>
          <button
            type="button"
            onClick={() => onChange("podium")}
            aria-current={podiumActive ? "page" : undefined}
            className={
              "group flex flex-col items-start gap-0.5 rounded-full border px-4 py-2 transition-colors duration-[var(--motion-micro)] " +
              (podiumActive
                ? "border-transparent bg-accent text-bg"
                : "border-accent-muted/60 bg-surface text-text-primary hover:border-accent")
            }
          >
            <span className="font-mono text-xs font-bold uppercase tracking-[0.08em]">
              PODIUM
            </span>
            <span
              className={
                "font-mono text-[10px] uppercase tracking-[0.06em] tabular-nums " +
                podiumNoteClass
              }
            >
              {podiumNote}
            </span>
          </button>
        </li>
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
  nextLockAt: number | null,
): ReactNode {
  if (!round) return null;
  // Matches lock individually at their own kickoff, so the round header
  // counts down to the *next* match to lock rather than one round-wide
  // deadline. "ALL LOCKED" once every match in the round has kicked off.
  const countdown =
    nextLockAt == null ? "ALL LOCKED" : `NEXT LOCK IN ${formatDelta(nextLockAt)}`;
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

// Relative time from now to a future epoch-ms instant, rendered coarsely:
// days+hours when ≥1 day out, hours+minutes within a day, minutes in the
// last hour. Callers guard for already-elapsed instants.
function formatDelta(targetMs: number): string {
  const ms = targetMs - Date.now();
  if (ms <= 0) return "0M";
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (days >= 1) return `${days}D ${hours.toString().padStart(2, "0")}H`;
  if (hours >= 1) return `${hours}H ${minutes.toString().padStart(2, "0")}M`;
  return `${minutes}M`;
}

// Per-card "LOCKS IN …" hint, shown while a match is still editable.
// Null once kickoff passes — the card's own "locked" label takes over.
function formatLockHint(kickoffIso: string, nowMs: number): string | null {
  const target = new Date(kickoffIso).getTime();
  if (!Number.isFinite(target) || target <= nowMs) return null;
  return `LOCKS IN ${formatDelta(target)}`;
}

function formatLockShort(iso: string): string {
  const d = new Date(iso);
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return "AT KICKOFF";
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  if (days >= 1) return `IN ${days}D ${hours.toString().padStart(2, "0")}H`;
  if (hours >= 1) return `IN ${hours}H`;
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return `IN ${minutes}M`;
}

function formatShort(iso: string): string {
  return new Date(iso)
    .toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
    .toUpperCase();
}

function knockoutRoundLabel(roundId: string): string {
  switch (roundId) {
    case "r32":
      return "R32";
    case "r16":
      return "R16";
    case "qf":
      return "QF";
    case "sf":
      return "SF";
    case "third_place":
      return "3RD";
    case "final":
      return "FINAL";
    default:
      return roundId.toUpperCase();
  }
}

function scoreGroupPoints(
  match: HydratedMatch,
  state: PredictionState | undefined,
): number | null {
  if (!state) return null;
  const prediction: MatchPrediction = {
    predicted_home_score: state.home,
    predicted_away_score: state.away,
    predicted_winning_slot_id: null,
  };
  const actual: ActualMatch = {
    status: match.status,
    stage: "group",
    home_slot_id: match.home_slot_id,
    away_slot_id: match.away_slot_id,
    home_score: match.home_score,
    away_score: match.away_score,
    winning_slot_id: null,
  };
  return computeMatchPoints(prediction, actual);
}

function scoreKnockoutPoints(
  match: HydratedKnockoutMatch,
  state: PredictionState | undefined,
  actualWinningSlotId: string | null,
): number | null {
  if (!state) return null;
  const prediction: MatchPrediction = {
    predicted_home_score: state.home,
    predicted_away_score: state.away,
    predicted_winning_slot_id: state.winner,
  };
  const actual: ActualMatch = {
    status: match.status,
    stage: "knockout",
    home_slot_id: match.home_slot_id,
    away_slot_id: match.away_slot_id,
    home_score: match.home_score,
    away_score: match.away_score,
    winning_slot_id: actualWinningSlotId,
  };
  return computeMatchPoints(prediction, actual);
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
