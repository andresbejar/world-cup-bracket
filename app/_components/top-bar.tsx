import Link from "next/link";

// Global top bar — shared across the archive's pages. The pill nav keeps
// the active page obvious via accent fill + aria-current, matches the
// round-selector pill family, and is intentionally visible on mobile (the
// old "012 PTS" entry point was hidden below sm:, which made the
// leaderboard undiscoverable). The nav strip scrolls horizontally so extra
// pills fit.
//
// Archive note: the user pill, points counter, profile link and sign-out
// are gone. There is no session — the site is a frozen public artifact —
// so an identity affordance would be a button that lies.

type ActivePage = "home" | "predictions" | "leaderboard" | "how-to-play";

interface Props {
  active: ActivePage;
}

const NAV: { id: ActivePage; label: string; href: string }[] = [
  { id: "leaderboard", label: "Final Standings", href: "/leaderboard" },
  { id: "predictions", label: "The Bracket", href: "/predictions" },
  { id: "how-to-play", label: "How It Worked", href: "/how-to-play" },
];

export function TopBar({ active }: Props) {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-4 md:px-8 md:py-5">
        <Link
          href="/"
          className="font-display text-2xl leading-none"
          aria-label="World Cup Bracket — home"
        >
          <span style={{ fontFamily: "var(--font-display)" }}>
            World Cup{" "}
            <em
              className="not-italic"
              style={{ fontStyle: "italic", color: "var(--accent)" }}
            >
              Bracket
            </em>
          </span>
        </Link>

        <nav
          aria-label="Primary"
          className="order-3 -mx-1 w-full overflow-x-auto sm:order-none sm:mx-0 sm:w-auto"
        >
          <ul className="flex min-w-max items-center gap-2">
            {NAV.map((item) => {
              const isActive = item.id === active;
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    // min-h-[44px] meets DESIGN.md § Accessibility touch-target
                    // floor on mobile; inline-flex centers the label inside
                    // the expanded hit area without disturbing desktop rhythm.
                    className={
                      "inline-flex min-h-[44px] items-center rounded-full border px-4 font-mono text-[11px] font-bold uppercase tracking-[0.08em] transition-colors duration-[var(--motion-micro)] " +
                      (isActive
                        ? "border-transparent bg-accent text-bg"
                        : "border-border bg-surface text-text-muted hover:text-text-primary")
                    }
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted">
          Archive · 2026
        </span>
      </div>
    </header>
  );
}
