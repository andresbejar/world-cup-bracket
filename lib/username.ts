// Username rules for World Cup Bracket.
//
// Public Google SSO + a global leaderboard = profanity risk if the URL ever
// escapes the family chat. This module is the single source of truth for
// what counts as an acceptable username. The auth callback uses it to
// validate (and slugify) the Google display name on first sign-in, the
// profile-page edit API re-validates, and the admin force-rename path
// validates the operator's chosen replacement.
//
// Rules:
//   - length 3-24 chars
//   - lowercase a-z, digits 0-9, hyphen, underscore
//   - cannot start or end with hyphen/underscore (cosmetic; rejects "-foo-")
//   - cannot match a slur blocklist (substring match, post-normalization
//     including common leet substitutions: 4→a, 1→i, 0→o, 3→e, 5→s, 7→t)
//
// The blocklist is intentionally short — covers the dozen most common slurs.
// Family-scale moderation, not Twitter-scale. The admin force-rename path
// handles anything that slips through.

const MIN_LEN = 3;
const MAX_LEN = 24;
const CHARSET = /^[a-z0-9_-]+$/;
const EDGE_PUNCT = /^[_-]|[_-]$/;

// Substring matches against the leet-normalized candidate. Keep this list
// short and case-folded; we ship lowercase only so we don't need /i.
const SLUR_BLOCKLIST: readonly string[] = Object.freeze([
  "nigger",
  "nigga",
  "faggot",
  "fagg",
  "tranny",
  "retard",
  "kike",
  "spic",
  "chink",
  "gook",
  "cunt",
  "rapist",
  "pedo",
  "nazi",
]);

const LEET_SUBSTITUTIONS: ReadonlyArray<[RegExp, string]> = [
  [/4/g, "a"],
  [/1/g, "i"],
  [/0/g, "o"],
  [/3/g, "e"],
  [/5/g, "s"],
  [/7/g, "t"],
  [/[_-]/g, ""],
];

export type UsernameError =
  | "empty"
  | "too_short"
  | "too_long"
  | "invalid_chars"
  | "edge_punctuation"
  | "blocked";

export type UsernameResult =
  | { ok: true; username: string }
  | { ok: false; error: UsernameError };

/**
 * Strictly validate a username string. Returns a discriminated union so
 * callers can surface a precise error message in the UI.
 */
export function validateUsername(input: unknown): UsernameResult {
  if (typeof input !== "string") return { ok: false, error: "empty" };
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, error: "empty" };
  if (trimmed.length < MIN_LEN) return { ok: false, error: "too_short" };
  if (trimmed.length > MAX_LEN) return { ok: false, error: "too_long" };
  if (!CHARSET.test(trimmed)) return { ok: false, error: "invalid_chars" };
  if (EDGE_PUNCT.test(trimmed)) {
    return { ok: false, error: "edge_punctuation" };
  }
  if (containsSlur(trimmed)) return { ok: false, error: "blocked" };
  return { ok: true, username: trimmed };
}

/**
 * Slugify a free-form display name (e.g. a Google profile name) into a
 * candidate username. Returns null if the slug is unsalvageable
 * (empty, or matches the blocklist post-slug). Caller is expected to
 * uniquify (append a suffix on collision) — slugify only concerns itself
 * with shape and content safety.
 */
export function slugifyUsername(input: string): string | null {
  const slug = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_LEN);
  if (slug.length < MIN_LEN) return null;
  // Re-validate to catch blocklist hits after leet normalization.
  const result = validateUsername(slug);
  return result.ok ? result.username : null;
}

/**
 * Human-readable error for surfacing in the profile-edit UI.
 */
export function describeError(err: UsernameError): string {
  switch (err) {
    case "empty":
      return "Username is required.";
    case "too_short":
      return `At least ${MIN_LEN} characters.`;
    case "too_long":
      return `At most ${MAX_LEN} characters.`;
    case "invalid_chars":
      return "Lowercase letters, digits, hyphens, and underscores only.";
    case "edge_punctuation":
      return "Cannot start or end with a hyphen or underscore.";
    case "blocked":
      return "That username isn't allowed.";
  }
}

function containsSlur(candidate: string): boolean {
  let normalized = candidate;
  for (const [pattern, replacement] of LEET_SUBSTITUTIONS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return SLUR_BLOCKLIST.some((s) => normalized.includes(s));
}

export const USERNAME_RULES = Object.freeze({
  minLength: MIN_LEN,
  maxLength: MAX_LEN,
  charset: "a-z, 0-9, hyphen, underscore",
});
