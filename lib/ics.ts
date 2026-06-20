// RFC 5545 (iCalendar) serializer for the public match-reminder feed.
//
// Pure functions only — no DB access, no clock. The route handler in
// app/api/calendar/world-cup.ics passes the already-resolved match view
// models plus a generation timestamp, so the output is fully deterministic
// and unit-testable (see lib/ics.test.ts).
//
// We hand-roll rather than pull the `ics` npm package: the surface is tiny,
// the repo keeps zero notification deps, and emitting the exact bytes here
// lets the tests assert CRLF folding / escaping precisely.

export interface CalendarMatch {
  /** Stable match id (e.g. "m-r32-1") — used verbatim as the VEVENT UID. */
  id: string;
  /** Kickoff, ISO 8601 UTC. */
  scheduledAtIso: string;
  /** Display token for the home side: team code if known, else a placeholder. */
  homeName: string;
  /** Display token for the away side: team code if known, else a placeholder. */
  awayName: string;
  /** Display-ready round name straight from rounds.name (e.g. "Round of 32"). */
  roundName: string;
}

// Maps the knockout slot_label scheme (documented in lib/bracket-structure.ts)
// to a human-readable placeholder for slots whose real team isn't known yet.
// Group slots always have a real team, so they never reach here.
export function humanizeSlotLabel(label: string): string {
  let m: RegExpExecArray | null;
  if ((m = /^winner-([A-L])$/.exec(label))) return `Winner Group ${m[1]}`;
  if ((m = /^runner-up-([A-L])$/.exec(label))) return `Runner-up Group ${m[1]}`;
  if (/^best-3rd-vs-[A-L]$/.test(label)) return "3rd-Place Team";
  if ((m = /^r32-match-(\d+)-winner$/.exec(label))) return `Winner R32-${m[1]}`;
  if ((m = /^r16-match-(\d+)-winner$/.exec(label))) return `Winner R16-${m[1]}`;
  if ((m = /^qf-match-(\d+)-winner$/.exec(label))) return `Winner QF-${m[1]}`;
  if ((m = /^sf-match-(\d+)-winner$/.exec(label))) return `Winner SF-${m[1]}`;
  if ((m = /^sf-match-(\d+)-loser$/.exec(label))) return `Loser SF-${m[1]}`;
  return "TBD";
}

// ISO timestamp → iCalendar UTC "basic" form: YYYYMMDDTHHMMSSZ.
export function toIcsUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`toIcsUtc: invalid date "${iso}"`);
  }
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

// Escape a TEXT-typed property value per RFC 5545 §3.3.11.
export function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\n|\r/g, "\\n");
}

// Fold a content line at 75 octets (RFC 5545 §3.1), splitting on code-point
// boundaries so multibyte chars / emoji are never cut. Continuation lines are
// prefixed with a single space, which counts toward their 75-octet budget.
export function foldLine(line: string): string {
  const MAX = 75;
  const enc = new TextEncoder();
  if (enc.encode(line).length <= MAX) return line;

  const segments: string[] = [];
  let cur = "";
  let curBytes = 0;
  for (const ch of line) {
    const chBytes = enc.encode(ch).length;
    if (curBytes + chBytes > MAX) {
      segments.push(cur);
      cur = " " + ch; // leading space marks a folded continuation line
      curBytes = 1 + chBytes;
    } else {
      cur += ch;
      curBytes += chBytes;
    }
  }
  segments.push(cur);
  return segments.join("\r\n");
}

const EVENT_DURATION_MS = 2 * 60 * 60 * 1000; // 2h block — covers ET + penalties

function eventLines(m: CalendarMatch, dtstamp: string): string[] {
  const matchup = `${m.homeName} vs ${m.awayName}`;
  const summary = `🏆 ${matchup} — ${m.roundName}`;
  const endIso = new Date(
    new Date(m.scheduledAtIso).getTime() + EVENT_DURATION_MS,
  ).toISOString();
  return [
    "BEGIN:VEVENT",
    foldLine(`UID:${m.id}@worldcupbracket`),
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${toIcsUtc(m.scheduledAtIso)}`,
    `DTEND:${toIcsUtc(endIso)}`,
    foldLine(`SUMMARY:${escapeIcsText(summary)}`),
    "STATUS:CONFIRMED",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    foldLine(
      `DESCRIPTION:${escapeIcsText(`${matchup} kicks off in 30 minutes`)}`,
    ),
    "TRIGGER:-PT30M",
    "END:VALARM",
    "END:VEVENT",
  ];
}

// Build the full VCALENDAR document. `nowIso` is the generation time (DTSTAMP);
// the route supplies the current time, tests supply a fixed value.
export function buildIcsCalendar(
  matches: CalendarMatch[],
  nowIso: string,
): string {
  const dtstamp = toIcsUtc(nowIso);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//World Cup Bracket//Match Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    foldLine("X-WR-CALNAME:World Cup 2026 — Matches"),
    "X-WR-TIMEZONE:UTC",
    "X-PUBLISHED-TTL:PT6H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
  ];
  for (const m of matches) lines.push(...eventLines(m, dtstamp));
  lines.push("END:VCALENDAR");
  // Trailing CRLF so the final line is properly terminated.
  return lines.join("\r\n") + "\r\n";
}
