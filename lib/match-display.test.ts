import { describe, it, expect } from "vitest";
import { hasRealResult, shortDateTime } from "./match-display";

// Kickoff fixed at noon UTC on FIFA 2026 opening day. "now" is injected so
// every branch is deterministic.
const KICKOFF = "2026-06-11T12:00:00Z";
const KICKOFF_MS = Date.parse(KICKOFF);

describe("hasRealResult", () => {
  it("false for a scheduled match (not played yet)", () => {
    expect(
      hasRealResult({ status: "scheduled", scheduled_at: KICKOFF }, KICKOFF_MS + 1),
    ).toBe(false);
  });

  it("false for an in_progress match", () => {
    expect(
      hasRealResult({ status: "in_progress", scheduled_at: KICKOFF }, KICKOFF_MS + 1),
    ).toBe(false);
  });

  it("false for a finished match whose kickoff is still in the future (phantom/stranded — the APT-51 bug)", () => {
    const beforeKickoff = KICKOFF_MS - 60_000;
    expect(
      hasRealResult({ status: "finished", scheduled_at: KICKOFF }, beforeKickoff),
    ).toBe(false);
  });

  it("true for a finished match whose kickoff has passed", () => {
    const afterKickoff = KICKOFF_MS + 2 * 60 * 60 * 1000;
    expect(
      hasRealResult({ status: "finished", scheduled_at: KICKOFF }, afterKickoff),
    ).toBe(true);
  });

  it("true at the exact kickoff boundary (<= now)", () => {
    expect(
      hasRealResult({ status: "finished", scheduled_at: KICKOFF }, KICKOFF_MS),
    ).toBe(true);
  });

  it("false for a cancelled match even after the scheduled time", () => {
    expect(
      hasRealResult({ status: "cancelled", scheduled_at: KICKOFF }, KICKOFF_MS + 1),
    ).toBe(false);
  });
});

describe("shortDateTime", () => {
  // R32 match 73: 19:00 UTC kickoff. Pinning the zone makes the conversion
  // and the appended zone label deterministic regardless of CI's local zone.
  const R32_M1 = "2026-06-28T19:00:00Z";

  it("renders the kickoff in the given zone with a zone-name label", () => {
    expect(shortDateTime(R32_M1, "America/Los_Angeles")).toBe("Jun 28, 12:00 PM PDT");
  });

  it("converts the same instant correctly for a different zone", () => {
    expect(shortDateTime(R32_M1, "UTC")).toBe("Jun 28, 7:00 PM UTC");
  });

  it("always appends a timezone label so times are never ambiguous", () => {
    // No explicit zone → runtime-local; the key guarantee is the label exists.
    expect(shortDateTime(R32_M1)).toMatch(/[A-Z]{2,5}$/);
  });

  it("normalizes the narrow no-break space before AM/PM to a regular space", () => {
    // toLocaleString emits U+202F before AM/PM; output must use U+0020 instead.
    const out = shortDateTime(R32_M1, "UTC");
    expect(out).not.toContain(" ");
    expect(out).toContain(" PM");
  });
});
