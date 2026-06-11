"use client";

import { useId } from "react";

// 44x44 mobile touch target per DESIGN.md § Accessibility. The visual
// cell is 40x40 inside a 44x44 hit-area to keep visual rhythm tight on
// desktop.
//
// Backed by a controlled <input type="number"> so keyboard / paste / IME
// users can type a value directly. The +/- chevrons are screen-reader
// labelled and drive the same onChange.

const MIN = 0;
const MAX = 20;

export function ScoreInput({
  value,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  value: number;
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
    // No opacity treatment on the disabled wrapper: disabled only occurs
    // inside a not-ready knockout card that already dims the whole article
    // to 60% — adding more here would stack multiplicatively.
    <div
      className="flex select-none items-stretch overflow-hidden rounded-sm border border-border bg-bg focus-within:border-accent-muted focus-within:bg-surface-high"
      style={{ minHeight: 44 }}
    >
      <button
        type="button"
        aria-label={`${ariaLabel} − decrement`}
        disabled={disabled || value <= MIN}
        onClick={() => onChange(clamp(value - 1))}
        // When the whole control is disabled the wrapper already dims at
        // 50% — skip the per-button 30% so the two don't stack to ~15%.
        className={
          // w-11 (44px) on mobile per DESIGN.md § Accessibility touch
          // targets; collapses to the tight 28px cell on desktop.
          "flex w-11 items-center justify-center font-mono text-text-muted transition-colors duration-[var(--motion-micro)] hover:text-text-primary sm:w-7" +
          (disabled ? "" : " disabled:opacity-30")
        }
      >
        −
      </button>
      <input
        id={inputId}
        type="number"
        inputMode="numeric"
        min={MIN}
        max={MAX}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
        aria-label={ariaLabel}
        className="w-12 bg-transparent text-center font-mono text-lg font-medium tabular-nums text-text-primary outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        aria-label={`${ariaLabel} + increment`}
        disabled={disabled || value >= MAX}
        onClick={() => onChange(clamp(value + 1))}
        className={
          "flex w-11 items-center justify-center font-mono text-text-muted transition-colors duration-[var(--motion-micro)] hover:text-text-primary sm:w-7" +
          (disabled ? "" : " disabled:opacity-30")
        }
      >
        +
      </button>
    </div>
  );
}
