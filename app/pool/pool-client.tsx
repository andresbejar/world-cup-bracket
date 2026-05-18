"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { PaymentLink } from "@/lib/pool/links";
import {
  METHOD_LABELS,
  type PaymentMethod,
  type PoolEntry,
} from "@/lib/pool/types";
import type { PoolRosterRow } from "@/lib/pool/queries";
import type { LeaderboardEntry } from "@/lib/bracket";

interface MethodOption {
  method: PaymentMethod;
  link: PaymentLink | null;
}

interface Props {
  buyInUsd: number;
  deadline: string | null;
  methodLinks: MethodOption[];
  yourEntry: PoolEntry | null;
  roster: PoolRosterRow[];
  confirmedCount: number;
  claimedCount: number;
  unpaidCount: number;
  totalUsers: number;
  totalPool: number;
  projectedPool: number;
  currentLeader: LeaderboardEntry | null;
  currentUserId: string;
  isAdmin: boolean;
}

type Status = "idle" | "saving" | "saved" | "error";

export function PoolClient(props: Props) {
  const {
    buyInUsd,
    deadline,
    methodLinks,
    yourEntry,
    roster,
    confirmedCount,
    claimedCount,
    unpaidCount,
    totalUsers,
    totalPool,
    projectedPool,
    currentLeader,
    currentUserId,
    isAdmin,
  } = props;
  const router = useRouter();

  const [selected, setSelected] = useState<PaymentMethod | null>(
    yourEntry?.method ?? null,
  );
  const [notes, setNotes] = useState(yourEntry?.notes ?? "");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const locked = yourEntry?.status === "confirmed";

  async function submitClaim() {
    if (!selected || locked) return;
    setStatus("saving");
    setMessage(null);
    try {
      const res = await fetch("/api/pool/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          method: selected,
          notes: notes.trim() || undefined,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setStatus("error");
        setMessage(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setStatus("saved");
      setMessage("Got it. The admin will confirm once the funds land.");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  async function retractClaim() {
    if (locked) return;
    setStatus("saving");
    setMessage(null);
    try {
      const res = await fetch("/api/pool/claim", { method: "DELETE" });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setStatus("error");
        setMessage(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setStatus("idle");
      setMessage(null);
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  async function adminConfirm(userId: string, confirmed: boolean) {
    setBusyUserId(userId);
    try {
      const res = await fetch("/api/admin/pool/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_id: userId, confirmed }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        alert(json.error ?? `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-muted">
            PRIZE POOL · WINNER TAKE ALL
          </p>
          <h1
            className="mt-1 font-display text-5xl leading-tight tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            ${totalPool.toLocaleString()}{" "}
            <span className="text-text-dim">/</span>{" "}
            <span className="font-mono text-2xl text-text-muted">
              ${projectedPool.toLocaleString()} PROJECTED
            </span>
          </h1>
        </div>
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted whitespace-nowrap text-right">
          <span className="text-green-correct tabular-nums">
            {confirmedCount}
          </span>{" "}
          CONFIRMED
          <span className="mx-1.5 text-text-dim">·</span>
          <span className="text-yellow-partial tabular-nums">
            {claimedCount}
          </span>{" "}
          AWAITING
          <span className="mx-1.5 text-text-dim">·</span>
          <span className="text-text-dim tabular-nums">{unpaidCount}</span>{" "}
          UNPAID
          <span className="block mt-1 text-text-dim">
            BUY-IN ${buyInUsd}
            {deadline ? ` · DEADLINE ${formatDate(deadline)}` : null}
          </span>
        </p>
      </header>

      {currentLeader ? (
        <section
          className="mb-8 rounded-md border border-accent-muted/40 bg-surface px-4 py-3"
          aria-label="Current leader"
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">
            CURRENT LEADER · PROJECTED PAYOUT $
            {totalPool.toLocaleString()}
          </p>
          <p className="mt-0.5 text-sm">
            <span className="font-semibold text-text-primary">
              @{currentLeader.username ?? "player"}
            </span>
            <span className="ml-2 font-mono text-text-muted tabular-nums">
              {currentLeader.total_points} PTS
            </span>
          </p>
        </section>
      ) : null}

      <section
        className="mb-10 rounded-md border border-border bg-surface p-6"
        aria-label="Your buy-in"
      >
        <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-muted">
          YOUR STATUS
        </p>
        <YourStatusBadge entry={yourEntry} buyInUsd={buyInUsd} />

        {locked ? (
          <p className="mt-4 text-sm text-text-muted">
            You&rsquo;re in. ${buyInUsd} via{" "}
            <span className="font-mono uppercase text-text-primary">
              {METHOD_LABELS[yourEntry!.method]}
            </span>
            , confirmed{" "}
            {yourEntry?.confirmed_at
              ? formatDate(yourEntry.confirmed_at)
              : null}
            .
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-text-muted">
              Pick a method below, send ${buyInUsd}, then come back and hit{" "}
              &ldquo;I just paid&rdquo;.
            </p>

            <ol className="mt-5 grid gap-3 sm:grid-cols-2">
              {methodLinks.map(({ method, link }) => (
                <MethodCard
                  key={method}
                  method={method}
                  link={link}
                  amount={buyInUsd}
                  selected={selected === method}
                  onSelect={() => setSelected(method)}
                />
              ))}
            </ol>

            {selected === "other" ? (
              <label className="mt-4 block">
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                  NOTE (how / when you sent it)
                </span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  maxLength={280}
                  placeholder="e.g. sent via Wise on Friday"
                  className="mt-1 w-full rounded-sm border border-border bg-bg px-3 py-2 font-mono text-sm text-text-primary outline-none focus:border-accent-muted"
                />
              </label>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                disabled={!selected || status === "saving"}
                onClick={submitClaim}
                className="inline-flex min-h-[44px] items-center rounded-full border border-transparent bg-accent px-5 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-bg transition-opacity duration-[var(--motion-micro)] disabled:opacity-40"
              >
                {status === "saving"
                  ? "Saving…"
                  : yourEntry
                    ? "Update my claim"
                    : "I just paid"}
              </button>
              {yourEntry?.status === "claimed" ? (
                <button
                  type="button"
                  disabled={status === "saving"}
                  onClick={retractClaim}
                  className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted hover:text-red-wrong"
                >
                  Retract claim
                </button>
              ) : null}
              {message ? (
                <span
                  role="status"
                  className={
                    "font-mono text-[11px] uppercase tracking-[0.08em] " +
                    (status === "error"
                      ? "text-red-wrong"
                      : status === "saved"
                        ? "text-green-correct"
                        : "text-text-muted")
                  }
                >
                  {message}
                </span>
              ) : null}
            </div>
          </>
        )}
      </section>

      <section aria-label="Pool roster">
        <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.1em] text-text-muted">
          ROSTER · {totalUsers} {totalUsers === 1 ? "PLAYER" : "PLAYERS"}
        </p>
        <ol className="overflow-hidden rounded-md border border-border bg-surface">
          {roster.map((row, idx) => (
            <RosterRow
              key={row.user_id}
              row={row}
              isYou={row.user_id === currentUserId}
              isLast={idx === roster.length - 1}
              isAdmin={isAdmin}
              busy={busyUserId === row.user_id}
              onConfirm={(confirmed) => adminConfirm(row.user_id, confirmed)}
            />
          ))}
        </ol>
      </section>

      <p className="mt-8 font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim">
        Friends-and-family pool. Funds held by the admin, paid out 100% to the
        winner — no house cut. Participation is optional; void where
        prohibited.
      </p>

      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim">
        <Link href="/leaderboard" className="hover:text-text-primary">
          ← Back to leaderboard
        </Link>
      </p>
    </>
  );
}

function YourStatusBadge({
  entry,
  buyInUsd,
}: {
  entry: PoolEntry | null;
  buyInUsd: number;
}) {
  if (entry?.status === "confirmed") {
    return (
      <p className="mt-2 text-2xl font-display text-green-correct">
        Confirmed — ${buyInUsd} in.
      </p>
    );
  }
  if (entry?.status === "claimed") {
    return (
      <p className="mt-2 text-2xl font-display text-yellow-partial">
        Awaiting admin confirmation.
      </p>
    );
  }
  return (
    <p className="mt-2 text-2xl font-display text-text-primary">
      You haven&rsquo;t paid in yet.
    </p>
  );
}

function MethodCard({
  method,
  link,
  amount,
  selected,
  onSelect,
}: {
  method: PaymentMethod;
  link: PaymentLink | null;
  amount: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const usable = link !== null;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        disabled={!usable}
        className={
          "flex w-full flex-col items-start gap-1 rounded-md border px-4 py-3 text-left transition-colors duration-[var(--motion-micro)] " +
          (selected
            ? "border-accent bg-accent/10"
            : "border-border bg-bg hover:border-accent-muted")
        }
      >
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-text-primary">
          {METHOD_LABELS[method]}
        </span>
        {link?.handle ? (
          <span className="font-mono text-[11px] text-text-muted">
            {link.handle}
          </span>
        ) : null}
        {link?.hint ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim">
            {link.hint}
          </span>
        ) : null}
      </button>
      {selected && link?.url ? (
        <a
          href={link.url}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-2 inline-flex min-h-[36px] items-center rounded-full border border-accent-muted bg-surface px-4 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-accent transition-colors duration-[var(--motion-micro)] hover:bg-accent/10"
        >
          Open {METHOD_LABELS[method]} — ${amount} →
        </a>
      ) : null}
    </li>
  );
}

function RosterRow({
  row,
  isYou,
  isLast,
  isAdmin,
  busy,
  onConfirm,
}: {
  row: PoolRosterRow;
  isYou: boolean;
  isLast: boolean;
  isAdmin: boolean;
  busy: boolean;
  onConfirm: (confirmed: boolean) => void;
}) {
  return (
    <li
      className={
        "flex items-center gap-4 px-5 py-3 " +
        (isLast ? "" : "border-b border-border ") +
        (isYou ? "bg-surface-high" : "")
      }
    >
      <Avatar row={row} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm">
          <span className="truncate font-semibold text-text-primary">
            {row.username ?? "player"}
          </span>
          {isYou ? (
            <span className="rounded-full bg-accent px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-bg">
              You
            </span>
          ) : null}
        </p>
        {row.entry ? (
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-text-dim tabular-nums">
            VIA {METHOD_LABELS[row.entry.method].toUpperCase()}
            {row.entry.notes ? ` · ${row.entry.notes}` : null}
          </p>
        ) : null}
      </div>
      <StatusBadge entry={row.entry} />
      {isAdmin && row.entry ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onConfirm(row.entry!.status !== "confirmed")}
          className={
            "shrink-0 rounded-full border px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.08em] transition-colors duration-[var(--motion-micro)] " +
            (row.entry.status === "confirmed"
              ? "border-border text-text-muted hover:border-red-wrong hover:text-red-wrong"
              : "border-accent-muted text-accent hover:bg-accent/10")
          }
        >
          {busy
            ? "…"
            : row.entry.status === "confirmed"
              ? "Undo"
              : "Confirm"}
        </button>
      ) : null}
    </li>
  );
}

function StatusBadge({ entry }: { entry: PoolEntry | null }) {
  if (entry?.status === "confirmed") {
    return (
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-green-correct">
        CONFIRMED
      </span>
    );
  }
  if (entry?.status === "claimed") {
    return (
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-yellow-partial">
        AWAITING
      </span>
    );
  }
  return (
    <span className="font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-text-dim">
      UNPAID
    </span>
  );
}

function Avatar({ row }: { row: PoolRosterRow }) {
  if (row.profile_pic) {
    return (
      <img
        src={row.profile_pic}
        alt=""
        width={32}
        height={32}
        className="h-8 w-8 rounded-sm bg-surface-high"
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <div
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-surface-high font-mono text-[11px] font-bold uppercase text-text-muted tabular-nums"
    >
      {(row.username ?? "??").slice(0, 2)}
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso)
    .toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
    .toUpperCase();
}
