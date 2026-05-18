// Pure deep-link builders for per-method prefilled payment URLs (APT-48).
//
// Tradeoffs:
//   - Venmo: the documented universal web link (https://venmo.com/<handle>?...)
//     opens the app on mobile and falls back to the web profile on
//     desktop. The amount + note prefill works in both.
//   - Cash App: $cashtag URL form supports amount-in-path.
//   - PayPal: paypal.me works for the Friends & Family option (the user
//     picks it on the next screen — no URL flag for it, per their docs).
//   - Zelle: no consumer deep-link standard. We return null; the UI
//     shows the handle and tells the user to open their bank app.
//   - Other: free-text fallback (Wise, cash, international). No link.

import type { PoolMethodHandles } from "./config";
import type { PaymentMethod } from "./types";

const DEFAULT_NOTE = "World Cup Bracket buy-in";

/**
 * Strip a leading "@" or "$" from a handle so callers can paste any of
 * the common forms (@andres-bejar, $andresbejar, plain andresbejar).
 */
function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^[@$]/, "");
}

export function venmoLink(handle: string, amountUsd: number): string {
  const u = normalizeHandle(handle);
  const note = encodeURIComponent(DEFAULT_NOTE);
  return `https://venmo.com/${encodeURIComponent(u)}?txn=pay&amount=${amountUsd}&note=${note}`;
}

export function cashappLink(handle: string, amountUsd: number): string {
  const u = normalizeHandle(handle);
  return `https://cash.app/$${encodeURIComponent(u)}/${amountUsd}`;
}

export function paypalLink(handle: string, amountUsd: number): string {
  // paypal.me accepts either an email or a paypal.me username; if it
  // looks like an email (contains "@"), the URL form doesn't accept it.
  // In that case we fall back to a plain paypal.me without a username
  // and let the user paste-and-pay (still better than nothing — the
  // notes inline below the button tell them which email to send to).
  const u = normalizeHandle(handle);
  if (u.includes("@")) {
    // No reliable prefill for raw emails; surface a note via UI instead.
    return `https://www.paypal.com/myaccount/transfer/homepage/pay`;
  }
  return `https://paypal.me/${encodeURIComponent(u)}/${amountUsd}`;
}

export interface PaymentLink {
  /** URL to open (deep-link to app or web fallback). Null when there's
   *  no usable URL — UI should show the handle + instructions instead. */
  url: string | null;
  /** Display handle / address (e.g. for Zelle's bank-app workflow). */
  handle: string;
  /** Optional sub-instruction shown beneath the button. */
  hint?: string;
}

export interface PaymentLinkContext {
  handles: PoolMethodHandles;
  /** Optional PayPal Pool URL. When set, the paypal tile uses this
   *  instead of paypal.me — contributions aggregate on one PayPal
   *  dashboard, easier to reconcile than scattered F&F. */
  paypalPoolUrl?: string | null;
}

export function paymentLinkFor(
  method: PaymentMethod,
  ctx: PaymentLinkContext,
  amountUsd: number,
): PaymentLink | null {
  const { handles, paypalPoolUrl } = ctx;
  switch (method) {
    case "venmo": {
      if (!handles.venmo) return null;
      return {
        url: venmoLink(handles.venmo, amountUsd),
        handle: `@${normalizeHandle(handles.venmo)}`,
      };
    }
    case "zelle": {
      if (!handles.zelle) return null;
      return {
        url: null,
        handle: handles.zelle.trim(),
        hint: "Open your bank app → Zelle → send to this address.",
      };
    }
    case "cashapp": {
      if (!handles.cashapp) return null;
      return {
        url: cashappLink(handles.cashapp, amountUsd),
        handle: `$${normalizeHandle(handles.cashapp)}`,
      };
    }
    case "paypal": {
      // Pool URL wins over a paypal.me handle when both are set —
      // running two PayPal streams in parallel is the reconciliation
      // nightmare we're trying to avoid.
      if (paypalPoolUrl) {
        return {
          url: paypalPoolUrl,
          handle: "PayPal Pool · winner-take-all",
          hint: `Contribute $${amountUsd} to the shared pool. Free from PayPal balance / bank; small fee on card.`,
        };
      }
      if (!handles.paypal) return null;
      const u = normalizeHandle(handles.paypal);
      return {
        url: paypalLink(handles.paypal, amountUsd),
        handle: u.includes("@") ? u : `paypal.me/${u}`,
        hint: u.includes("@")
          ? `Send to ${u} — choose "Friends & Family".`
          : 'Choose "Friends & Family" on the next screen.',
      };
    }
    case "other":
      return {
        url: null,
        handle: "DM Andres for Wise / cash / international.",
      };
  }
}
