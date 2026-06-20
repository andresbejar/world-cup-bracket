// Public ICS calendar feed: every World Cup match, with a 30-minute-before
// VALARM on each event. Users subscribe once (see /profile) and their phone's
// native calendar fires the reminder — no push, no service worker, no cron.
//
// The feed is identical for everyone and reads only public reference data, so
// it's deliberately unauthenticated and CDN-cacheable.
//
// Staleness note: OS calendar clients refresh slowly (hours up to ~a day), and
// we cache at the CDN for an hour, so a last-minute reschedule can take up to a
// day to reach a subscriber. Inherent to the subscribe-once model and accepted
// for this scope; World Cup kickoff times are fixed well in advance.

import { buildIcsCalendar } from "@/lib/ics";
import { loadCalendarMatches } from "@/lib/calendar-data";

export const revalidate = 3600;

export async function GET() {
  const matches = await loadCalendarMatches();
  const body = buildIcsCalendar(matches, new Date().toISOString());

  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="world-cup-2026.ics"',
      "Cache-Control":
        "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
