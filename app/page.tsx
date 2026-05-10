// Smoke-test landing page. Verifies fonts load, color tokens render,
// and semantic scoring colors are correct. Replaced in APT-7 (sign-in) and
// APT-18 (bracket page shell).

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-8 py-24">
      <p className="font-mono text-xs uppercase tracking-[0.08em] text-text-muted">
        Design system &middot; smoke test &middot; APT-5
      </p>

      <h1
        className="mt-4 font-display text-7xl leading-[1.05] tracking-tight"
        style={{ fontFamily: "var(--font-display)" }}
      >
        World Cup{" "}
        <em className="not-italic" style={{ fontStyle: "italic", color: "var(--accent)" }}>
          Bracket
        </em>
      </h1>

      <p
        className="mt-6 max-w-prose text-lg italic"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Friends and family, 104 matches, one global leaderboard. The data is
        the show, the chrome should disappear.
      </p>

      <section className="mt-16 grid grid-cols-3 gap-3">
        <Card tint="green" pts="+3 pts" label="score correct" />
        <Card tint="yellow" pts="+1 pt" label="outcome correct" />
        <Card tint="red" pts="+0 pts" label="wrong" />
      </section>

      <p className="mt-16 font-mono text-xs uppercase tracking-[0.08em] text-text-dim">
        ARG &middot; BRA &middot; FRA &middot; GER &middot; ENG &middot; MEX
        &middot; ESP &middot; JPN &middot; +40 more
      </p>
    </main>
  );
}

function Card({
  tint,
  pts,
  label,
}: {
  tint: "green" | "yellow" | "red";
  pts: string;
  label: string;
}) {
  const tintBg = {
    green: "rgba(21,128,61,0.08)",
    yellow: "rgba(161,98,7,0.08)",
    red: "rgba(185,28,28,0.08)",
  }[tint];

  const badgeBg = {
    green: "rgba(21,128,61,0.18)",
    yellow: "rgba(161,98,7,0.20)",
    red: "rgba(185,28,28,0.16)",
  }[tint];

  const badgeFg = {
    green: "#4ADE80",
    yellow: "#FBBF24",
    red: "#F87171",
  }[tint];

  return (
    <div
      className="rounded-md border p-4"
      style={{
        background: `linear-gradient(180deg, ${tintBg}, var(--surface) 60%)`,
        borderColor: "var(--border)",
      }}
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
        {label}
      </p>
      <p className="mt-3 flex items-baseline justify-between font-mono">
        <span className="text-sm font-bold tracking-[0.04em]">ARG</span>
        <span className="text-3xl font-medium tabular-nums tracking-tight">
          2
        </span>
      </p>
      <p className="mt-1 flex items-baseline justify-between font-mono">
        <span className="text-sm font-bold tracking-[0.04em]">BRA</span>
        <span className="text-3xl font-medium tabular-nums tracking-tight">
          1
        </span>
      </p>
      <p className="mt-3 text-right">
        <span
          className="inline-block rounded-sm px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.06em]"
          style={{ background: badgeBg, color: badgeFg }}
        >
          {pts}
        </span>
      </p>
    </div>
  );
}
