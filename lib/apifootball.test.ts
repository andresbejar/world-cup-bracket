import { describe, it, expect, vi } from "vitest";
import {
  fetchFixtures,
  parseFixture,
  FIFA_2026_LEAGUE_ID,
  FIFA_2026_SEASON,
  type ApiFootballConfig,
} from "./apifootball";

// Synthetic api-football /fixtures row shapes for parser tests.

function row(opts: {
  fixture_id: number;
  short: string;
  date?: string;
  fulltime?: { home: number | null; away: number | null };
  extratime?: { home: number | null; away: number | null };
  penalty?: { home: number | null; away: number | null };
}) {
  return {
    fixture: {
      id: opts.fixture_id,
      date: opts.date ?? "2026-06-11T19:00:00+00:00",
      status: { short: opts.short },
    },
    score: {
      fulltime: opts.fulltime ?? { home: null, away: null },
      extratime: opts.extratime ?? { home: null, away: null },
      penalty: opts.penalty ?? { home: null, away: null },
    },
  };
}

describe("parseFixture", () => {
  it("regulation finish: 2-1 → canonical 2-1, finished", () => {
    const out = parseFixture(
      row({
        fixture_id: 100,
        short: "FT",
        fulltime: { home: 2, away: 1 },
      }),
    );
    expect(out).toEqual({
      apifootball_fixture_id: 100,
      status: "finished",
      home_score: 2,
      away_score: 1,
      penalty_winner: null,
      finished_at: "2026-06-11T19:00:00+00:00",
    });
  });

  it("AET finish: 1-1 in regulation + 1-0 in ET → canonical 2-1, no penalty winner", () => {
    const out = parseFixture(
      row({
        fixture_id: 101,
        short: "AET",
        fulltime: { home: 1, away: 1 },
        extratime: { home: 1, away: 0 },
      }),
    );
    expect(out?.status).toBe("finished");
    expect(out?.home_score).toBe(2);
    expect(out?.away_score).toBe(1);
    expect(out?.penalty_winner).toBeNull();
  });

  it("PEN finish: 1-1 in regulation, 4-2 on penalties → canonical 1-1, home advances", () => {
    const out = parseFixture(
      row({
        fixture_id: 102,
        short: "PEN",
        fulltime: { home: 1, away: 1 },
        extratime: { home: 0, away: 0 },
        penalty: { home: 4, away: 2 },
      }),
    );
    expect(out?.home_score).toBe(1);
    expect(out?.away_score).toBe(1);
    expect(out?.penalty_winner).toBe("home");
  });

  it("PEN finish: away wins on penalties → penalty_winner is away", () => {
    const out = parseFixture(
      row({
        fixture_id: 103,
        short: "PEN",
        fulltime: { home: 0, away: 0 },
        penalty: { home: 3, away: 5 },
      }),
    );
    expect(out?.penalty_winner).toBe("away");
  });

  it("scheduled fixture: null scores, status scheduled", () => {
    const out = parseFixture(row({ fixture_id: 200, short: "NS" }));
    expect(out?.status).toBe("scheduled");
    expect(out?.home_score).toBeNull();
    expect(out?.finished_at).toBeNull();
  });

  it("in-progress fixture (1H/2H/HT/ET/P): in_progress, no canonical score yet", () => {
    for (const code of ["1H", "2H", "HT", "ET", "P", "BT", "LIVE"]) {
      const out = parseFixture(
        row({
          fixture_id: 300,
          short: code,
          fulltime: { home: 1, away: 0 }, // partial score from upstream
        }),
      );
      expect(out?.status).toBe("in_progress");
      expect(out?.home_score).toBeNull();
    }
  });

  it("cancelled / postponed / walkover: cancelled status", () => {
    for (const code of ["PST", "CANC", "ABD", "AWD", "WO"]) {
      const out = parseFixture(row({ fixture_id: 400, short: code }));
      expect(out?.status).toBe("cancelled");
    }
  });

  it("unknown status falls through to scheduled (defensive)", () => {
    const out = parseFixture(row({ fixture_id: 500, short: "WAT" }));
    expect(out?.status).toBe("scheduled");
  });

  it("missing fulltime on a finished fixture → null scores (defensive)", () => {
    const out = parseFixture(
      row({
        fixture_id: 600,
        short: "FT",
        // No fulltime block at all
      }),
    );
    expect(out?.status).toBe("finished");
    expect(out?.home_score).toBeNull();
    expect(out?.away_score).toBeNull();
  });

  it("PEN with missing penalty scores → null winner (defensive)", () => {
    const out = parseFixture(
      row({
        fixture_id: 700,
        short: "PEN",
        fulltime: { home: 2, away: 2 },
        // no penalty block
      }),
    );
    expect(out?.penalty_winner).toBeNull();
  });

  it("PEN with equal penalty scores → null winner (impossible irl but defensive)", () => {
    const out = parseFixture(
      row({
        fixture_id: 701,
        short: "PEN",
        fulltime: { home: 1, away: 1 },
        penalty: { home: 5, away: 5 },
      }),
    );
    expect(out?.penalty_winner).toBeNull();
  });

  it("rejects rows with no fixture object", () => {
    expect(parseFixture({})).toBeNull();
    expect(parseFixture(null)).toBeNull();
    expect(parseFixture("nope")).toBeNull();
  });

  it("rejects rows with non-numeric fixture id", () => {
    expect(
      parseFixture({ fixture: { id: "abc", status: { short: "NS" } } }),
    ).toBeNull();
  });

  it("non-string fixture.date → null finished_at", () => {
    const out = parseFixture({
      fixture: { id: 999, date: 12345, status: { short: "FT" } },
      score: { fulltime: { home: 1, away: 0 } },
    });
    expect(out?.finished_at).toBeNull();
  });

  it("missing status object defaults to scheduled", () => {
    const out = parseFixture({ fixture: { id: 800 } });
    expect(out?.status).toBe("scheduled");
  });
});

describe("fetchFixtures", () => {
  const cfg: ApiFootballConfig = {
    host: "https://v3.football.api-sports.io",
    key: "test-key",
  };

  function mockFetchOnce(status: number, body: unknown): typeof fetch {
    return vi.fn(async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
  }

  it("happy path: returns parsed fixtures", async () => {
    const fetchImpl = mockFetchOnce(200, {
      response: [
        row({ fixture_id: 1, short: "FT", fulltime: { home: 2, away: 1 } }),
        row({ fixture_id: 2, short: "NS" }),
      ],
    });
    const out = await fetchFixtures({ ...cfg, fetchImpl });
    expect(out).toHaveLength(2);
    expect(out?.[0].apifootball_fixture_id).toBe(1);
    expect(out?.[0].status).toBe("finished");
    expect(out?.[1].status).toBe("scheduled");
  });

  it("hits the correct URL with the API key header", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ response: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    await fetchFixtures({ ...cfg, fetchImpl });
    expect(calls[0].url).toContain(`league=${FIFA_2026_LEAGUE_ID}`);
    expect(calls[0].url).toContain(`season=${FIFA_2026_SEASON}`);
    const headers = (calls[0].init?.headers ?? {}) as Record<string, string>;
    expect(headers["x-apisports-key"]).toBe("test-key");
  });

  it("429 rate-limit returns null without throwing", async () => {
    const fetchImpl = mockFetchOnce(429, { message: "Too Many Requests" });
    const out = await fetchFixtures({ ...cfg, fetchImpl });
    expect(out).toBeNull();
  });

  it("5xx returns null without throwing", async () => {
    const fetchImpl = mockFetchOnce(503, "Service Unavailable");
    const out = await fetchFixtures({ ...cfg, fetchImpl });
    expect(out).toBeNull();
  });

  it("4xx (non-429) returns null", async () => {
    const fetchImpl = mockFetchOnce(401, { message: "Unauthorized" });
    const out = await fetchFixtures({ ...cfg, fetchImpl });
    expect(out).toBeNull();
  });

  it("malformed JSON returns null", async () => {
    const fetchImpl = mockFetchOnce(200, "this is not json {");
    const out = await fetchFixtures({ ...cfg, fetchImpl });
    expect(out).toBeNull();
  });

  it("unexpected payload shape returns null", async () => {
    const fetchImpl = mockFetchOnce(200, { not: "what we expected" });
    const out = await fetchFixtures({ ...cfg, fetchImpl });
    expect(out).toBeNull();
  });

  it("network error returns null", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const out = await fetchFixtures({ ...cfg, fetchImpl });
    expect(out).toBeNull();
  });

  it("falls back to globalThis.fetch when fetchImpl is not provided", async () => {
    const stub = vi.fn(async () =>
      new Response(JSON.stringify({ response: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", stub);
    try {
      const out = await fetchFixtures({ host: cfg.host, key: cfg.key });
      expect(out).toEqual([]);
      expect(stub).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("drops malformed rows but keeps the rest", async () => {
    const fetchImpl = mockFetchOnce(200, {
      response: [
        row({ fixture_id: 1, short: "FT", fulltime: { home: 1, away: 0 } }),
        { fixture: "broken" }, // garbage
        row({ fixture_id: 2, short: "NS" }),
      ],
    });
    const out = await fetchFixtures({ ...cfg, fetchImpl });
    expect(out).toHaveLength(2);
    expect(out?.map((f) => f.apifootball_fixture_id)).toEqual([1, 2]);
  });
});
