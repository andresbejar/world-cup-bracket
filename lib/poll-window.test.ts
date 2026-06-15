import { describe, it, expect } from "vitest";
import {
  GROUP_WINDOW_MS,
  KNOCKOUT_WINDOW_MS,
  POLL_LEAD_MS,
  isInPollWindow,
  isKnockoutRound,
} from "./poll-window";

// Anchor a kickoff and derive nows relative to it, so the assertions read in
// terms of "minutes after kickoff" rather than wall-clock strings.
const KICKOFF = "2026-06-11T19:00:00+00:00";
const KICKOFF_MS = Date.parse(KICKOFF);
const groupMatch = (status = "scheduled") => ({
  round_id: "group-r1",
  scheduled_at: KICKOFF,
  status,
});
const knockoutMatch = (status = "scheduled") => ({
  round_id: "r32",
  scheduled_at: KICKOFF,
  status,
});

describe("isKnockoutRound", () => {
  it("treats group-* round ids as group", () => {
    expect(isKnockoutRound("group-r1")).toBe(false);
    expect(isKnockoutRound("group-r3")).toBe(false);
  });

  it("treats every other round id as knockout", () => {
    for (const id of ["r32", "r16", "qf", "sf", "third_place", "final"]) {
      expect(isKnockoutRound(id)).toBe(true);
    }
  });
});

describe("isInPollWindow", () => {
  it("is false before the lead time (during the live phase we don't poll)", () => {
    expect(isInPollWindow(groupMatch(), KICKOFF_MS)).toBe(false);
    expect(isInPollWindow(groupMatch(), KICKOFF_MS + POLL_LEAD_MS - 1)).toBe(
      false,
    );
  });

  it("is true from the lead time through the group cap (inclusive bounds)", () => {
    expect(isInPollWindow(groupMatch(), KICKOFF_MS + POLL_LEAD_MS)).toBe(true);
    expect(isInPollWindow(groupMatch(), KICKOFF_MS + GROUP_WINDOW_MS)).toBe(
      true,
    );
  });

  it("is false for a group match past its cap", () => {
    expect(isInPollWindow(groupMatch(), KICKOFF_MS + GROUP_WINDOW_MS + 1)).toBe(
      false,
    );
  });

  it("keeps a knockout in-window past the group cap (ET + penalties)", () => {
    const t = KICKOFF_MS + GROUP_WINDOW_MS + 60_000;
    expect(isInPollWindow(groupMatch(), t)).toBe(false);
    expect(isInPollWindow(knockoutMatch(), t)).toBe(true);
    expect(isInPollWindow(knockoutMatch(), KICKOFF_MS + KNOCKOUT_WINDOW_MS)).toBe(
      true,
    );
    expect(
      isInPollWindow(knockoutMatch(), KICKOFF_MS + KNOCKOUT_WINDOW_MS + 1),
    ).toBe(false);
  });

  it("is false for terminal matches even inside the time window", () => {
    const t = KICKOFF_MS + POLL_LEAD_MS + 60_000;
    expect(isInPollWindow(groupMatch("finished"), t)).toBe(false);
    expect(isInPollWindow(groupMatch("cancelled"), t)).toBe(false);
    // ...but a still-pending row at the same instant is in-window.
    expect(isInPollWindow(groupMatch("in_progress"), t)).toBe(true);
  });

  it("is false when scheduled_at is unparseable", () => {
    expect(
      isInPollWindow(
        { round_id: "group-r1", scheduled_at: "not-a-date", status: "scheduled" },
        KICKOFF_MS + POLL_LEAD_MS + 60_000,
      ),
    ).toBe(false);
  });
});
