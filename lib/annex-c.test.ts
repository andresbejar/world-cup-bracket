import { describe, it, expect } from "vitest";
import { lookupAnnexC, AnnexCLookupError, WINNER_SLOTS } from "./annex-c";
import annexCData from "./annex_c.json";
import type { GroupLetter } from "./bracket";

describe("lookupAnnexC", () => {
  it("boundary: first 8 groups (key ABCDEFGH)", () => {
    expect(
      lookupAnnexC(["A", "B", "C", "D", "E", "F", "G", "H"]),
    ).toEqual({
      "1A": "H",
      "1B": "G",
      "1D": "B",
      "1E": "C",
      "1G": "A",
      "1I": "F",
      "1K": "D",
      "1L": "E",
    });
  });

  it("boundary: last 8 groups (key EFGHIJKL)", () => {
    expect(
      lookupAnnexC(["E", "F", "G", "H", "I", "J", "K", "L"]),
    ).toEqual({
      "1A": "E",
      "1B": "J",
      "1D": "I",
      "1E": "F",
      "1G": "H",
      "1I": "G",
      "1K": "L",
      "1L": "K",
    });
  });

  it("is order-independent (consumes a set, sorts before lookup)", () => {
    const sorted = lookupAnnexC(["A", "B", "C", "D", "E", "F", "G", "H"]);
    const shuffled = lookupAnnexC(["H", "A", "D", "B", "G", "F", "C", "E"]);
    expect(shuffled).toEqual(sorted);
  });

  it("throws on wrong length", () => {
    expect(() => lookupAnnexC(["A", "B", "C"] as GroupLetter[])).toThrow(
      AnnexCLookupError,
    );
  });

  it("throws on duplicate groups (not 8 distinct)", () => {
    expect(() =>
      lookupAnnexC(["A", "A", "B", "C", "D", "E", "F", "G"] as GroupLetter[]),
    ).toThrow(AnnexCLookupError);
  });

  it("throws when 8 distinct groups have no matching Annex C entry", () => {
    // 8 distinct but includes an out-of-range letter → key "ABCDEFGZ"
    // isn't in the table. Defensive: a real GroupLetter set always exists.
    expect(() =>
      lookupAnnexC(["A", "B", "C", "D", "E", "F", "G", "Z"] as GroupLetter[]),
    ).toThrow(/No Annex C entry/);
  });

  it("exposes the 8 Annex-C winner slots", () => {
    expect([...WINNER_SLOTS]).toEqual([
      "1A", "1B", "1D", "1E", "1G", "1I", "1K", "1L",
    ]);
  });
});

describe("annex_c.json invariants (all 495 combinations)", () => {
  const lookup = annexCData.lookup as Record<string, Record<string, string>>;
  const entries = Object.entries(lookup);

  it("has exactly 495 unique lookup keys", () => {
    expect(entries.length).toBe(495);
    expect(new Set(Object.keys(lookup)).size).toBe(495);
  });

  it("every key is 8 alphabetically-sorted distinct group letters", () => {
    for (const key of Object.keys(lookup)) {
      expect(key).toHaveLength(8);
      const chars = key.split("");
      expect(new Set(chars).size).toBe(8);
      expect([...chars].sort().join("")).toBe(key);
      for (const c of chars) expect("ABCDEFGHIJKL").toContain(c);
    }
  });

  it("no row pairs a winner with a 3rd-placed team from its own group", () => {
    for (const [, matchups] of entries) {
      for (const [slot, third] of Object.entries(matchups)) {
        expect(slot[1]).not.toBe(third); // 1X never faces 3X
      }
    }
  });

  it("every assigned 3rd-placed group is in the qualifying set", () => {
    for (const [key, matchups] of entries) {
      const qualifying = new Set(key.split(""));
      for (const third of Object.values(matchups)) {
        expect(qualifying.has(third)).toBe(true);
      }
    }
  });

  it("each row's 8 targets are a bijection over the qualifying groups", () => {
    for (const [key, matchups] of entries) {
      const targets = Object.values(matchups);
      expect(targets).toHaveLength(8);
      expect(new Set(targets).size).toBe(8);
      // The set of targets equals the set of qualifying groups.
      expect([...targets].sort().join("")).toBe(key);
    }
  });

  it("every row keys exactly the 8 winner slots", () => {
    for (const [, matchups] of entries) {
      expect(Object.keys(matchups).sort()).toEqual([
        "1A", "1B", "1D", "1E", "1G", "1I", "1K", "1L",
      ]);
    }
  });
});
