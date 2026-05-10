"use client";

import { useMemo, useState } from "react";
import {
  computeGroupStandings,
  GROUP_LETTERS,
  populateR32Slots,
  type GroupStandings,
  type MatchScore,
  type SlotAssignment,
  type Team,
} from "@/lib/bracket";
import {
  QF_MATCHES,
  R16_MATCHES,
  R32_MATCHES,
  SF_MATCHES,
  FINAL_MATCH,
  THIRD_PLACE_MATCH,
} from "@/lib/bracket-structure";
import type { HydratedMatch, HydratedRound, HydratedTeam } from "@/lib/group-data";

// The right-column workspace sidebar. Two views — Bracket (R32 slot
// occupants) and Standings (12 mini group tables) — driven by the same
// live computeGroupStandings output. Heavy useMemo so a single score
// edit doesn't re-render all 12 groups + 16 R32 cards on every keystroke.

interface Props {
  groupTeams: HydratedTeam[];
  groupMatches: HydratedMatch[];
  /** match_id → predicted score; entries omitted when the user hasn't filled one. */
  predictions: ReadonlyMap<string, { home: number; away: number }>;
  /** The round the user is currently editing in the left column. Drives the "current round" emphasis band in the bracket tree. */
  activeRound: HydratedRound | undefined;
}

type SidebarTab = "bracket" | "standings";

export function BracketSidebar({
  groupTeams,
  groupMatches,
  predictions,
  activeRound,
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
          activeStage={activeRound?.stage}
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

type StageId =
  | "group"
  | "r32"
  | "r16"
  | "qf"
  | "sf"
  | "third_place"
  | "final";

// SVG bracket tree geometry. All five rounds render as columns of match
// blocks, with U-shaped connectors between adjacent rounds. The 3rd-place
// match is tucked under the Final with dashed connectors from each SF
// (since the 3rd-place game is fed by SF *losers*, not winners).
const COL_W = 48;
const COL_GAP = 18;
const MATCH_H = 28;
const SLOT_H = 13;
const TOTAL_H = 16 * 32; // 16 R32 matches × 32px pitch
const PAD_TOP = 12;
const PAD_BOT = 80; // room for 3rd-place match + footer
const VIEW_W = 5 * COL_W + 4 * COL_GAP; // 312
const VIEW_H = PAD_TOP + TOTAL_H + PAD_BOT;

const colX = (col: number) => col * (COL_W + COL_GAP);
const matchCenterY = (col: number, idx: number) => {
  const count = 16 >> col;
  const pitch = TOTAL_H / count;
  return PAD_TOP + idx * pitch + pitch / 2;
};

// Map StageId → column index for the "current round" band.
const STAGE_COL: Record<StageId, number | null> = {
  group: null,
  r32: 0,
  r16: 1,
  qf: 2,
  sf: 3,
  final: 4,
  third_place: null, // emphasized via the 3rd-place block, not a column
};

function BracketView({
  standingsByGroup,
  teamCodeById,
  activeStage,
}: {
  standingsByGroup: GroupStandings[];
  teamCodeById: Map<string, string>;
  activeStage: StageId | undefined;
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

  // Resolve the team code occupying a given slot label. R32 labels are
  // populated from group standings; downstream slots (r32-match-N-winner,
  // r16-match-N-winner, etc.) are empty until the user makes knockout
  // predictions in APT-20.
  function teamCodeAt(slotLabel: string): string | null {
    const teamId = slotByLabel.get(slotLabel);
    if (!teamId) return null;
    return teamCodeById.get(teamId) ?? teamId;
  }

  const activeCol = activeStage ? STAGE_COL[activeStage] : null;

  return (
    <div role="tabpanel">
      <SectionHeading
        eyebrow="KNOCKOUT · LIVE"
        title="Bracket"
        meta={`${filledCount}/32 R32`}
      />

      <div className="mt-4 overflow-x-auto">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="block w-full min-w-[300px]"
          aria-label="Knockout bracket — R32 through Final, plus third-place playoff"
        >
          {/* Current-round emphasis band */}
          {activeCol != null ? (
            <rect
              x={colX(activeCol) - 4}
              y={0}
              width={COL_W + 8}
              height={PAD_TOP + TOTAL_H}
              fill="var(--accent)"
              opacity={0.07}
              rx={4}
            />
          ) : null}
          {activeStage === "third_place" ? (
            <rect
              x={colX(4) - 4}
              y={PAD_TOP + TOTAL_H + 8}
              width={COL_W + 8}
              height={MATCH_H + 16}
              fill="var(--accent)"
              opacity={0.07}
              rx={4}
            />
          ) : null}

          {/* Column labels */}
          {(["R32", "R16", "QF", "SF", "F"] as const).map((label, i) => (
            <text
              key={label}
              x={colX(i) + COL_W / 2}
              y={PAD_TOP - 2}
              textAnchor="middle"
              className="fill-text-dim font-mono"
              fontSize={8}
              fontWeight={700}
              letterSpacing={0.5}
            >
              {label}
            </text>
          ))}

          {/* Connectors: R32→R16, R16→QF, QF→SF, SF→F */}
          {[0, 1, 2, 3].map((parentCol) => (
            <Connectors key={parentCol} parentCol={parentCol} />
          ))}

          {/* R32 match blocks */}
          {R32_MATCHES.map((m, i) => (
            <MatchBlock
              key={m.id}
              col={0}
              idx={i}
              matchIndex={m.match_index}
              home={teamCodeAt(m.home_slot_label)}
              away={teamCodeAt(m.away_slot_label)}
              roundLabel="R32"
            />
          ))}
          {/* R16 → empty until knockout predictions ship (APT-20) */}
          {R16_MATCHES.map((m, i) => (
            <MatchBlock
              key={m.id}
              col={1}
              idx={i}
              matchIndex={m.match_index}
              home={teamCodeAt(m.home_slot_label)}
              away={teamCodeAt(m.away_slot_label)}
              roundLabel="R16"
            />
          ))}
          {QF_MATCHES.map((m, i) => (
            <MatchBlock
              key={m.id}
              col={2}
              idx={i}
              matchIndex={m.match_index}
              home={teamCodeAt(m.home_slot_label)}
              away={teamCodeAt(m.away_slot_label)}
              roundLabel="QF"
            />
          ))}
          {SF_MATCHES.map((m, i) => (
            <MatchBlock
              key={m.id}
              col={3}
              idx={i}
              matchIndex={m.match_index}
              home={teamCodeAt(m.home_slot_label)}
              away={teamCodeAt(m.away_slot_label)}
              roundLabel="SF"
            />
          ))}
          <MatchBlock
            col={4}
            idx={0}
            matchIndex={1}
            home={teamCodeAt(FINAL_MATCH.home_slot_label)}
            away={teamCodeAt(FINAL_MATCH.away_slot_label)}
            roundLabel="FINAL"
          />

          {/* 3rd-place match — dashed connectors from SF losers */}
          <ThirdPlaceBlock
            home={teamCodeAt(THIRD_PLACE_MATCH.home_slot_label)}
            away={teamCodeAt(THIRD_PLACE_MATCH.away_slot_label)}
          />
        </svg>
      </div>

      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim">
        R32 slots fill from your group predictions. R16 → Final fill once
        you pick knockout winners (APT-20). Best-3rd slots: APT-22.
      </p>
    </div>
  );
}

function Connectors({ parentCol }: { parentCol: number }) {
  const childCount = 16 >> (parentCol + 1);
  // The U-shape connector from each adjacent pair of parent matches
  // joins at the midpoint and stubs into the child match.
  return (
    <g
      stroke="var(--border)"
      strokeWidth={1}
      fill="none"
      shapeRendering="crispEdges"
    >
      {Array.from({ length: childCount }, (_, i) => {
        const topY = matchCenterY(parentCol, 2 * i);
        const botY = matchCenterY(parentCol, 2 * i + 1);
        const midY = matchCenterY(parentCol + 1, i);
        const parentRight = colX(parentCol) + COL_W;
        const junction = parentRight + COL_GAP / 2;
        const childLeft = colX(parentCol + 1);
        return (
          <path
            key={i}
            d={
              `M ${parentRight} ${topY} ` +
              `L ${junction} ${topY} ` +
              `L ${junction} ${botY} ` +
              `L ${parentRight} ${botY} ` +
              `M ${junction} ${midY} ` +
              `L ${childLeft} ${midY}`
            }
          />
        );
      })}
    </g>
  );
}

function MatchBlock({
  col,
  idx,
  matchIndex,
  home,
  away,
  roundLabel,
}: {
  col: number;
  idx: number;
  matchIndex: number;
  home: string | null;
  away: string | null;
  roundLabel: string;
}) {
  const x = colX(col);
  const cy = matchCenterY(col, idx);
  const top = cy - MATCH_H / 2;
  const homeY = top;
  const awayY = top + SLOT_H + 2;
  return (
    <g>
      <title>
        {roundLabel} · M{matchIndex} — {home ?? "—"} vs {away ?? "—"}
      </title>
      <SlotBox x={x} y={homeY} width={COL_W} height={SLOT_H} team={home} />
      <SlotBox x={x} y={awayY} width={COL_W} height={SLOT_H} team={away} />
    </g>
  );
}

function SlotBox({
  x,
  y,
  width,
  height,
  team,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  team: string | null;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={2}
        fill="var(--bg)"
        stroke="var(--border)"
        strokeWidth={1}
      />
      <text
        x={x + width / 2}
        y={y + height / 2 + 3}
        textAnchor="middle"
        className={team ? "fill-text-primary" : "fill-text-dim"}
        fontFamily="var(--font-mono)"
        fontSize={9}
        fontWeight={team ? 700 : 400}
        letterSpacing={0.5}
      >
        {team ?? "—"}
      </text>
    </g>
  );
}

function ThirdPlaceBlock({
  home,
  away,
}: {
  home: string | null;
  away: string | null;
}) {
  // 3rd-place match sits below the Final, fed by SF losers via dashed lines.
  const blockX = colX(4);
  const blockY = PAD_TOP + TOTAL_H + 16;
  const blockTop = blockY;
  const sf1Cy = matchCenterY(3, 0);
  const sf2Cy = matchCenterY(3, 1);
  const sfRight = colX(3) + COL_W;

  return (
    <g>
      {/* Dashed connectors from each SF down/up to the 3rd-place block */}
      <path
        d={`M ${sfRight} ${sf1Cy + MATCH_H / 2 + 4} L ${sfRight} ${blockTop + MATCH_H / 2} L ${blockX} ${blockTop + MATCH_H / 2}`}
        stroke="var(--border)"
        strokeWidth={1}
        strokeDasharray="2 3"
        fill="none"
        opacity={0.7}
      />
      <path
        d={`M ${sfRight} ${sf2Cy + MATCH_H / 2 + 4} L ${sfRight + 6} ${sf2Cy + MATCH_H / 2 + 4} L ${sfRight + 6} ${blockTop + MATCH_H / 2 + 6} L ${blockX} ${blockTop + MATCH_H / 2 + 6}`}
        stroke="var(--border)"
        strokeWidth={1}
        strokeDasharray="2 3"
        fill="none"
        opacity={0.7}
      />
      <text
        x={blockX + COL_W / 2}
        y={blockTop - 4}
        textAnchor="middle"
        className="fill-text-dim font-mono"
        fontSize={8}
        fontWeight={700}
        letterSpacing={0.5}
      >
        3RD
      </text>
      <title>3rd-place playoff — {home ?? "—"} vs {away ?? "—"}</title>
      <SlotBox
        x={blockX}
        y={blockTop}
        width={COL_W}
        height={SLOT_H}
        team={home}
      />
      <SlotBox
        x={blockX}
        y={blockTop + SLOT_H + 2}
        width={COL_W}
        height={SLOT_H}
        team={away}
      />
    </g>
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

