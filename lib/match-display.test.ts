import { describe, it, expect } from "vitest";
import { hasRealResult } from "./match-display";

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
