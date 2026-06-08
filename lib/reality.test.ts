import { describe, it, expect } from "vitest";
import {
  computeKnockoutAdvancement,
  type KnockoutMatchRow,
} from "./reality";
import { ALL_KNOCKOUT_MATCHES, R32_MATCHES } from "./bracket-structure";

// A knockout match's DB slot ids are `${round}-${slot_label}` (the seed
// convention). Helper to build a row from the static structure.
function row(
  kmId: string,
  opts: { status?: string; winner?: "home" | "away" | null } = {},
): KnockoutMatchRow {
  const km = ALL_KNOCKOUT_MATCHES.find((m) => m.id === kmId)!;
  const home = `${km.round_id}-${km.home_slot_label}`;
  const away = `${km.round_id}-${km.away_slot_label}`;
  const winner = opts.winner === undefined ? "home" : opts.winner;
  return {
    id: `m-${km.id}`,
    round_id: km.round_id,
    home_slot_id: home,
    away_slot_id: away,
    status: opts.status ?? "finished",
    winning_slot_id:
      winner === "home" ? home : winner === "away" ? away : null,
  };
}

// Real teams for all 32 R32 input slots (the only ones a fresh bracket has).
function r32Inputs(): Map<string, string> {
  const m = new Map<string, string>();
  for (const km of R32_MATCHES) {
    m.set(`r32-${km.home_slot_label}`, `T-${km.home_slot_label}`);
    m.set(`r32-${km.away_slot_label}`, `T-${km.away_slot_label}`);
  }
  return m;
}

describe("computeKnockoutAdvancement", () => {
  it("advances a single R32 winner into its downstream R16 slot", () => {
    // r32-1: runner-up-A vs runner-up-B; home wins → R16 slot for
    // 'r32-match-1-winner' (consumed by r16-2) gets ARG.
    const init = new Map([
      ["r32-runner-up-A", "ARG"],
      ["r32-runner-up-B", "BRA"],
    ]);
    const writes = computeKnockoutAdvancement([row("r32-1", { winner: "home" })], init);
    expect(writes.get("r16-r32-match-1-winner")).toBe("ARG");
    expect(writes.size).toBe(1);
  });

  it("uses winning_slot_id, not the score — penalty winner (away) advances", () => {
    const init = new Map([
      ["r32-runner-up-A", "ARG"],
      ["r32-runner-up-B", "BRA"],
    ]);
    const writes = computeKnockoutAdvancement([row("r32-1", { winner: "away" })], init);
    expect(writes.get("r16-r32-match-1-winner")).toBe("BRA");
  });

  it("semi-final winner feeds the Final and loser feeds the third-place match", () => {
    // sf-1: qf-match-1-winner vs qf-match-2-winner.
    const init = new Map([
      ["sf-qf-match-1-winner", "ARG"],
      ["sf-qf-match-2-winner", "FRA"],
    ]);
    const writes = computeKnockoutAdvancement([row("sf-1", { winner: "home" })], init);
    expect(writes.get("final-sf-match-1-winner")).toBe("ARG"); // → Final
    expect(writes.get("third_place-sf-match-1-loser")).toBe("FRA"); // → 3rd-place
  });

  it("skips a finished match whose winning input slot has no real team yet", () => {
    // r16-1 finished, but the upstream R32 winners that feed it were never
    // populated → nothing to advance.
    const writes = computeKnockoutAdvancement([row("r16-1", { winner: "home" })], new Map());
    expect(writes.size).toBe(0);
  });

  it("skips a still-tied knockout (winning_slot_id null) until the shootout lands", () => {
    const init = r32Inputs();
    const writes = computeKnockoutAdvancement([row("r32-1", { winner: null })], init);
    expect(writes.size).toBe(0);
  });

  it("ignores unfinished matches", () => {
    const init = r32Inputs();
    const writes = computeKnockoutAdvancement(
      [row("r32-1", { status: "scheduled", winner: "home" })],
      init,
    );
    expect(writes.size).toBe(0);
  });

  it("propagates a full home-wins bracket end to end", () => {
    const rows = ALL_KNOCKOUT_MATCHES.map((km) => row(km.id, { winner: "home" }));
    const writes = computeKnockoutAdvancement(rows, r32Inputs());

    // 16 R16 inputs + 8 QF + 4 SF + 2 Final + 2 third-place = 32 writes.
    expect(writes.size).toBe(32);

    // Deep home-chain: sf-1.home ← qf-1.home ← r16-1.home ← r32-2.home
    // (= winner-E). So the Final's first slot holds T-winner-E.
    expect(writes.get("final-sf-match-1-winner")).toBe("T-winner-E");
    // Both finalist slots + both third-place-match slots are filled.
    expect(writes.get("final-sf-match-2-winner")).toBeTruthy();
    expect(writes.get("third_place-sf-match-1-loser")).toBeTruthy();
    expect(writes.get("third_place-sf-match-2-loser")).toBeTruthy();
  });

  it("is deterministic / self-healing: re-running yields identical writes", () => {
    const rows = ALL_KNOCKOUT_MATCHES.map((km) => row(km.id, { winner: "home" }));
    const first = computeKnockoutAdvancement(rows, r32Inputs());
    // Feed the prior writes back in (as the cron does each tick) — same result.
    const merged = new Map([...r32Inputs(), ...first]);
    const second = computeKnockoutAdvancement(rows, merged);
    expect([...second.entries()].sort()).toEqual([...first.entries()].sort());
  });
});
