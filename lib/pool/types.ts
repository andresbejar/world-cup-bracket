// Shared types for the prize-pool feature (APT-48).
// Mirrors the Postgres enums in supabase/migrations/20260517070035_prize_pool.sql.

export const PAYMENT_METHODS = [
  "venmo",
  "zelle",
  "cashapp",
  "paypal",
  "other",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type PoolEntryStatus = "claimed" | "confirmed";

export interface PoolEntry {
  user_id: string;
  status: PoolEntryStatus;
  method: PaymentMethod;
  notes: string | null;
  claimed_at: string;
  confirmed_at: string | null;
  confirmed_by: string | null;
}

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  venmo: "Venmo",
  zelle: "Zelle",
  cashapp: "Cash App",
  paypal: "PayPal",
  other: "Other / international",
};

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return (
    typeof value === "string" &&
    (PAYMENT_METHODS as readonly string[]).includes(value)
  );
}
