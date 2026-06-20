import { describe, it, expect } from "vitest";
import {
  type CalendarMatch,
  buildIcsCalendar,
  escapeIcsText,
  foldLine,
  humanizeSlotLabel,
  toIcsUtc,
} from "./ics";

const NOW = "2026-06-20T00:00:00Z";

const groupMatch: CalendarMatch = {
  id: "m-1489369",
  scheduledAtIso: "2026-06-28T19:00:00+00:00",
  homeName: "ARG",
  awayName: "BRA",
  roundName: "Round of 32",
};

// Pull the content lines of the single VEVENT, unfolding continuations first.
function eventLines(ics: string): string[] {
  const unfolded = ics.replace(/\r\n /g, "");
  const lines = unfolded.split("\r\n");
  const start = lines.indexOf("BEGIN:VEVENT");
  const end = lines.indexOf("END:VEVENT");
  return lines.slice(start, end + 1);
}

describe("humanizeSlotLabel", () => {
  it("maps group winner/runner-up slots", () => {
    expect(humanizeSlotLabel("winner-A")).toBe("Winner Group A");
    expect(humanizeSlotLabel("runner-up-B")).toBe("Runner-up Group B");
  });
  it("maps best-3rd and knockout winner/loser slots", () => {
    expect(humanizeSlotLabel("best-3rd-vs-E")).toBe("3rd-Place Team");
    expect(humanizeSlotLabel("r32-match-3-winner")).toBe("Winner R32-3");
    expect(humanizeSlotLabel("r16-match-8-winner")).toBe("Winner R16-8");
    expect(humanizeSlotLabel("qf-match-2-winner")).toBe("Winner QF-2");
    expect(humanizeSlotLabel("sf-match-1-winner")).toBe("Winner SF-1");
    expect(humanizeSlotLabel("sf-match-2-loser")).toBe("Loser SF-2");
  });
  it("falls back to TBD for anything unrecognized", () => {
    expect(humanizeSlotLabel("mystery-slot")).toBe("TBD");
  });
});

describe("toIcsUtc", () => {
  it("renders UTC basic format with a Z suffix", () => {
    expect(toIcsUtc("2026-06-28T19:00:00+00:00")).toBe("20260628T190000Z");
  });
  it("normalizes offset timestamps to UTC", () => {
    // 21:30 at +02:00 is 19:30 UTC.
    expect(toIcsUtc("2026-06-28T21:30:00+02:00")).toBe("20260628T193000Z");
  });
  it("throws on an unparseable date", () => {
    expect(() => toIcsUtc("not-a-date")).toThrow();
  });
});

describe("escapeIcsText", () => {
  it("escapes backslash, semicolon, comma, and newlines", () => {
    expect(escapeIcsText("a, b; c\\d\ne")).toBe("a\\, b\\; c\\\\d\\ne");
  });
  it("leaves emoji and em-dash untouched", () => {
    expect(escapeIcsText("🏆 ARG — BRA")).toBe("🏆 ARG — BRA");
  });
});

describe("foldLine", () => {
  it("leaves short lines untouched", () => {
    expect(foldLine("SUMMARY:short")).toBe("SUMMARY:short");
  });
  it("folds long lines with CRLF + space and keeps every line ≤75 octets", () => {
    const long = "SUMMARY:" + "x".repeat(200);
    const folded = foldLine(long);
    expect(folded).toContain("\r\n ");
    const enc = new TextEncoder();
    for (const line of folded.split("\r\n")) {
      expect(enc.encode(line).length).toBeLessThanOrEqual(75);
    }
  });
});

describe("buildIcsCalendar", () => {
  it("produces a valid empty calendar", () => {
    const ics = buildIcsCalendar([], NOW);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("PRODID:-//World Cup Bracket//Match Calendar//EN");
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(ics).not.toContain("BEGIN:VEVENT");
  });

  it("uses CRLF line endings throughout (no bare LF)", () => {
    const ics = buildIcsCalendar([groupMatch], NOW);
    expect(ics).toContain("\r\n");
    // Every \n must be preceded by \r.
    expect(/[^\r]\n/.test(ics)).toBe(false);
  });

  it("emits one VEVENT per match with the expected fields", () => {
    const lines = eventLines(buildIcsCalendar([groupMatch], NOW));
    expect(lines).toContain("UID:m-1489369@worldcupbracket");
    expect(lines).toContain("DTSTART:20260628T190000Z");
    expect(lines).toContain("DTEND:20260628T210000Z"); // +2h block
    expect(lines).toContain("SUMMARY:🏆 ARG vs BRA — Round of 32");
    expect(lines).toContain("DTSTAMP:20260620T000000Z");
  });

  it("attaches a 30-minute-before display alarm", () => {
    const lines = eventLines(buildIcsCalendar([groupMatch], NOW));
    expect(lines).toContain("BEGIN:VALARM");
    expect(lines).toContain("ACTION:DISPLAY");
    expect(lines).toContain("TRIGGER:-PT30M");
    expect(lines).toContain(
      "DESCRIPTION:ARG vs BRA kicks off in 30 minutes",
    );
  });

  it("uses a host-independent UID so events update in place", () => {
    const ics = buildIcsCalendar([groupMatch], NOW);
    expect(ics).toContain("UID:m-1489369@worldcupbracket");
    expect(ics).not.toMatch(/UID:.*https?/);
  });

  it("renders humanized placeholders for unresolved knockout sides", () => {
    const knockout: CalendarMatch = {
      id: "m-r32-1",
      scheduledAtIso: "2026-06-30T19:00:00+00:00",
      homeName: "Winner Group A",
      awayName: "Runner-up Group B",
      roundName: "Round of 32",
    };
    const ics = buildIcsCalendar([knockout], NOW);
    expect(ics).toContain(
      "SUMMARY:🏆 Winner Group A vs Runner-up Group B — Round of 32",
    );
  });

  it("escapes commas/semicolons in names", () => {
    const odd: CalendarMatch = {
      ...groupMatch,
      roundName: "Group A; Matchday 1, final",
    };
    const ics = buildIcsCalendar([odd], NOW);
    expect(ics).toContain("Group A\\; Matchday 1\\, final");
  });
});
