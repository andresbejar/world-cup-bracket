import { createClient } from "@supabase/supabase-js";
import { TEST_USER_EMAIL } from "./global-setup";

// Delete the e2e test user. ON DELETE CASCADE on the public-side tables
// (predictions, finalist_picks, predicted_qualifying_thirds) takes
// care of every row the test wrote. Teardown is best-effort — a failure
// here shouldn't mask a green test run; we log and exit cleanly.

export default async function globalTeardown() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return;

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const list = await admin.auth.admin.listUsers();
  if (list.error) {
    console.warn("[e2e teardown] listUsers failed:", list.error.message);
    return;
  }
  const user = list.data.users.find((u) => u.email === TEST_USER_EMAIL);
  if (!user) return;

  const del = await admin.auth.admin.deleteUser(user.id);
  if (del.error) {
    console.warn("[e2e teardown] deleteUser failed:", del.error.message);
  }
}
