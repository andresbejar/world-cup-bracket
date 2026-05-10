"use client";

import { useMemo, useState } from "react";
import {
  computeGroupStandings,
  GROUP_LETTERS,
  populateR32Slots,
  type GroupStanding,
  type GroupStandings,
  type MatchScore,
  type SlotAssignment,
  type Team,
} from "@/lib/bracket";
import { R32_MATCHES } from "@/lib/bracket-structure";
import type { HydratedMatch, HydratedTeam } from "@/lib/group-data";

// The right-column workspace sidebar. Two views — Bracket (R32 slot
// occupants) and Standings (12 mini group tables) — driven by the same
// live computeGroupStandings output. Heavy useMemo so a single score
// edit doesn't re-render all 12 groups + 16 R32 cards on every keystroke.

interface Props {
  groupTeams: HydratedTeam[];
  groupMatches: HydratedMatch[];
  /** match_id → predicted score; entries omitted when the user hasn't filled one. */
  predictions: ReadonlyMap<string, { home: number; away: number }>;
}

type SidebarTab = "bracket" | "standings";

export function BracketSidebar({
  groupTeams,
  groupMatches,
  predictions,
}: Props) {
  const [tab, setTab] = useState<SidebarTab>("bracket");

  const teamCodeById = useMemo(
    () => new Map(groupTeams.map((t) => [t.id, t.code])),
    [groupTeams],
  );

  const standingsByGroup = useMemo(() => {
    const matchById = new Map(groupMatches.map((m) => [m.id, m]));
    const scoresByGroup = new Map<string, MatchScore[]>();
    for (const letter of GROUP_LETTERS) scoresByGroup.set(letter, []);
    for (const [matchId, score] of predictions) {
      const m = matchById.get(matchId);
      if (!m) continue;
      const bucket = scoresByGroup.get(m.home.group_letter);
      if (!bucket) continue;
      bucket.push({
        home_team_id: m.home.id,
        away_team_id: m.away.id,
        home_score: score.home,
        away_score: score.away,
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

  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <SidebarTabs active={tab} onChange={setTab} />
      {tab === "bracket" ? (
        <BracketView
          standingsByGroup={standingsByGroup}
          teamCodeById={teamCodeById}
        />
      ) : (
        <StandingsView
          standingsByGroup={standingsByGroup}
          teamCodeById={teamCodeById}
        />
      )}
    </div>
  );
}

function SidebarTabs({
  active,
  onChange,
}: {
  active: SidebarTab;
  onChange: (next: SidebarTab) => void;
}) {
  const tabs: { id: SidebarTab; label: string }[] = [
    { id: "bracket", label: "Bracket" },
    { id: "standings", label: "Standings" },
  ];
  return (
    <div
      role="tablist"
      aria-label="Sidebar view"
      className="flex items-center gap-1 rounded-full border border-border bg-bg p-1"
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={
            "flex-1 rounded-full px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.08em] transition-colors duration-[var(--motion-micro)] " +
            (active === t.id
              ? "bg-accent text-bg"
              : "text-text-muted hover:text-text-primary")
          }
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function BracketView({
  standingsByGroup,
  teamCodeById,
}: {
  standingsByGroup: GroupStandings[];
  teamCodeById: Map<string, string>;
}) {
  const r32Slots: SlotAssignment[] = useMemo(
    () => populateR32Slots(standingsByGroup, []),
    [standingsByGroup],
  );
  const slotByLabel = useMemo(
    () => new Map(r32Slots.map((s) => [s.slot_label, s.team_id])),
    [r32Slots],
  );
  const filledCount = r32Slots.filter((s) => s.team_id != null).length;

  return (
    <div role="tabpanel">
      <SectionHeading
        eyebrow="ROUND OF 32 · LIVE"
        title="Knockout tree"
        meta={`${filledCount}/32 SLOTS`}
      />

      <ul className="mt-5 grid grid-cols-2 gap-2.5">
        {R32_MATCHES.map((m) => {
          const home = slotByLabel.get(m.home_slot_label);
          const away = slotByLabel.get(m.away_slot_label);
          return (
            <li
              key={m.id}
              className="rounded-sm border border-border bg-bg p-2.5"
            >
              <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-text-dim tabular-nums">
                R32 · M{m.match_index.toString().padStart(2, "0")}
              </p>
              <BracketRow
                label={labelHint(m.home_slot_label)}
                team={home ? teamCodeById.get(home) ?? home : null}
              />
              <BracketRow
                label={labelHint(m.away_slot_label)}
                team={away ? teamCodeById.get(away) ?? away : null}
              />
            </li>
          );
        })}
      </ul>

      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim">
        Best-3rd slots fill once you pick them — APT-22. Bracket extends
        through R16 → Final in the APT-18 closeout.
      </p>
    </div>
  );
}

function BracketRow({
  label,
  team,
}: {
  label: string;
  team: string | null;
}) {
  return (
    <p className="mt-1 flex items-baseline justify-between gap-2 font-mono text-sm">
      <span className="text-[10px] uppercase tracking-[0.06em] text-text-dim">
        {label}
      </span>
      <span
        className={
          team
            ? "font-bold tabular-nums text-text-primary"
            : "text-text-dim"
        }
      >
        {team ?? "—"}
      </span>
    </p>
  );
}

function StandingsView({
  standingsByGroup,
  teamCodeById,
}: {
  standingsByGroup: GroupStandings[];
  teamCodeById: Map<string, string>;
}) {
  const tieFlagged = standingsByGroup.some((g) =>
    g.standings.some((s) => s.needs_tiebreaker),
  );
  const filled = standingsByGroup.reduce(
    (acc, g) => acc + g.standings.filter((s) => s.played > 0).length,
    0,
  );
  const totalTeams = standingsByGroup.reduce(
    (acc, g) => acc + g.standings.length,
    0,
  );

  return (
    <div role="tabpanel">
      <SectionHeading
        eyebrow="GROUP STAGE · LIVE"
        title="Standings"
        meta={`${filled}/${totalTeams} ACTIVE`}
      />

      <ul className="mt-5 space-y-4">
        {standingsByGroup.map((group) => (
          <GroupTable
            key={group.group_letter}
            group={group}
            teamCodeById={teamCodeById}
          />
        ))}
      </ul>

      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim">
        {tieFlagged
          ? "* unresolved tiebreaker — adjust predictions to break"
          : "Top 2 from each group + 8 best-thirds advance to R32."}
      </p>
    </div>
  );
}

function GroupTable({
  group,
  teamCodeById,
}: {
  group: GroupStandings;
  teamCodeById: Map<string, string>;
}) {
  return (
    <li className="rounded-sm border border-border bg-bg">
      <div className="flex items-baseline justify-between border-b border-border px-3 py-2">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-text-primary">
          Group {group.group_letter}
        </p>
        <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-text-dim">
          PL · GD · PTS
        </p>
      </div>
      <table className="w-full font-mono text-xs">
        <tbody>
          {group.standings.map((s, i) => {
            const advancing = i < 2;
            const code = teamCodeById.get(s.team_id) ?? s.team_id;
            return (
              <tr
                key={s.team_id}
                className={
                  // The "top 2 advance" line sits between rank 2 and 3.
                  i === 2
                    ? "border-t border-accent-muted/40"
                    : ""
                }
              >
                <td
                  className={
                    "w-6 px-3 py-1.5 text-text-dim tabular-nums " +
                    (advancing ? "text-text-primary" : "")
                  }
                >
                  {s.rank}
                  {s.needs_tiebreaker ? (
                    <span className="text-accent">*</span>
                  ) : null}
                </td>
                <td
                  className={
                    "py-1.5 font-bold uppercase tracking-[0.06em] " +
                    (advancing ? "text-text-primary" : "text-text-muted")
                  }
                >
                  {code}
                </td>
                <td className="py-1.5 text-right text-text-muted tabular-nums">
                  {s.played}
                </td>
                <td className="py-1.5 pl-2 text-right text-text-muted tabular-nums">
                  {formatGd(s.goal_difference)}
                </td>
                <td className="py-1.5 pl-2 pr-3 text-right tabular-nums">
                  <span
                    className={
                      "font-bold " +
                      (advancing ? "text-text-primary" : "text-text-muted")
                    }
                  >
                    {s.points}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </li>
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
    <div className="mt-4 flex items-end justify-between gap-3">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">
          {eyebrow}
        </p>
        <h3
          className="mt-1 font-display text-2xl leading-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {title}
        </h3>
      </div>
      <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim tabular-nums whitespace-nowrap">
        {meta}
      </span>
    </div>
  );
}

function formatGd(n: number): string {
  if (n > 0) return `+${n}`;
  return n.toString();
}

// Compress slot-label vocabulary into 5-6 char hints for the sidebar.
//   "winner-A"      → "W A"
//   "runner-up-C"   → "R C"
//   "best-3rd-1"    → "3RD 1"
function labelHint(label: string): string {
  const winner = /^winner-([A-L])$/.exec(label);
  if (winner) return `W ${winner[1]}`;
  const runner = /^runner-up-([A-L])$/.exec(label);
  if (runner) return `R ${runner[1]}`;
  const third = /^best-3rd-(\d)$/.exec(label);
  if (third) return `3RD ${third[1]}`;
  return label;
}
