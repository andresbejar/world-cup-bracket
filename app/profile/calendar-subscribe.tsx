"use client";

import { useState } from "react";

// "Add to calendar" controls for the public match-reminder ICS feed.
// The webcal:// link opens the OS calendar's subscribe dialog directly
// (iOS/macOS/Android); the https URL is offered as a copyable fallback for
// clients that subscribe by pasting a URL (e.g. Google Calendar).

export function CalendarSubscribe({
  webcalUrl,
  httpsUrl,
}: {
  webcalUrl: string;
  httpsUrl: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(httpsUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (insecure context / denied) — the input is
      // selectable, so the user can copy manually.
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <a
        href={webcalUrl}
        className="inline-flex min-h-[44px] w-fit items-center rounded-full border border-transparent bg-accent px-4 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-bg transition-opacity duration-[var(--motion-micro)] hover:opacity-90"
      >
        Add to calendar
      </a>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="calendar-url"
          className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted"
        >
          OR SUBSCRIBE BY URL
        </label>
        <div className="flex items-stretch gap-2">
          <input
            id="calendar-url"
            type="text"
            value={httpsUrl}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 rounded-sm border border-border bg-bg px-3 py-2 font-mono text-sm text-text-dim"
          />
          <button
            type="button"
            onClick={copy}
            className="inline-flex min-h-[44px] shrink-0 items-center rounded-sm border border-border px-3 font-mono text-[11px] uppercase tracking-[0.08em] text-text-primary transition-colors duration-[var(--motion-micro)] hover:border-accent-muted"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      <p className="font-mono text-[11px] text-text-muted">
        Subscribe once; your phone reminds you 30 minutes before every match.
      </p>
    </div>
  );
}
