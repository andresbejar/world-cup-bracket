// Centralized env access. Throws loudly at module load if a required var is
// missing in production, so deploy-time misconfiguration surfaces fast.
//
// Convention:
//   NEXT_PUBLIC_*  — readable from the browser
//   everything else — server-only

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required env var: ${name}. Set it in .env.local locally or in the Vercel dashboard for prod.`,
    );
  }
  return v;
}

export const env = {
  // Supabase — public (anon key is safe to ship to the browser; RLS protects rows)
  SUPABASE_URL: required("NEXT_PUBLIC_SUPABASE_URL"),
  SUPABASE_ANON_KEY: required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),

  // Supabase — server-only (service role bypasses RLS, never expose to browser)
  SUPABASE_SERVICE_ROLE_KEY:
    typeof window === "undefined"
      ? required("SUPABASE_SERVICE_ROLE_KEY")
      : "",

  // api-sports.io — server-only
  APIFOOTBALL_HOST:
    typeof window === "undefined"
      ? required("APIFOOTBALL_HOST")
      : "",
  APIFOOTBALL_KEY:
    typeof window === "undefined" ? required("APIFOOTBALL_KEY") : "",
};
