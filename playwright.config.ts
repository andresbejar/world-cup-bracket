import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

// Load .env.local for the e2e env (Supabase URL/keys). Same file the
// dev server uses — keeps a single source of truth for secrets locally;
// CI gets the values via GitHub Actions secrets.
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
  webServer: {
    command: `next start --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
