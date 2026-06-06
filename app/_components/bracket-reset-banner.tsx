"use client";

import { useEffect, useState } from "react";

// One-time site-wide notice: we corrected the Round-of-32 bracket to
// follow FIFA's Annex C (no group winner can face a 3rd-placed team from
// its own group). That re-encoding changed every knockout matchup, so
// knockout-stage predictions and third-place picks were reset; group
// predictions and podium picks are untouched.
//
// Dismissal is per-browser (localStorage) — fine for a 5–50 person pool;
// the host should also message the group out-of-band. Remove this
// component in a cleanup pass once everyone has re-entered their picks.

const DISMISS_KEY = "annexc-reset-banner-dismissed-v1";

export function BracketResetBanner() {
  // Start hidden; reveal after mount only if not previously dismissed, so
  // SSR/first paint never flashes it for users who already closed it (and
  // localStorage isn't available during SSR). Reading persisted UI state on
  // mount is the intended use of the effect here.
  const [show, setShow] = useState(false);
  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      dismissed = false;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time read of persisted dismissal
    if (!dismissed) setShow(true);
  }, []);

  if (!show) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore — banner just reappears next load
    }
    setShow(false);
  };

  return (
    <div
      role="status"
      className="border-b border-accent-muted/40 bg-accent/10"
    >
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 md:px-8">
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-accent">
          BRACKET FIX
        </span>
        <p className="min-w-0 flex-1 text-sm text-text-primary">
          We corrected the Round of 32 to follow FIFA&apos;s rules (no team can
          face a 3rd-placed side from its own group). Your group and podium
          picks are safe, but your{" "}
          <span className="font-semibold">knockout bracket and third-place picks were reset</span>
          {" "}— please redo them on the{" "}
          <a
            href="/predictions"
            className="underline decoration-accent-muted underline-offset-2 hover:text-accent"
          >
            predictions page
          </a>
          .
        </p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss bracket fix notice"
          className="shrink-0 rounded-full border border-accent-muted/60 px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-text-primary transition-colors duration-[var(--motion-micro)] hover:border-accent"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
