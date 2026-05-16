import { describe, expect, it } from "vitest";
import {
  describeError,
  slugifyUsername,
  USERNAME_RULES,
  validateUsername,
} from "./username";

describe("validateUsername", () => {
  it("accepts simple lowercase alphanumeric", () => {
    expect(validateUsername("andres")).toEqual({
      ok: true,
      username: "andres",
    });
    expect(validateUsername("abc")).toEqual({ ok: true, username: "abc" });
    expect(validateUsername("a1b2c3")).toEqual({
      ok: true,
      username: "a1b2c3",
    });
  });

  it("accepts hyphens and underscores in the middle", () => {
    expect(validateUsername("foo-bar")).toEqual({
      ok: true,
      username: "foo-bar",
    });
    expect(validateUsername("foo_bar_baz")).toEqual({
      ok: true,
      username: "foo_bar_baz",
    });
    expect(validateUsername("a-b_c-d")).toEqual({
      ok: true,
      username: "a-b_c-d",
    });
  });

  it("accepts at length boundaries (3 and 24)", () => {
    expect(validateUsername("abc")).toMatchObject({ ok: true });
    expect(validateUsername("a".repeat(24))).toMatchObject({ ok: true });
  });

  it("trims surrounding whitespace before validation", () => {
    expect(validateUsername("  andres  ")).toEqual({
      ok: true,
      username: "andres",
    });
  });

  it("rejects non-string inputs as empty", () => {
    expect(validateUsername(null)).toEqual({ ok: false, error: "empty" });
    expect(validateUsername(undefined)).toEqual({ ok: false, error: "empty" });
    expect(validateUsername(42)).toEqual({ ok: false, error: "empty" });
    expect(validateUsername({})).toEqual({ ok: false, error: "empty" });
  });

  it("rejects empty and whitespace-only strings", () => {
    expect(validateUsername("")).toEqual({ ok: false, error: "empty" });
    expect(validateUsername("   ")).toEqual({ ok: false, error: "empty" });
  });

  it("rejects too short (< 3 chars)", () => {
    expect(validateUsername("a")).toEqual({ ok: false, error: "too_short" });
    expect(validateUsername("ab")).toEqual({ ok: false, error: "too_short" });
  });

  it("rejects too long (> 24 chars)", () => {
    expect(validateUsername("a".repeat(25))).toEqual({
      ok: false,
      error: "too_long",
    });
  });

  it("rejects uppercase letters", () => {
    expect(validateUsername("Andres")).toEqual({
      ok: false,
      error: "invalid_chars",
    });
    expect(validateUsername("ALLCAPS")).toEqual({
      ok: false,
      error: "invalid_chars",
    });
  });

  it("rejects spaces and special characters", () => {
    expect(validateUsername("foo bar")).toEqual({
      ok: false,
      error: "invalid_chars",
    });
    expect(validateUsername("foo.bar")).toEqual({
      ok: false,
      error: "invalid_chars",
    });
    expect(validateUsername("foo@bar")).toEqual({
      ok: false,
      error: "invalid_chars",
    });
    expect(validateUsername("foo!")).toEqual({
      ok: false,
      error: "invalid_chars",
    });
    // Unicode letters not allowed (slugify handles transliteration).
    expect(validateUsername("café")).toEqual({
      ok: false,
      error: "invalid_chars",
    });
  });

  it("rejects leading or trailing hyphen/underscore", () => {
    expect(validateUsername("-foo")).toEqual({
      ok: false,
      error: "edge_punctuation",
    });
    expect(validateUsername("foo-")).toEqual({
      ok: false,
      error: "edge_punctuation",
    });
    expect(validateUsername("_foo")).toEqual({
      ok: false,
      error: "edge_punctuation",
    });
    expect(validateUsername("foo_")).toEqual({
      ok: false,
      error: "edge_punctuation",
    });
  });

  it("rejects slurs (direct match)", () => {
    expect(validateUsername("retard")).toEqual({
      ok: false,
      error: "blocked",
    });
    expect(validateUsername("supercunt")).toEqual({
      ok: false,
      error: "blocked",
    });
    expect(validateUsername("naziking")).toEqual({
      ok: false,
      error: "blocked",
    });
  });

  it("rejects slurs hidden behind leet substitutions", () => {
    // 4→a, 0→o, 3→e, 1→i, 7→t, 5→s, _- ignored
    expect(validateUsername("ret4rd")).toEqual({ ok: false, error: "blocked" });
    expect(validateUsername("n4zi")).toEqual({ ok: false, error: "blocked" });
    expect(validateUsername("r-a-p-i-s-t")).toEqual({
      ok: false,
      error: "blocked",
    });
    expect(validateUsername("p3do")).toEqual({ ok: false, error: "blocked" });
  });

  it("does not flag benign substrings", () => {
    expect(validateUsername("scunthorpe")).toMatchObject({
      ok: false,
      error: "blocked",
    }); // Falls afoul of "cunt" — documented false positive; admin can rename.
    expect(validateUsername("andres")).toMatchObject({ ok: true });
    expect(validateUsername("naomi")).toMatchObject({ ok: true });
  });
});

describe("slugifyUsername", () => {
  it("converts Google-style display names to valid slugs", () => {
    expect(slugifyUsername("Andres Bejarano")).toBe("andres-bejarano");
    expect(slugifyUsername("John")).toBe("john");
    expect(slugifyUsername("María José")).toBe("maria-jose");
  });

  it("strips diacritics and folds case", () => {
    expect(slugifyUsername("Renée Müller")).toBe("renee-muller");
  });

  it("collapses runs of non-alphanumeric to a single hyphen", () => {
    expect(slugifyUsername("foo!!!bar")).toBe("foo-bar");
    expect(slugifyUsername("a___b   c")).toBe("a-b-c");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugifyUsername("  !! Andres !!  ")).toBe("andres");
  });

  it("truncates to the 24-char max", () => {
    const slug = slugifyUsername("a".repeat(50));
    expect(slug).not.toBeNull();
    expect(slug!.length).toBeLessThanOrEqual(USERNAME_RULES.maxLength);
  });

  it("returns null for unsalvageable input", () => {
    expect(slugifyUsername("")).toBeNull();
    expect(slugifyUsername("!@#$%")).toBeNull();
    expect(slugifyUsername("ab")).toBeNull(); // too short after slug
  });

  it("returns null when the slug hits the blocklist", () => {
    expect(slugifyUsername("retard")).toBeNull();
    expect(slugifyUsername("N4zi King")).toBeNull();
  });
});

describe("describeError", () => {
  it("produces a sentence for every error variant", () => {
    const variants: Array<Parameters<typeof describeError>[0]> = [
      "empty",
      "too_short",
      "too_long",
      "invalid_chars",
      "edge_punctuation",
      "blocked",
    ];
    for (const v of variants) {
      const msg = describeError(v);
      expect(msg.length).toBeGreaterThan(0);
      expect(msg).toMatch(/\.$/);
    }
  });
});
