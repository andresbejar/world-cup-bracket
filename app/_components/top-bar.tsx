import Image from "next/image";
import Link from "next/link";
import { SignOutButton } from "@/app/predictions/sign-out-button";

// Global top bar — shared by /predictions and /leaderboard. The two-item
// pill nav (Predictions / Leaderboard) keeps the active page obvious
// via accent fill + aria-current, matches the round-selector pill family,
// and is intentionally visible on mobile (the previous "012 PTS" entry
// point was hidden below sm:, which made the leaderboard undiscoverable).

type ActivePage = "predictions" | "leaderboard";

interface Props {
  active: ActivePage;
  username: string;
  avatar: string | null;
  points: number;
  email: string;
}

const NAV: { id: ActivePage; label: string; href: string }[] = [
  { id: "predictions", label: "Predictions", href: "/predictions" },
  { id: "leaderboard", label: "Leaderboard", href: "/leaderboard" },
];

export function TopBar({ active, username, avatar, points, email }: Props) {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-4 md:px-8 md:py-5">
        <Link
          href="/predictions"
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
                    className={
                      "block rounded-full border px-3.5 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.08em] transition-colors duration-[var(--motion-micro)] " +
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

        <div className="flex items-center gap-3">
          <span className="hidden font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted tabular-nums sm:inline">
            <span className="text-text-primary">
              {points.toString().padStart(3, "0")}
            </span>{" "}
            PTS
          </span>
          <div className="flex items-center gap-3 rounded-full border border-border bg-surface py-1.5 pl-1.5 pr-3">
            {avatar ? (
              <Image
                src={avatar}
                alt=""
                width={28}
                height={28}
                className="rounded-full"
                unoptimized
              />
            ) : (
              <div
                aria-hidden
                className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-high font-mono text-[10px] uppercase text-text-muted"
              >
                {username.slice(0, 2)}
              </div>
            )}
            <span
              className="hidden text-sm sm:inline"
              title={email}
            >
              {username}
            </span>
          </div>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
