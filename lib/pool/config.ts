// Prize pool config (APT-48). Env-driven so handles can be rotated
// without a DB migration and the pool can be disabled by unsetting
// POOL_BUY_IN_USD.
//
// Lazy read (not module-load) so a missing env var doesn't crash
// `next build` — the /pool page surfaces a "not configured" notice and
// the POST /api/pool/claim route returns 503 instead.

import type { PaymentMethod } from "./types";

export interface PoolMethodHandles {
  venmo?: string;
  zelle?: string;
  cashapp?: string;
  paypal?: string;
}

export interface PoolConfig {
  /** Buy-in amount in whole USD. */
  buyInUsd: number;
  /** ISO timestamp after which "I just paid" claims are still allowed
   * but the UI shows a "late" warning. Optional — falls back to null. */
  deadline: string | null;
  /** Per-method recipient handles. Methods with an unset handle are
   * hidden from the picker. "other" is always available — it's the
   * free-text escape hatch for Wise / cash / etc. */
  methods: PoolMethodHandles;
  /** PayPal Pool URL (https://paypal.com/pool/...). When set, the
   *  PayPal tile points here instead of paypal.me — pools aggregate
   *  every contributor on one PayPal dashboard, which is easier to
   *  reconcile than scattered F&F payments. Overrides
   *  POOL_PAYPAL_HANDLE. */
  paypalPoolUrl: string | null;
}

export type PoolConfigResult =
  | { ok: true; config: PoolConfig }
  | { ok: false; reason: "not_configured" };

/**
 * Read the pool config from env. Returns `not_configured` when the
 * buy-in is unset — that's the canonical "feature disabled" signal.
 */
export function readPoolConfig(): PoolConfigResult {
  const raw = process.env.POOL_BUY_IN_USD;
  if (!raw || raw.trim().length === 0) {
    return { ok: false, reason: "not_configured" };
  }
  const buyInUsd = Number.parseInt(raw, 10);
  if (!Number.isFinite(buyInUsd) || buyInUsd <= 0) {
    return { ok: false, reason: "not_configured" };
  }
  return {
    ok: true,
    config: {
      buyInUsd,
      deadline: process.env.POOL_DEADLINE_ISO?.trim() || null,
      methods: {
        venmo: process.env.POOL_VENMO_HANDLE?.trim() || undefined,
        zelle: process.env.POOL_ZELLE_HANDLE?.trim() || undefined,
        cashapp: process.env.POOL_CASHAPP_HANDLE?.trim() || undefined,
        paypal: process.env.POOL_PAYPAL_HANDLE?.trim() || undefined,
      },
      paypalPoolUrl: process.env.POOL_PAYPAL_POOL_URL?.trim() || null,
    },
  };
}

/**
 * Methods exposed in the UI, in the order they should render. Anything
 * with an unset handle is filtered out; "other" is always last.
 *
 * PayPal shows up if either POOL_PAYPAL_HANDLE or POOL_PAYPAL_POOL_URL
 * is set — when the pool URL is set, it takes precedence over the handle.
 */
export function enabledMethods(config: PoolConfig): PaymentMethod[] {
  const out: PaymentMethod[] = [];
  if (config.methods.venmo) out.push("venmo");
  if (config.methods.zelle) out.push("zelle");
  if (config.methods.cashapp) out.push("cashapp");
  if (config.methods.paypal || config.paypalPoolUrl) out.push("paypal");
  out.push("other");
  return out;
}
