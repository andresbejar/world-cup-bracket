import { describe, it, expect } from "vitest";
import {
  checkFinalistLock,
  checkMatchLock,
  checkRoundLock,
  validateKnockoutPrediction,
} from "./lock-check";

// Anchor "now" at noon UTC on 2026-05-11 (the day after our last commit
// session) — well before the FIFA 2026 opening match.
const NOW_MS = Date.parse("2026-05-11T12:00:00Z");
const NOW_DURING_TOURNAMENT = Date.parse("2026-06-15T10:00:00Z");

describe("checkRoundLock", () => {
  it("editable when no lock and deadline still in the future", () => {
    const res = checkRoundLock(
      { locked_at: null, deadline_at: "2026-06-11T15:00:00Z" },
      NOW_MS,
    );
    expect(res).toEqual({ editable: true });
  });

  it("locked when locked_at is set, regardless of deadline", () => {
    const res = checkRoundLock(
      { locked_at: "2026-05-09T08:00:00Z", deadline_at: "2026-12-01T00:00:00Z" },
      NOW_MS,
    );
    expect(res).toEqual({
      editable: false,
      reason: "locked",
      locked_at: "2026-05-09T08:00:00Z",
    });
  });

  it("past_deadline when now >= deadline_at", () => {
    const res = checkRoundLock(
      { locked_at: null, deadline_at: "2026-06-11T15:00:00Z" },
      NOW_DURING_TOURNAMENT,
    );
    expect(res).toEqual({
      editable: false,
      reason: "past_deadline",
      deadline_at: "2026-06-11T15:00:00Z",
    });
  });

  it("treats now exactly at deadline as past_deadline", () => {
    const deadline = "2026-06-11T15:00:00Z";
    const res = checkRoundLock(
      { locked_at: null, deadline_at: deadline },
      Date.parse(deadline),
    );
    expect(res.editable).toBe(false);
  });

  it("falls through to editable when deadline_at is unparseable", () => {
    // Defensive: a malformed timestamp shouldn't accidentally block
    // legitimate writes. The DB constraint requires a real timestamptz,
    // so this is a paranoia branch.
    const res = checkRoundLock(
      { locked_at: null, deadline_at: "not-a-date" },
      NOW_MS,
    );
    expect(res.editable).toBe(true);
  });
});

describe("checkMatchLock", () => {
  it("editable before kickoff when the round isn't admin-locked", () => {
    const res = checkMatchLock(
      { round_locked_at: null, kickoff_at: "2026-06-15T18:00:00Z" },
      NOW_MS,
    );
    expect(res).toEqual({ editable: true });
  });

  it("locked when the round's locked_at is set, regardless of kickoff", () => {
    // Admin hard-lock wins even though kickoff is far in the future —
    // mirrors checkRoundLock so an admin freeze closes the whole round.
    const res = checkMatchLock(
      {
        round_locked_at: "2026-05-09T08:00:00Z",
        kickoff_at: "2026-12-01T00:00:00Z",
      },
      NOW_MS,
    );
    expect(res).toEqual({
      editable: false,
      reason: "locked",
      locked_at: "2026-05-09T08:00:00Z",
    });
  });

  it("past_deadline once now >= kickoff", () => {
    const res = checkMatchLock(
      { round_locked_at: null, kickoff_at: "2026-06-11T15:00:00Z" },
      NOW_DURING_TOURNAMENT,
    );
    expect(res).toEqual({
      editable: false,
      reason: "past_deadline",
      deadline_at: "2026-06-11T15:00:00Z",
    });
  });

  it("treats now exactly at kickoff as past_deadline", () => {
    const kickoff = "2026-06-15T18:00:00Z";
    const res = checkMatchLock(
      { round_locked_at: null, kickoff_at: kickoff },
      Date.parse(kickoff),
    );
    expect(res.editable).toBe(false);
  });

  it("a later match stays editable after an earlier one has kicked off", () => {
    // The whole point of per-match locking: same round, different
    // kickoffs. At a `now` past match A's kickoff but before match B's,
    // A is frozen and B is still open.
    const now = Date.parse("2026-06-13T18:00:00Z");
    const earlier = checkMatchLock(
      { round_locked_at: null, kickoff_at: "2026-06-13T16:00:00Z" },
      now,
    );
    const later = checkMatchLock(
      { round_locked_at: null, kickoff_at: "2026-06-15T18:00:00Z" },
      now,
    );
    expect(earlier.editable).toBe(false);
    expect(later.editable).toBe(true);
  });

  it("falls through to editable when kickoff_at is unparseable", () => {
    const res = checkMatchLock(
      { round_locked_at: null, kickoff_at: "not-a-date" },
      NOW_MS,
    );
    expect(res.editable).toBe(true);
  });
});

describe("checkFinalistLock", () => {
  it("editable when first match kickoff is in the future", () => {
    const res = checkFinalistLock("2026-06-11T19:00:00Z", NOW_MS);
    expect(res).toEqual({ editable: true });
  });

  it("past_deadline once now >= first match kickoff", () => {
    const res = checkFinalistLock(
      "2026-06-11T19:00:00Z",
      NOW_DURING_TOURNAMENT,
    );
    expect(res).toEqual({
      editable: false,
      reason: "past_deadline",
      deadline_at: "2026-06-11T19:00:00Z",
    });
  });

  it("editable when no matches scheduled at all (pre-seed state)", () => {
    const res = checkFinalistLock(null, NOW_MS);
    expect(res).toEqual({ editable: true });
  });

  it("falls through to editable on unparseable kickoff timestamp", () => {
    const res = checkFinalistLock("not-a-date", NOW_MS);
    expect(res.editable).toBe(true);
  });
});

describe("validateKnockoutPrediction", () => {
  it("group matches: ties are always fine", () => {
    expect(
      validateKnockoutPrediction({
        stage: "group",
        home_score: 1,
        away_score: 1,
        predicted_winning_slot_id: null,
      }),
    ).toEqual({ ok: true });
  });

  it("knockout: non-tied score requires no winner_slot_id check", () => {
    expect(
      validateKnockoutPrediction({
        stage: "knockout",
        home_score: 2,
        away_score: 1,
        predicted_winning_slot_id: null,
      }),
    ).toEqual({ ok: true });
  });

  it("knockout: tied score without winner_slot_id rejects", () => {
    const res = validateKnockoutPrediction({
      stage: "knockout",
      home_score: 2,
      away_score: 2,
      predicted_winning_slot_id: null,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/winning slot/);
  });

  it("knockout: tied score with winner_slot_id accepts", () => {
    expect(
      validateKnockoutPrediction({
        stage: "knockout",
        home_score: 2,
        away_score: 2,
        predicted_winning_slot_id: "r32-winner-A",
      }),
    ).toEqual({ ok: true });
  });

  it("knockout: undefined winner_slot_id with tied score also rejects", () => {
    const res = validateKnockoutPrediction({
      stage: "knockout",
      home_score: 0,
      away_score: 0,
      predicted_winning_slot_id: undefined,
    });
    expect(res.ok).toBe(false);
  });
});
