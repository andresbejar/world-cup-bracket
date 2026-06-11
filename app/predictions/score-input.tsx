"use client";

import { useId } from "react";

// 44x44 mobile touch target per DESIGN.md § Accessibility. The visual
// cell is 40x40 inside a 44x44 hit-area to keep visual rhythm tight on
// desktop.
//
// Backed by a controlled <input type="number"> so keyboard / paste / IME
// users can type a value directly. The +/- chevrons are screen-reader
// labelled and drive the same onChange.
//
// Unpicked state: `value` is null and the box renders a dim "–"
// placeholder — never a fake 0, which users mistook for a saved 0-0.
// The first "+" tap materializes a real 0 (so predicting a 0-0 draw is
// one tap); once materialized a box can't return to null, matching the
// DB where a prediction row always carries both scores.
//
// Disabled (locked round, or knockout matchup not yet resolved): the
// chevrons unmount entirely and the value renders as a frozen read-only
// number — no opacity layering, the box just stops being a stepper.

const MIN = 0;
const MAX = 20;

export function ScoreInput({
  value,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  value: number | null;
  onChange: (next: number) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const inputId = useId();

  function clamp(n: number) {
    if (Number.isNaN(n)) return 0;
    return Math.max(MIN, Math.min(MAX, Math.trunc(n)));
  }

  return (
    <div
      className="flex select-none items-stretch overflow-hidden rounded-sm border border-border bg-bg focus-within:border-accent-muted focus-within:bg-surface-high"
      style={{ minHeight: 44 }}
    >
      {disabled ? null : (
        <button
          type="button"
          aria-label={`${ariaLabel} − decrement`}
          disabled={value == null || value <= MIN}
          onClick={() => onChange(clamp((value ?? 0) - 1))}
          // w-11 (44px) on mobile per DESIGN.md § Accessibility touch
          // targets; collapses to the tight 28px cell on desktop.
          className="flex w-11 items-center justify-center font-mono text-text-muted transition-colors duration-[var(--motion-micro)] hover:text-text-primary disabled:opacity-30 sm:w-7"
        >
          −
        </button>
      )}
      <input
        id={inputId}
        type="number"
        inputMode="numeric"
        min={MIN}
        max={MAX}
        value={value ?? ""}
        placeholder="–"
        disabled={disabled}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
        aria-label={ariaLabel}
        className="w-12 bg-transparent text-center font-mono text-lg font-medium tabular-nums text-text-primary outline-none placeholder:text-text-dim [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      {disabled ? null : (
        <button
          type="button"
          aria-label={`${ariaLabel} + increment`}
          disabled={value != null && value >= MAX}
          onClick={() => onChange(value == null ? 0 : clamp(value + 1))}
          className="flex w-11 items-center justify-center font-mono text-text-muted transition-colors duration-[var(--motion-micro)] hover:text-text-primary disabled:opacity-30 sm:w-7"
        >
          +
        </button>
      )}
    </div>
  );
}
