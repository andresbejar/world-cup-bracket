"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  describeError,
  USERNAME_RULES,
  validateUsername,
} from "@/lib/username";

// Single-field profile form: rename. Client-side pre-validation mirrors
// the server rules from lib/username so we surface the same error copy
// without a round-trip; the server re-runs validateUsername for safety.

type Status = "idle" | "saving" | "saved" | "error";

export function ProfileForm({
  initialUsername,
  email,
  banned,
}: {
  initialUsername: string;
  email: string;
  banned: boolean;
}) {
  const [value, setValue] = useState(initialUsername);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  const dirty = value !== initialUsername;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (banned) return;
    const check = validateUsername(value);
    if (!check.ok) {
      setStatus("error");
      setMessage(describeError(check.error));
      return;
    }
    setStatus("saving");
    setMessage(null);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: check.username }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setStatus("error");
        setMessage(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setStatus("saved");
      setMessage("Saved.");
      // Refresh server components so the top bar pulls the new username.
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label
          htmlFor="profile-email"
          className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted"
        >
          EMAIL
        </label>
        <input
          id="profile-email"
          type="email"
          value={email}
          readOnly
          disabled
          className="rounded-sm border border-border bg-bg px-3 py-2 font-mono text-sm text-text-dim"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="profile-username"
          className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted"
        >
          USERNAME · {USERNAME_RULES.minLength}–{USERNAME_RULES.maxLength}{" "}
          chars · {USERNAME_RULES.charset}
        </label>
        <input
          id="profile-username"
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setStatus("idle");
            setMessage(null);
          }}
          disabled={banned}
          autoComplete="off"
          spellCheck={false}
          maxLength={USERNAME_RULES.maxLength}
          className="rounded-sm border border-border bg-bg px-3 py-2 font-mono text-sm text-text-primary outline-none focus:border-accent-muted disabled:opacity-60"
        />
      </div>

      {banned ? (
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-red-wrong">
          Account banned. Contact an admin to re-enable.
        </p>
      ) : null}

      <div className="flex items-center justify-between">
        <button
          type="submit"
          disabled={!dirty || banned || status === "saving"}
          className="inline-flex min-h-[44px] items-center rounded-full border border-transparent bg-accent px-4 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-bg transition-opacity duration-[var(--motion-micro)] disabled:opacity-40"
        >
          {status === "saving" ? "Saving…" : "Save"}
        </button>
        {message ? (
          <span
            role="status"
            className={
              "font-mono text-[11px] uppercase tracking-[0.08em] " +
              (status === "error"
                ? "text-red-wrong"
                : status === "saved"
                  ? "text-green-correct"
                  : "text-text-muted")
            }
          >
            {message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
