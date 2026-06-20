"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MatchPick } from "@/lib/match-predictions-data";

// "View everyone's picks" CTA + modal (APT-62). Shown on any match that has
// started (kickoff passed / live / finished). Purely informative, view-only —
// it lets the family see who called the game right.
//
// The CTA only fetches on first open (lazy). The server route is the security
// boundary: it returns 403 for a not-yet-started match, so even though we only
// mount this once `hasMatchStarted` is true client-side, a future match can
// never leak picks.

interface Props {
  matchId: string;
  /** Resolved 3-letter codes for the two sides, for labelling scores + winner. */
  homeCode: string;
  awayCode: string;
  /** Slot ids, to map a knockout pick's `predicted_winning_slot_id` to a code. */
  homeSlotId: string;
  awaySlotId: string;
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; picks: MatchPick[] };

export function OtherPicksButton({
  matchId,
  homeCode,
  awayCode,
  homeSlotId,
  awaySlotId,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ kind: "idle" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const res = await fetch(
        `/api/match-predictions?match_id=${encodeURIComponent(matchId)}`,
      );
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { picks: MatchPick[] };
      setState({ kind: "ready", picks: data.picks });
    } catch {
      setState({ kind: "error" });
    }
  }, [matchId]);

  const onOpen = useCallback(() => {
    setOpen(true);
    // Lazy fetch: only the first open hits the network; re-opens reuse the cache.
    if (state.kind === "idle" || state.kind === "error") void load();
  }, [load, state.kind]);

  const onClose = useCallback(() => setOpen(false), []);

  // Drive the native <dialog> from `open`. showModal() gives us the top-layer
  // backdrop + Escape-to-close + focus trap for free.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={onOpen}
        className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim transition-colors duration-[var(--motion-micro)] hover:text-accent"
      >
        View everyone&apos;s picks
      </button>

      <dialog
        ref={dialogRef}
        // Reset to closed state on Escape / programmatic close so the next
        // open re-syncs cleanly.
        onClose={onClose}
        // Backdrop click: the dialog element fills the viewport behind the
        // panel, so a click whose target is the dialog itself is the backdrop.
        onClick={(e) => {
          if (e.target === dialogRef.current) onClose();
        }}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface-high p-0 text-text-primary backdrop:bg-black/60"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-text-muted">
            Everyone&apos;s picks · {homeCode} v {awayCode}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="font-mono text-xs text-text-dim transition-colors duration-[var(--motion-micro)] hover:text-text-primary"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          <Body
            state={state}
            homeCode={homeCode}
            awayCode={awayCode}
            homeSlotId={homeSlotId}
            awaySlotId={awaySlotId}
          />
        </div>
      </dialog>
    </>
  );
}

function Body({
  state,
  homeCode,
  awayCode,
  homeSlotId,
  awaySlotId,
}: {
  state: LoadState;
  homeCode: string;
  awayCode: string;
  homeSlotId: string;
  awaySlotId: string;
}) {
  if (state.kind === "loading" || state.kind === "idle") {
    return (
      <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-text-dim">
        Loading…
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-red-wrong">
        Couldn&apos;t load picks. Try again.
      </p>
    );
  }
  if (state.picks.length === 0) {
    return (
      <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-text-dim">
        No picks to show for this match.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-1">
      {state.picks.map((p, i) => (
        <PickRow
          key={i}
          pick={p}
          homeCode={homeCode}
          awayCode={awayCode}
          homeSlotId={homeSlotId}
          awaySlotId={awaySlotId}
        />
      ))}
    </ul>
  );
}

function PickRow({
  pick,
  homeCode,
  awayCode,
  homeSlotId,
  awaySlotId,
}: {
  pick: MatchPick;
  homeCode: string;
  awayCode: string;
  homeSlotId: string;
  awaySlotId: string;
}) {
  const tied = pick.predicted_home_score === pick.predicted_away_score;
  const winnerCode =
    pick.predicted_winning_slot_id === homeSlotId
      ? homeCode
      : pick.predicted_winning_slot_id === awaySlotId
        ? awayCode
        : null;
  return (
    <li
      className={
        "flex items-center gap-3 rounded-md px-2 py-1.5 " +
        (pick.is_self ? "bg-surface" : "")
      }
    >
      <Avatar pick={pick} />
      <span className="min-w-0 flex-1 truncate text-sm text-text-muted">
        {pick.username ?? "Player"}
        {pick.is_self ? (
          <span className="ml-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-accent">
            you
          </span>
        ) : null}
      </span>
      {tied && winnerCode ? (
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim">
          {winnerCode} ✓
        </span>
      ) : null}
      <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-text-primary">
        {pick.predicted_home_score} – {pick.predicted_away_score}
      </span>
      <PointsBadge points={pick.points_awarded} />
    </li>
  );
}

function PointsBadge({ points }: { points: number | null }) {
  // Only shown once a match is scored (finished). In-progress matches have
  // null points → render nothing.
  if (points == null) return null;
  const cls =
    points >= 3
      ? "text-green-correct"
      : points >= 1
        ? "text-yellow-partial"
        : "text-red-wrong";
  const label = points >= 3 ? "+3" : points >= 1 ? "+1" : "0";
  return (
    <span
      className={
        "w-7 shrink-0 text-right font-mono text-[11px] font-bold uppercase tabular-nums " +
        cls
      }
    >
      {label}
    </span>
  );
}

function Avatar({ pick }: { pick: MatchPick }) {
  if (pick.profile_pic) {
    return (
      <img
        src={pick.profile_pic}
        alt=""
        width={28}
        height={28}
        className="h-7 w-7 shrink-0 rounded-sm bg-surface"
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <div
      aria-hidden
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-surface font-mono text-[10px] font-bold uppercase text-text-muted tabular-nums"
    >
      {(pick.username ?? "??").slice(0, 2)}
    </div>
  );
}
