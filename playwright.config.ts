import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

// Load e2e Supabase creds. .env.test holds the dedicated test-project
// creds (APT-52) so the suite never touches the live tournament DB; CI
// supplies the same values via TEST_SUPABASE_* GitHub secrets. dotenv does
// not override already-set vars, so loading .env.test first gives it
// priority and .env.local only fills gaps. If .env.test is absent and
// .env.local points at prod, the assertTestDatabase guard fails loud rather
// than silently mutating prod.
dotenv.config({ path: ".env.test" });
dotenv.config({ path: ".env.local" });

const PORT = process.env.E2E_PORT ?? "3100";
const BASE_URL = `http://localhost:${PORT}`;

// Playwright config. CLAUDE.md mandates 5 critical-path E2Es before
// production. APT-33 ships the auth bootstrap + the signup-flow spec;
// follow-ups (APT-34/35/36/37) plug into the same auth + webServer rig.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // tests share one auth state + one Supabase project
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",

  // Auth state is materialized once in global-setup and re-used by every
  // spec via the `storageState` option below. Saves ~3s per spec by
  // avoiding a magic-link round-trip per file.
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",

  use: {
    baseURL: BASE_URL,
    storageState: "e2e/.auth/user.json",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    // WebKit covers the Safari engine — family-beta users will overwhelmingly
    // be on iPhones. Kept in the matrix per the test plan; CI installs both.
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],

  // Spin up the Next.js prod server for the test run. We use `next start`
  // (not `next dev`) so the build is exercised the same way it ships on
  // Vercel. Reuses an existing server when running locally with one already
  // up on $E2E_PORT.
  //
  // Locally we `next build` first so the bundle is compiled against the test
  // env this config just loaded (.env.test). Next inlines NEXT_PUBLIC_* at
  // BUILD time — into the server/middleware bundle too — so a stale build
  // made against .env.local (prod) would make the running app talk to prod
  // while global-setup mints its session in the test DB; the project-scoped
  // auth cookie wouldn't match and /predictions bounces to /sign-in. CI skips
  // the rebuild here because its workflow already runs `npm run build` with
  // the TEST_SUPABASE_* env in a dedicated step (no double build).
  webServer: {
    command: process.env.CI
      ? `next start --port ${PORT}`
      : `next build && next start --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
