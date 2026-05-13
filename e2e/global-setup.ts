import { chromium, type FullConfig, type Cookie } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Auth bootstrap for every E2E run. The flow:
//
//   1. Provision a fresh test user via the service-role admin API.
//      Idempotent — any stale user from a prior run is wiped first.
//   2. Generate a magic-link via auth.admin.generateLink — we only want
//      the `hashed_token` it returns. The action_link itself is unusable
//      (Supabase Site URL config overrides our redirectTo) and the URL
//      uses implicit-flow hash fragments instead of the PKCE code our
//      /auth/callback expects.
//   3. Spin up a supabase-ssr serverClient with an in-memory cookie jar
//      and call verifyOtp(token_hash). supabase-ssr writes the session
//      cookies into our jar with the exact name + chunking semantics
//      the production app reads back via createServerClient.
//   4. Inject those cookies into a Playwright BrowserContext and save
//      storage state for every spec to load via `use.storageState`.
//
// This bypasses Supabase's Site URL config entirely (no redirect happens
// in a real browser) and produces a session shape indistinguishable
// from what `/auth/callback` writes after a real OAuth round-trip.

export const TEST_USER_EMAIL = "e2e-test@worldcupbracket.local";
const STATE_PATH = "e2e/.auth/user.json";

export default async function globalSetup(config: FullConfig) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    throw new Error(
      "global-setup: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY must all be set",
    );
  }

  const baseURL = config.projects[0]?.use?.baseURL;
  if (!baseURL) {
    throw new Error("global-setup: baseURL missing from playwright config");
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Wipe any stale test user from a previous run. ON DELETE CASCADE in
  // public.users → predictions → finalist_picks → predicted_third_place
  // makes this idempotent.
  const existing = await admin.auth.admin.listUsers();
  if (existing.error) {
    throw new Error(`global-setup: listUsers failed: ${existing.error.message}`);
  }
  const stale = existing.data.users.find((u) => u.email === TEST_USER_EMAIL);
  if (stale) {
    const { error } = await admin.auth.admin.deleteUser(stale.id);
    if (error) {
      throw new Error(`global-setup: deleteUser failed: ${error.message}`);
    }
  }

  // Provision the user. email_confirm short-circuits the "click the link
  // in your email" step so the user exists in a fully-verified state.
  const created = await admin.auth.admin.createUser({
    email: TEST_USER_EMAIL,
    email_confirm: true,
    user_metadata: { name: "E2E Test User", e2e: true },
  });
  if (created.error || !created.data.user) {
    throw new Error(
      `global-setup: createUser failed: ${created.error?.message ?? "no user returned"}`,
    );
  }

  // Backstop the handle_new_user trigger in case of a race — we've seen
  // the public.users row appear AFTER the first auth.users insert on
  // some Supabase deployments. Direct service-role upsert guarantees the
  // row exists with a sensible username before /predictions loads.
  const upsert = await admin
    .from("users")
    .upsert(
      { id: created.data.user.id, email: TEST_USER_EMAIL, username: "e2e-tester" },
      { onConflict: "id" },
    );
  if (upsert.error) {
    throw new Error(`global-setup: users upsert failed: ${upsert.error.message}`);
  }

  // Pull the hashed_token from a generated magic-link. We only use this
  // value — never visit action_link in a browser (see file header).
  const link = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: TEST_USER_EMAIL,
  });
  const tokenHash = link.data?.properties?.hashed_token;
  if (link.error || !tokenHash) {
    throw new Error(
      `global-setup: generateLink failed: ${link.error?.message ?? "no hashed_token"}`,
    );
  }

  // Capture every cookie supabase-ssr writes during verifyOtp into an
  // in-memory jar. These are the same cookie names + chunking the prod
  // /auth/callback path produces — supabase-ssr's chunker handles the
  // base64 + multi-cookie split for us so we don't have to replicate it.
  const cookieJar: { name: string; value: string }[] = [];
  const ssrClient = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => cookieJar.map((c) => ({ name: c.name, value: c.value })),
      setAll: (toSet) => {
        for (const c of toSet) {
          const i = cookieJar.findIndex((existing) => existing.name === c.name);
          if (i >= 0) cookieJar[i].value = c.value;
          else cookieJar.push({ name: c.name, value: c.value });
        }
      },
    },
  });
  const verify = await ssrClient.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (verify.error || !verify.data.session) {
    throw new Error(
      `global-setup: verifyOtp failed: ${verify.error?.message ?? "no session"}`,
    );
  }
  if (cookieJar.length === 0) {
    throw new Error(
      "global-setup: verifyOtp ran but supabase-ssr wrote no cookies — check anon key matches the project",
    );
  }

  // Adapt to Playwright's cookie shape and bind to the test host. Cookies
  // are scoped to localhost on the e2e port — they have no meaning in
  // any other context, so this is safe to commit-by-gitignore.
  const url = new URL(baseURL);
  const playwrightCookies: Cookie[] = cookieJar.map((c) => ({
    name: c.name,
    value: c.value,
    domain: url.hostname,
    path: "/",
    expires: -1,
    httpOnly: false,
    secure: url.protocol === "https:",
    sameSite: "Lax",
  }));

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });
  await context.addCookies(playwrightCookies);

  // Sanity-check: pull /predictions and verify the server-rendered page
  // sees us as authenticated. If middleware bounces to /sign-in, the
  // cookie format / domain / signing is wrong and we want to fail loud
  // here rather than have every spec time out.
  const page = await context.newPage();
  const response = await page.goto(`${baseURL}/predictions`, {
    waitUntil: "domcontentloaded",
  });
  if (!response) {
    throw new Error("global-setup: /predictions returned no response");
  }
  if (!page.url().endsWith("/predictions")) {
    throw new Error(
      `global-setup: cookie injection failed — /predictions redirected to ${page.url()}`,
    );
  }

  mkdirSync(dirname(STATE_PATH), { recursive: true });
  await context.storageState({ path: STATE_PATH });
  await browser.close();

  process.env.E2E_TEST_USER_ID = created.data.user.id;
}
